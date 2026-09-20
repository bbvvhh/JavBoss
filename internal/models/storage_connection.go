package models

import "time"

// StorageConnection stores the endpoint and credentials for one remote video
// source. Credentials are never returned by the API (Password is json:"-").
type StorageConnection struct {
	ID        int64     `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"not null;uniqueIndex"`
	URL       string    `json:"url" gorm:"not null"`
	Username  string    `json:"username" gorm:"not null"`
	Password  string    `json:"-" gorm:"not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// DirectoryCount and HasPassword are computed for API responses only.
	DirectoryCount int64 `json:"directory_count" gorm:"->;-:migration"`
	HasPassword    bool  `json:"has_password" gorm:"->;-:migration"`
}
