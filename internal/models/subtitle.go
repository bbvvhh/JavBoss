package models

import "time"

// Subtitle container formats understood by the downloader and the player.
const (
	VideoSubtitleFormatSRT = "srt"
	VideoSubtitleFormatVTT = "vtt"
	VideoSubtitleFormatASS = "ass"
	VideoSubtitleFormatSSA = "ssa"
)

// VideoSubtitle is one subtitle file downloaded into JavBoss' own data
// directory and linked to a video. A single video can own many subtitles
// (different providers, languages or releases), so the relation is 1-N.
//
// Files live in <dataDir>/subtitle/<video_id>/ and are never written next to the
// user's video files, keeping the project's zero-intrusion rule intact.
type VideoSubtitle struct {
	ID       int64  `json:"id" gorm:"primaryKey"`
	VideoID  int64  `json:"video_id" gorm:"index;not null"`
	Filename string `json:"filename" gorm:"not null;default:''"`
	// Title is the human readable name reported by the search provider.
	Title      string    `json:"title" gorm:"not null;default:''"`
	Language   string    `json:"language" gorm:"not null;default:''"`
	Format     string    `json:"format" gorm:"not null;default:''"`
	DurationMS int64     `json:"duration_ms" gorm:"not null;default:0"`
	Size       int64     `json:"size" gorm:"not null;default:0"`
	Auto       bool      `json:"auto" gorm:"not null;default:false"`
	SourceID   string    `json:"source_id" gorm:"not null;default:''"`
	SourceURL  string    `json:"-" gorm:"type:text;not null;default:''"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}
