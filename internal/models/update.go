package models

import "time"

// UpdateSettings 是单例的程序更新设置：从哪读发布包列表。
type UpdateSettings struct {
	ID         int64     `json:"-" gorm:"primaryKey"`
	UpdatePath string    `json:"update_path" gorm:"not null;default:''"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// ConnectionID 指向 StorageConnection，表示 UpdatePath 是该 WebDAV 连接上的远程目录。
	// 为空表示 UpdatePath 是本机目录。
	// New columns must stay at the end of the struct so the migrated column order
	// matches migrations.
	ConnectionID *int64 `json:"connection_id"`
}
