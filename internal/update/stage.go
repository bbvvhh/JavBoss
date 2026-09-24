package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"javboss/internal/backup"
)

const (
	// pendingFileName 是「已解压、等待落地」的标记，也是替换中途被打断的凭据。
	pendingFileName = "pending.json"
	// appliedFileName 是最近一次更新的结果，前端提示后由 AcknowledgeApplied 清除。
	appliedFileName = "applied.json"
	// planFileName 记录本次替换涉及的文件，供中断后的回滚使用。
	planFileName = "plan.json"
	// unpackedDirName 下是剥掉顶层目录后的发布包内容。
	unpackedDirName = "unpacked"
	// stagingDir 下是下载到本机的远程发布包与校验边车。
	stagingDirName = "staging"
	// rollbackPrefix 是回滚副本目录前缀（data/update/backup-<时间戳>）。
	rollbackPrefix = "backup-"

	rollbackTimeLayout = "20060102-150405"
)

// Pending 描述一份已解压、等待覆盖到程序目录的更新。
type Pending struct {
	FileName  string    `json:"file_name"`
	StagedAt  time.Time `json:"staged_at"`
	FileCount int       `json:"file_count"`
	TotalSize int64     `json:"total_size"`
	// Root 是归档里的顶层目录名，便于排查「包结构不对」之类的问题。
	Root string `json:"root"`
}

// AppliedResult 描述最近一次更新的结果。前端提示后调用 AcknowledgeApplied 清除。
type AppliedResult struct {
	FileName  string    `json:"file_name"`
	AppliedAt time.Time `json:"applied_at"`
	FileCount int       `json:"file_count"`
	// RestartNeeded 恒为 true：更新只会覆盖磁盘上的文件，必须重启才生效。
	RestartNeeded bool `json:"restart_required"`
	// Deferred 为 true 表示 Windows 上已交给 helper 在程序退出后完成替换。
	Deferred bool   `json:"deferred"`
	Error    string `json:"error"`
}

// StageOptions 描述一次「更新准备」的输入。
type StageOptions struct {
	// DataDir 是程序 data 目录，暂存与回滚副本都放在它下面（data/update/）。
	DataDir string
	// ProgramDir 是要被覆盖的程序目录。
	ProgramDir string
	// ArchivePath 是发布包在本机的绝对路径。远程包先下载到 StageArchivePath。
	ArchivePath string
	FileName    string
}

// ApplyOptions 描述一次更新落地。
type ApplyOptions struct {
	DataDir    string
	ProgramDir string
	// ArchivePath 与 Stage 的相同，只用于失败后清理下载残留。
	ArchivePath string
}

// StartupResult 是启动期处理更新的结果。
type StartupResult struct {
	// RolledBack 表示这次启动回滚了一次没走完的替换。
	RolledBack bool
	// Restored 是回滚还原的文件数。
	Restored int
	// Result 是最近一次更新的结果（没有就是 nil）。
	Result *AppliedResult
}

// PlanEntry 是一份替换计划里的一个文件。
type PlanEntry struct {
	// Rel 是相对程序目录的路径（正斜杠分隔）。
	Rel string
	// Source 是解压出来的新文件。
	Source string
	// Target 是程序目录里的目标路径。
	Target string
	// Rollback 是目标文件被覆盖前的副本（backup-<时间戳>/ 下），目标原本不存在时为空。
	Rollback string
	Mode     fs.FileMode
}

// UpdateDir 返回 data 目录下的更新暂存目录。
func UpdateDir(dataDir string) string {
	return filepath.Join(dataDir, backup.UpdateDirName)
}

// StageArchivePath 是远程发布包应先下载到的位置。
// 校验边车会被复制到它旁边（同名 + .sha256），所以 VerifySidecar 能直接读到。
func StageArchivePath(dataDir, name string) string {
	return filepath.Join(UpdateDir(dataDir), stagingDirName, name)
}

// Stage 校验发布包并解压到暂存目录，写下待落地标记。
//
// 不直接覆盖程序目录：覆盖是用户在界面上显式触发的（见 Apply），
// 这样「下载或解压失败」不会把程序改成半新旧的状态。
func Stage(ctx context.Context, opts StageOptions) (Pending, error) {
	stageDir, err := opts.validate()
	if err != nil {
		return Pending{}, err
	}
	if err := VerifySidecar(opts.ArchivePath); err != nil {
		return Pending{}, err
	}
	// 清掉上一次的中间产物；本次要用的归档可能就下载在 staging/ 下，不能删。
	if err := cleanStaging(stageDir, filepath.Base(opts.ArchivePath), filepath.Base(opts.ArchivePath)+Sha256Ext); err != nil {
		return Pending{}, err
	}

	unpackedDir := filepath.Join(stageDir, unpackedDirName)
	manifest, err := Extract(ctx, opts.ArchivePath, unpackedDir)
	if err != nil {
		return Pending{}, err
	}
	if err := ValidateManifest(manifest, runtime.GOOS, runtime.GOARCH); err != nil {
		_ = os.RemoveAll(unpackedDir)
		return Pending{}, err
	}

	pending := Pending{
		FileName:  opts.FileName,
		StagedAt:  time.Now(),
		FileCount: len(manifest.Entries),
		TotalSize: manifest.TotalSize,
		Root:      manifest.Root,
	}
	if err := writeJSON(filepath.Join(stageDir, pendingFileName), pending); err != nil {
		_ = os.RemoveAll(unpackedDir)
		return Pending{}, err
	}
	return pending, nil
}

// Apply 把已暂存的更新覆盖到程序目录。
//
// 流程：生成替换计划 → 把将被覆盖的文件备份到 data/update/backup-<时间戳>/
// → 平台相关的替换 → 成功后清掉暂存并写下 applied.json。
// 替换失败会就地回滚，并把原因写进 applied.json，绝不留半个新版本。
func Apply(ctx context.Context, opts ApplyOptions) (AppliedResult, error) {
	stageDir, err := opts.validate()
	if err != nil {
		return AppliedResult{}, err
	}
	pending, ok, err := readPending(stageDir)
	if err != nil {
		return AppliedResult{}, err
	}
	if !ok {
		return AppliedResult{}, ErrNothingStaged
	}

	result := AppliedResult{FileName: pending.FileName, AppliedAt: time.Now(), RestartNeeded: true}
	plan, err := prepare(stageDir, opts.ProgramDir)
	if err != nil {
		return abortUpdate(stageDir, result, err)
	}
	result.FileCount = len(plan)

	applied, err := platformApply(ctx, opts, plan, result)
	if err != nil {
		return abortUpdate(stageDir, result, err)
	}
	if applied.Deferred {
		// Windows：替换交给 helper 在程序退出后进行，暂存与 pending 都要留着。
		return applied, nil
	}
	// 替换完成，清掉解压结果、替换计划与回滚副本，只留结果标记。
	if err := cleanStaging(stageDir); err != nil {
		applied.Error = strings.TrimSpace(applied.Error + "; " + err.Error())
	}
	if err := writeJSON(filepath.Join(stageDir, appliedFileName), applied); err != nil {
		return applied, err
	}
	return applied, nil
}

// Rollback 用回滚副本把程序目录还原到上一次替换之前的状态，返回还原的文件数。
//
// 计划里标记为 existed 的文件必须靠回滚副本还原：副本不存在（进程在 prepare
// 生成副本之前就被杀了）时**一个文件都不能删**——那些文件根本没被替换过，
// 照计划删掉就等于毁掉程序，此时返回错误让调用方如实告诉用户。
// 计划里标记为新增的文件是这次更新凭空创建的（源包里本就有、程序目录里原本没有），
// 回滚就是把它们删掉。
func Rollback(dataDir, programDir string) (int, error) {
	stageDir := UpdateDir(dataDir)
	stored, err := readStoredPlan(stageDir)
	if err != nil {
		return 0, err
	}
	if len(stored.Entries) == 0 {
		return 0, nil
	}
	rollbackDir, err := latestRollbackDir(stageDir)
	if err != nil {
		return 0, err
	}
	restored := 0
	var missing []string
	// 逆序还原，与替换顺序相反。
	for i := len(stored.Entries) - 1; i >= 0; i-- {
		entry := stored.Entries[i]
		target := filepath.Join(programDir, filepath.FromSlash(entry.Rel))
		mode := fs.FileMode(entry.Mode).Perm()
		if mode == 0 {
			mode = 0o644
		}
		if entry.Existing {
			source := ""
			if rollbackDir != "" {
				candidate := filepath.Join(rollbackDir, filepath.FromSlash(entry.Rel))
				if _, statErr := os.Stat(candidate); statErr == nil {
					source = candidate
				}
			}
			if source == "" {
				missing = append(missing, entry.Rel)
				continue
			}
			if err := replaceFile(source, target, mode); err != nil {
				return restored, err
			}
			restored++
			continue
		}
		if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return restored, fmt.Errorf("remove added file %s: %w", entry.Rel, err)
		}
		restored++
	}
	if len(missing) > 0 {
		return restored, fmt.Errorf(
			"update: %d file(s) have no rollback copy and were left as is: %s",
			len(missing), strings.Join(missing, ", "),
		)
	}
	return restored, nil
}

// HandleStartup 在启动早期处理上一次没走完的更新。
//
// 只做三件事：回滚一份被中断的替换、清掉暂存残留、读出最近一次的结果供前端提示。
// 绝不在启动期替换任何文件——替换只由用户在界面上显式触发。
func HandleStartup(programDir, dataDir string) StartupResult {
	stageDir := UpdateDir(dataDir)
	var outcome StartupResult
	pending, ok, err := readPending(stageDir)
	if err == nil && ok {
		restored, rollbackErr := Rollback(dataDir, programDir)
		outcome.RolledBack = true
		outcome.Restored = restored
		result := AppliedResult{FileName: pending.FileName, AppliedAt: time.Now(), FileCount: restored}
		if rollbackErr != nil {
			result.Error = fmt.Sprintf("上一次更新没有走完，回滚也失败了：%v", rollbackErr)
		} else {
			result.Error = "上一次更新没有走完，已回滚到原版本，请重新执行更新"
		}
		_ = writeJSON(filepath.Join(stageDir, appliedFileName), result)
		outcome.Result = &result
	}
	_ = cleanStaging(stageDir)
	if outcome.Result == nil {
		if applied, err := ReadApplied(dataDir); err == nil {
			outcome.Result = applied
		}
	}
	return outcome
}

// ReadPending 返回待落地的更新；没有则返回 nil。
func ReadPending(dataDir string) (*Pending, error) {
	pending, ok, err := readPending(UpdateDir(dataDir))
	if err != nil || !ok {
		return nil, err
	}
	return &pending, nil
}

// ReadApplied 返回最近一次更新的结果；没有则返回 nil。
func ReadApplied(dataDir string) (*AppliedResult, error) {
	var result AppliedResult
	err := readJSON(filepath.Join(UpdateDir(dataDir), appliedFileName), &result)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// AcknowledgeApplied 清除最近一次更新的结果标记。
func AcknowledgeApplied(dataDir string) error {
	err := os.Remove(filepath.Join(UpdateDir(dataDir), appliedFileName))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("clear update result: %w", err)
	}
	return nil
}

func (o StageOptions) validate() (string, error) {
	if !filepath.IsAbs(o.DataDir) {
		return "", errors.New("update: data directory must be an absolute path")
	}
	if !filepath.IsAbs(o.ArchivePath) {
		return "", errors.New("update: update package must be an absolute path")
	}
	if !ValidPackageName(o.FileName) {
		return "", fmt.Errorf("update: invalid update package name %q", o.FileName)
	}
	return validateProgramDir(o.ProgramDir, o.DataDir)
}

func (o ApplyOptions) validate() (string, error) {
	if !filepath.IsAbs(o.DataDir) {
		return "", errors.New("update: data directory must be an absolute path")
	}
	return validateProgramDir(o.ProgramDir, o.DataDir)
}

// validateProgramDir 校验程序目录可用，并返回更新暂存目录。
func validateProgramDir(programDir, dataDir string) (string, error) {
	if !filepath.IsAbs(programDir) {
		return "", errors.New("update: program directory must be an absolute path")
	}
	// 程序目录不能落在 data 目录里，否则「data 目录坚决不动」就自相矛盾了。
	if samePath(programDir, dataDir) || relativeInside(dataDir, programDir) != "" {
		return "", errors.New("update: program directory must be outside the data directory")
	}
	info, err := os.Stat(programDir)
	if err != nil {
		return "", fmt.Errorf("update: program directory is not usable: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("update: program directory is not a directory")
	}
	// 更新要往程序目录写临时文件再改名，不可写必须现在报错，
	// 而不是替换到一半才发现（Windows 上装在 Program Files 下且没提权就是这种情况）。
	if err := checkWritable(programDir); err != nil {
		return "", err
	}
	return UpdateDir(dataDir), nil
}

// prepare 生成替换计划，并把将被覆盖的现有文件备份到 backup-<时间戳>/ 下。
func prepare(stageDir, programDir string) ([]PlanEntry, error) {
	plan, err := buildPlan(stageDir, programDir)
	if err != nil {
		return nil, err
	}
	rollbackDir := filepath.Join(stageDir, rollbackPrefix+time.Now().Format(rollbackTimeLayout))
	stored := storedPlan{Entries: make([]storedEntry, 0, len(plan))}
	existing := make([]bool, len(plan))
	for i := range plan {
		plan[i].Rollback = filepath.Join(rollbackDir, filepath.FromSlash(plan[i].Rel))
		info, statErr := os.Stat(plan[i].Target)
		switch {
		case errors.Is(statErr, fs.ErrNotExist):
			// 目标原本不存在，回滚时直接删掉即可。
		case statErr != nil:
			return nil, fmt.Errorf("inspect %s: %w", plan[i].Rel, statErr)
		case !info.Mode().IsRegular():
			return nil, fmt.Errorf("update: %s is not a regular file", plan[i].Rel)
		default:
			existing[i] = true
		}
		stored.Entries = append(stored.Entries, storedEntry{
			Rel:      plan[i].Rel,
			Mode:     uint32(plan[i].Mode.Perm()),
			Existing: existing[i],
		})
	}
	// 计划先落盘：替换到一半进程被杀时，下一次启动要靠它回滚。
	if err := writeJSON(filepath.Join(stageDir, planFileName), stored); err != nil {
		return nil, err
	}
	for i, entry := range plan {
		if !existing[i] {
			continue
		}
		if err := copyFile(entry.Target, entry.Rollback); err != nil {
			return nil, err
		}
	}
	return plan, nil
}

// buildPlan 从解压结果生成替换计划：包里的每个文件对应程序目录里的一个目标。
// data/** 与 config.toml 一律排除（data 目录坚决不动，配置文件保留本地版本）。
func buildPlan(stageDir, programDir string) ([]PlanEntry, error) {
	unpackedDir := filepath.Join(stageDir, unpackedDirName)
	plan := make([]PlanEntry, 0, 64)
	err := filepath.WalkDir(unpackedDir, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(unpackedDir, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if rel == DataDirName {
				return fs.SkipDir
			}
			return nil
		}
		if rel == DataDirName || strings.HasPrefix(rel, DataDirName+"/") || rel == ConfigFileName {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("staged update contains an unsupported file: %s", rel)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		plan = append(plan, PlanEntry{
			Rel:    rel,
			Source: current,
			Target: filepath.Join(programDir, filepath.FromSlash(rel)),
			Mode:   fileMode(rel, info.Mode()),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(plan) == 0 {
		return nil, errors.New("update package contains no files to install")
	}
	sort.Slice(plan, func(i, j int) bool { return plan[i].Rel < plan[j].Rel })
	return plan, nil
}

// replaceAll 逐个文件做原子替换（目标同目录写临时文件再改名）。
// 失败时逆序还原已替换的文件，返回已成功替换的数量。
func replaceAll(ctx context.Context, plan []PlanEntry) ([]PlanEntry, error) {
	replaced := make([]PlanEntry, 0, len(plan))
	for _, entry := range plan {
		if err := ctx.Err(); err != nil {
			restoreApplied(replaced)
			return nil, err
		}
		if err := replaceFile(entry.Source, entry.Target, entry.Mode); err != nil {
			restoreApplied(replaced)
			return nil, err
		}
		replaced = append(replaced, entry)
	}
	return replaced, nil
}

// restoreApplied 逆序把已替换的文件还原到替换前的状态。
func restoreApplied(replaced []PlanEntry) {
	for i := len(replaced) - 1; i >= 0; i-- {
		entry := replaced[i]
		if _, err := os.Stat(entry.Rollback); err == nil {
			_ = replaceFile(entry.Rollback, entry.Target, entry.Mode)
			continue
		}
		// 目标原本不存在，说明是这次更新新增的文件。
		_ = os.Remove(entry.Target)
	}
}

// replaceFile 把 source 写到 target 同目录的临时文件上再改名覆盖，保证替换是原子的。
func replaceFile(source, target string, mode fs.FileMode) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create program directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".javboss-update-")
	if err != nil {
		return fmt.Errorf("create update temporary file in %s: %w", dir, err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	in, err := os.Open(source)
	if err != nil {
		_ = temp.Close()
		return fmt.Errorf("open staged file %s: %w", filepath.Base(source), err)
	}
	_, copyErr := io.Copy(temp, in)
	_ = in.Close()
	closeErr := temp.Close()
	if copyErr != nil {
		return fmt.Errorf("write update file %s: %w", filepath.Base(target), copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("write update file %s: %w", filepath.Base(target), closeErr)
	}
	if err := os.Chmod(tempPath, mode); err != nil {
		return fmt.Errorf("set update file mode %s: %w", filepath.Base(target), err)
	}
	if err := os.Rename(tempPath, target); err != nil {
		return fmt.Errorf("replace %s: %w", filepath.Base(target), err)
	}
	return nil
}

// abortUpdate 给一次失败的更新收尾：清掉暂存、写 applied.json，并把原因返回给调用方。
// 替换过程中已经就地回滚过，这里只负责告知用户。
func abortUpdate(stageDir string, result AppliedResult, cause error) (AppliedResult, error) {
	result.Error = cause.Error()
	result.RestartNeeded = false
	if err := cleanStaging(stageDir); err != nil {
		result.Error = strings.TrimSpace(result.Error + "; " + err.Error())
	}
	if err := writeJSON(filepath.Join(stageDir, appliedFileName), result); err != nil {
		result.Error = strings.TrimSpace(result.Error + "; " + err.Error())
	}
	return result, cause
}

// cleanStaging 清掉更新暂存目录里的全部中间产物（解压结果、替换计划、回滚副本、
// 下载残留），只保留 applied.json —— 它要留给前端提示。keep 里的文件名不删。
func cleanStaging(stageDir string, keep ...string) error {
	entries, err := os.ReadDir(stageDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("clean update staging: %w", err)
	}
	kept := make(map[string]struct{}, len(keep)+1)
	kept[appliedFileName] = struct{}{}
	for _, name := range keep {
		kept[name] = struct{}{}
	}
	for _, entry := range entries {
		if _, ok := kept[entry.Name()]; ok {
			continue
		}
		if err := os.RemoveAll(filepath.Join(stageDir, entry.Name())); err != nil {
			return fmt.Errorf("clean update staging: %w", err)
		}
	}
	return nil
}

// latestRollbackDir 返回最新的回滚副本目录；一个都没有时返回空串。
func latestRollbackDir(stageDir string) (string, error) {
	entries, err := os.ReadDir(stageDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("read update staging: %w", err)
	}
	latest := ""
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), rollbackPrefix) {
			continue
		}
		// 目录名是时间戳，字典序即时间序。
		if entry.Name() > latest {
			latest = entry.Name()
		}
	}
	if latest == "" {
		return "", nil
	}
	return filepath.Join(stageDir, latest), nil
}

// storedPlan / storedEntry 是落盘的替换计划，只保留回滚需要的信息。
type storedPlan struct {
	Entries []storedEntry `json:"entries"`
}

type storedEntry struct {
	Rel  string `json:"rel"`
	Mode uint32 `json:"mode"`
	// Existing 表示替换前目标文件是否存在：存在的必须靠回滚副本还原，不存在的删掉即可。
	Existing bool `json:"existing"`
}

func readStoredPlan(stageDir string) (storedPlan, error) {
	var stored storedPlan
	err := readJSON(filepath.Join(stageDir, planFileName), &stored)
	if errors.Is(err, fs.ErrNotExist) {
		// 还没生成计划就中断了，没有需要回滚的东西。
		return storedPlan{}, nil
	}
	if err != nil {
		return storedPlan{}, err
	}
	return stored, nil
}

func checkWritable(dir string) error {
	file, err := os.CreateTemp(dir, ".javboss-update-test-")
	if err != nil {
		return fmt.Errorf("update: program directory is not writable: %w", err)
	}
	name := file.Name()
	_ = file.Close()
	_ = os.Remove(name)
	return nil
}

func readPending(stageDir string) (Pending, bool, error) {
	var pending Pending
	err := readJSON(filepath.Join(stageDir, pendingFileName), &pending)
	if errors.Is(err, fs.ErrNotExist) {
		return Pending{}, false, nil
	}
	if err != nil {
		return Pending{}, false, err
	}
	return pending, true, nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return nil
}

func writeJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode %s: %w", filepath.Base(path), err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create update staging directory: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}

// relativeInside 返回 target 相对 base 的斜杠路径；target 不在 base 内时返回空串。
func relativeInside(base, target string) string {
	rel, err := filepath.Rel(base, target)
	if err != nil || rel == "." {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return ""
	}
	return rel
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
