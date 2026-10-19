package models

import "time"

// WatchLater 是「稍后观看」列表的一项。
//
// video_id 唯一：一个视频文件最多只在列表里出现一次，重复加入是幂等的。
// 与 PlaybackHistory 独立：观看记录记录播放进度，稍后观看只表示用户想稍后再看。
type WatchLater struct {
	ID        int64     `json:"id" gorm:"primaryKey"`
	VideoID   int64     `json:"video_id" gorm:"uniqueIndex;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// WatchLaterItem 是稍后观看列表接口的一行：加入记录 + 该视频的展示载荷。
// 视频载荷与 /videos、/playback/history 同源，前端可直接复用原有字段。
type WatchLaterItem struct {
	VideoID   int64     `json:"video_id"`
	CreatedAt time.Time `json:"created_at"`
	Video     Video     `json:"video"`
}
