package common

import (
	"javboss/internal/manager"

	"gorm.io/gorm"
)

// Shared application-wide dependencies.
var (
	DB                *gorm.DB
	ScreenshotManager *manager.ScreenshotManager
	CoverManager      *manager.CoverManager
	StreamManager     *manager.StreamManager
	FFmpegToolManager *manager.FFmpegToolManager
	AppConfig         *Config
	// BaseDir 是程序文件所在目录（发布模式下是可执行文件目录）。程序自更新覆盖的就是它。
	BaseDir string
)
