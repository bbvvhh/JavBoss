package runtimeconfig

import (
	"os"
	"strings"
)

func envBool(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// ContainerMode reports whether JavBoss is running in a container-oriented mode.
func ContainerMode() bool {
	return envBool("JAVBOSS_CONTAINER") || envBool("JAVBOSS_DOCKER")
}

// TermuxMode reports whether we are running inside Termux on Android.
//
// 除了没有桌面环境与 mpv，Android 应用沙箱的 seccomp 过滤器（Termux 的 targetSdk 是 28）
// 会直接 SECCOMP_RET_TRAP 掉 faccessat2(2) 这类较新的 syscall。Go 的 os/exec.LookPath
// 判断可执行位时走 AT_EACCESS → faccessat2，被 trap 后进程以 "SIGSYS: bad system call"
// 整体崩溃（不是 EPERM/ENOSYS，没有回退机会），所以 Termux 一律按无桌面集成、无 mpv 处理。
func TermuxMode() bool {
	if os.Getenv("TERMUX_VERSION") != "" {
		return true
	}
	return strings.Contains(os.Getenv("PREFIX"), "com.termux")
}

func DisableDirectoryPicker() bool {
	return envBool("JAVBOSS_DISABLE_DIRECTORY_PICKER")
}

func DisableDesktopIntegration() bool {
	return ContainerMode() || TermuxMode() || envBool("JAVBOSS_DISABLE_DESKTOP_INTEGRATION")
}

func DisableMPVPlayback() bool {
	return ContainerMode() || TermuxMode() || envBool("JAVBOSS_DISABLE_MPV")
}

func UseFFmpegScreenshots() bool {
	return ContainerMode() || TermuxMode() || envBool("JAVBOSS_USE_FFMPEG_SCREENSHOTS")
}

func HostPathPrefixEnabled() bool {
	return envBool("JAVBOSS_HOST_PATH_PREFIX")
}

func ProxyHostGatewayEnabled() bool {
	return envBool("JAVBOSS_PROXY_HOST_GATEWAY")
}
