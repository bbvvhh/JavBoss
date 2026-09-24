//go:build windows

package update

import (
	"strings"
	"testing"
)

// TestHelperScriptKeepsDataAndConfig 覆盖 Windows 上真正执行替换的那段批处理：
// 它必须排除 data 目录与 config.toml，并在失败时用回滚副本还原。
func TestHelperScriptKeepsDataAndConfig(t *testing.T) {
	stageDir := `C:\javboss\data\update`
	opts := ApplyOptions{DataDir: `C:\javboss\data`, ProgramDir: `C:\javboss\app`}
	script := helperScript(stageDir, opts, `C:\javboss\data\update\backup-20260924-101010`)

	for _, want := range []string{
		// 等旧进程退出后再替换，否则 javboss.exe 被占用。
		"Wait-Process -Id ",
		// 排除 data 目录与本地配置。
		`/XD "C:\javboss\app\data"`,
		`/XF "config.toml"`,
		// 成功/失败两条路都要写下结论，并清掉 pending。
		appliedOKName,
		appliedErrorName,
		`del "C:\javboss\data\update\pending.json"`,
		// 失败时用回滚副本还原程序目录。
		`robocopy "C:\javboss\data\update\backup-20260924-101010" "C:\javboss\app"`,
	} {
		if !strings.Contains(script, want) {
			t.Errorf("helper script does not contain %q:\n%s", want, script)
		}
	}
}

// TestHelperScriptWithoutRollbackCopies 覆盖「回滚副本还没生成」的极端情况：
// 这时不能生成任何删除/还原程序文件的动作。
func TestHelperScriptWithoutRollbackCopies(t *testing.T) {
	script := helperScript(`C:\javboss\data\update`, ApplyOptions{
		DataDir: `C:\javboss\data`, ProgramDir: `C:\javboss\app`,
	}, "")
	if strings.Contains(script, `robocopy "" `) {
		t.Fatalf("helper script must not restore without a rollback directory:\n%s", script)
	}
	if !strings.Contains(script, appliedErrorName) {
		t.Fatalf("helper script must still report the failure:\n%s", script)
	}
}
