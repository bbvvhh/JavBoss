package util

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// 这些测试锁定"不经过 exec.LookPath"的替代实现的行为。
// 背景：exec.LookPath 会对存在的候选走 faccessat2(AT_EACCESS)，Termux/Android 的
// seccomp 直接 SIGSYS 杀掉进程（详见 findExecutableByStat 注释）。
func TestFindExecutableByStat(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 没有 unix 执行位语义")
	}
	dir := t.TempDir()
	executable := filepath.Join(dir, "ffprobe")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write executable: %v", err)
	}
	plain := filepath.Join(dir, "plain.txt")
	if err := os.WriteFile(plain, []byte("x"), 0o644); err != nil {
		t.Fatalf("write plain: %v", err)
	}

	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{name: "executable", path: executable},
		{name: "not executable", path: plain, wantErr: true},
		{name: "directory", path: dir, wantErr: true},
		{name: "missing", path: filepath.Join(dir, "nope"), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := findExecutableByStat(tt.path)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("期望报错，实际返回 %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("意外错误: %v", err)
			}
			if got != tt.path {
				t.Fatalf("got %q want %q", got, tt.path)
			}
		})
	}
}

func TestFindExecutableInPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 没有 unix 执行位语义")
	}
	dir := t.TempDir()
	executable := filepath.Join(dir, "mpv")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write mpv: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+filepath.Join(dir, "missing-dir"))

	got, err := findExecutableInPath("mpv")
	if err != nil {
		t.Fatalf("PATH 查找失败: %v", err)
	}
	if got != executable {
		t.Fatalf("got %q want %q", got, executable)
	}

	if _, err := findExecutableInPath("definitely-not-here"); err == nil {
		t.Error("PATH 里不存在的命令应当报错")
	}
	// 带路径分隔符时只查这一个文件，不回落到 PATH。
	if _, err := findExecutableInPath(filepath.Join(dir, "missing")); err == nil {
		t.Error("带路径的缺失文件应当报错")
	}
}
