package runtimeconfig

import "testing"

func TestTermuxModeDetection(t *testing.T) {
	t.Setenv("TERMUX_VERSION", "")
	t.Setenv("PREFIX", "")
	if TermuxMode() {
		t.Error("干净环境不应被判定为 Termux")
	}

	t.Setenv("TERMUX_VERSION", "0.118.0")
	if !TermuxMode() {
		t.Error("TERMUX_VERSION 非空应判定为 Termux")
	}

	t.Setenv("TERMUX_VERSION", "")
	t.Setenv("PREFIX", "/data/data/com.termux/files/usr")
	if !TermuxMode() {
		t.Error("PREFIX 含 com.termux 应判定为 Termux")
	}
}

func TestTermuxDisablesDesktopAndMPV(t *testing.T) {
	t.Setenv("TERMUX_VERSION", "0.118.0")
	for _, name := range []string{
		"JAVBOSS_CONTAINER",
		"JAVBOSS_DOCKER",
		"JAVBOSS_DISABLE_DESKTOP_INTEGRATION",
		"JAVBOSS_DISABLE_MPV",
		"JAVBOSS_USE_FFMPEG_SCREENSHOTS",
	} {
		t.Setenv(name, "")
	}

	if !DisableDesktopIntegration() {
		t.Error("Termux 下应禁用桌面集成（否则会走 xdg-open 的 LookPath → faccessat2）")
	}
	if !DisableMPVPlayback() {
		t.Error("Termux 下应禁用 mpv")
	}
	if !UseFFmpegScreenshots() {
		t.Error("Termux 下截图应走 ffmpeg")
	}
}

func TestExplicitFlagsStillWork(t *testing.T) {
	t.Setenv("TERMUX_VERSION", "")
	t.Setenv("PREFIX", "")
	t.Setenv("JAVBOSS_DISABLE_DESKTOP_INTEGRATION", "1")
	t.Setenv("JAVBOSS_DISABLE_MPV", "1")
	if !DisableDesktopIntegration() {
		t.Error("JAVBOSS_DISABLE_DESKTOP_INTEGRATION=1 应生效")
	}
	if !DisableMPVPlayback() {
		t.Error("JAVBOSS_DISABLE_MPV=1 应生效")
	}
}
