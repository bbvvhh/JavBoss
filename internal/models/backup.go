package models

import "time"

// BackupSettings contains the singleton data backup/restore settings.
// Password 单独存在这张表里，不能进 config 表 —— GET /config 会把整张表原样返回。
type BackupSettings struct {
	ID         int64     `json:"-" gorm:"primaryKey"`
	BackupPath string    `json:"backup_path" gorm:"not null;default:''"`
	Password   string    `json:"-" gorm:"type:text;not null;default:''"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// ConnectionID 指向 StorageConnection，表示备份写到该 WebDAV 连接的 BackupPath
	// 远程目录里（比如直接把备份存到 WebDAV 上）。为空表示 BackupPath 是本机目录。
	// New columns must stay at the end of the struct so the migrated column order
	// matches migrations.
	ConnectionID *int64 `json:"connection_id"`
}
