//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

const (
	// helperScriptName 是退出后接手替换的批处理脚本。
	helperScriptName = "apply-update.cmd"
	// appliedOKName / appliedErrorName 是预先写好的两种结果，helper 二选一覆盖到 applied.json。
	appliedOKName    = "applied-ok.json"
	appliedErrorName = "applied-error.json"
	// exitDelay 是退出前留给响应字节真正出网的时间。
	exitDelay = 300 * time.Millisecond
)

// platformApply 在 Windows 上不能覆盖运行中的 exe（文件被占用），
// 于是生成一个 helper 脚本并 detached 启动：它等本进程退出后再替换文件，然后写下结果。
//
// 结果不在这里返回给用户，而是留给下一次启动（见 HandleStartup）。
func platformApply(ctx context.Context, opts ApplyOptions, plan []PlanEntry, result AppliedResult) (AppliedResult, error) {
	stageDir := UpdateDir(opts.DataDir)
	rollbackDir, err := latestRollbackDir(stageDir)
	if err != nil {
		return AppliedResult{}, err
	}

	okResult := result
	okResult.Deferred = true
	errResult := result
	errResult.RestartNeeded = false
	errResult.Deferred = true
	errResult.Error = "更新包替换失败，已回滚到原版本；请重新启动 JavBoss 后重试"
	if err := writeJSON(filepath.Join(stageDir, appliedOKName), okResult); err != nil {
		return AppliedResult{}, err
	}
	if err := writeJSON(filepath.Join(stageDir, appliedErrorName), errResult); err != nil {
		return AppliedResult{}, err
	}

	script := helperScript(stageDir, opts, rollbackDir)
	scriptPath := filepath.Join(stageDir, helperScriptName)
	if err := os.WriteFile(scriptPath, []byte(script), 0o644); err != nil {
		return AppliedResult{}, fmt.Errorf("write update helper: %w", err)
	}
	if err := launchHelper(scriptPath, stageDir); err != nil {
		return AppliedResult{}, err
	}

	// 退出时机不在这里定：必须等本次 HTTP 响应完整写出去之后，
	// 由调用方调用 ExitForUpdate（见 internal/server/update_api.go）。
	result.Deferred = true
	return result, nil
}

// ExitForUpdate 让本进程退出，把被占用的程序文件交还给更新 helper。
// 只能在本进程的响应已经完整写出之后调用，否则客户端会拿到截断的响应。
// Windows 上不返回。
func ExitForUpdate() {
	time.Sleep(exitDelay)
	os.Exit(0)
}

// helperScript 生成替换脚本。
//
// 用 robocopy 而不是 xcopy：它按目录同步、能跳过被排除的文件，而且返回码能区分
// 「复制成功」与「有文件复制失败」（>=8 才算失败）。
func helperScript(stageDir string, opts ApplyOptions, rollbackDir string) string {
	var builder strings.Builder
	builder.WriteString("@echo off\r\n")
	builder.WriteString("rem JavBoss 程序更新：等旧进程退出后替换程序目录里的文件，然后写下结果。\r\n")
	builder.WriteString("setlocal\r\n")
	fmt.Fprintf(&builder, "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Wait-Process -Id %d -ErrorAction SilentlyContinue\"\r\n", os.Getpid())

	unpackedDir := filepath.Join(stageDir, unpackedDirName)
	fmt.Fprintf(&builder, "robocopy \"%s\" \"%s\" /E /XD \"%s\" /XF \"%s\" /NFL /NDL /NJH /NJS /NP /R:2 /W:1\r\n",
		unpackedDir, opts.ProgramDir, filepath.Join(opts.ProgramDir, DataDirName), ConfigFileName)
	builder.WriteString("if errorlevel 8 goto rollback\r\n")
	fmt.Fprintf(&builder, "copy /Y \"%s\" \"%s\" >nul\r\n", filepath.Join(stageDir, appliedOKName), filepath.Join(stageDir, appliedFileName))
	builder.WriteString("goto done\r\n")
	builder.WriteString(":rollback\r\n")
	if rollbackDir != "" {
		fmt.Fprintf(&builder, "robocopy \"%s\" \"%s\" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1\r\n", rollbackDir, opts.ProgramDir)
	}
	fmt.Fprintf(&builder, "copy /Y \"%s\" \"%s\" >nul\r\n", filepath.Join(stageDir, appliedErrorName), filepath.Join(stageDir, appliedFileName))
	builder.WriteString(":done\r\n")
	// pending.json 是最后一个动作：它一消失，就表示这次更新已经有结论了。
	fmt.Fprintf(&builder, "del \"%s\" >nul 2>nul\r\n", filepath.Join(stageDir, pendingFileName))
	builder.WriteString("endlocal\r\n")
	return builder.String()
}

// launchHelper 用 detached 方式启动 helper：不继承控制台、不随本进程退出而被带走，也不等待它。
func launchHelper(scriptPath, workDir string) error {
	command := exec.Command("cmd.exe", "/C", filepath.Base(scriptPath))
	command.Dir = workDir
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS | windows.CREATE_BREAKAWAY_FROM_JOB,
	}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start update helper: %w", err)
	}
	// 不 Wait：helper 要等本进程退出后才动手，等它就会死锁。
	if err := command.Process.Release(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return fmt.Errorf("release update helper: %w", err)
	}
	return nil
}
