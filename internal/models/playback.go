package models

import "time"

// PlaybackHistory 是「某个视频文件的最近一次播放进度」。
//
// video_id 唯一：一个视频文件（含 JAV 作品下的每个视频文件）只保留一条最新记录，
// 记录总量天然被视频总数封顶，所以可以一直保存而不会无限增长。
//
// 注意这里只覆盖浏览器内的播放（PC 端 PlayerModal、移动端 PlayerPage）；
// 用 MPV 播放时进度由 MPV 自己的 save-position-on-quit 负责，不写入本表。
type PlaybackHistory struct {
	ID      int64 `json:"id" gorm:"primaryKey"`
	VideoID int64 `json:"video_id" gorm:"uniqueIndex;not null"`
	// LocationID 是上报进度时正在播放的那个文件位置，用于多文件场景下还原来源。
	LocationID  int64     `json:"location_id" gorm:"not null;default:0"`
	PositionSec float64   `json:"position_sec" gorm:"not null;default:0"`
	DurationSec int64     `json:"duration_sec" gorm:"not null;default:0"`
	PlayedAt    time.Time `json:"played_at" gorm:"index"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PlaybackHistoryItem 是播放记录列表接口的一行：进度记录 + 该视频的展示载荷。
// 视频载荷与 /videos 列表同源（videoFromLocation 组装），前端可直接复用原有字段。
type PlaybackHistoryItem struct {
	VideoID     int64     `json:"video_id"`
	LocationID  int64     `json:"location_id"`
	PositionSec float64   `json:"position_sec"`
	DurationSec int64     `json:"duration_sec"`
	PlayedAt    time.Time `json:"played_at"`
	Video       Video     `json:"video"`
}
