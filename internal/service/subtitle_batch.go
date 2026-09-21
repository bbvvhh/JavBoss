package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/subtitle"
)

// ErrSubtitleBatchRunning is returned when a batch download is already active.
var ErrSubtitleBatchRunning = errors.New("subtitle batch download is already running")

const (
	subtitleBatchMaxErrors = 20
	subtitleBatchPause     = 300 * time.Millisecond
)

// SubtitleBatchOptions controls one run of the one-click subtitle downloader.
type SubtitleBatchOptions struct {
	// APIURL overrides the configured endpoint. Empty means "use the config value".
	APIURL string
	// Overwrite re-downloads videos that already own subtitles.
	Overwrite bool
	// Limit stops after this many videos (0 = no limit).
	Limit int
}

// SubtitleBatchStatus is the pollable progress report of the batch downloader.
type SubtitleBatchStatus struct {
	Running          bool     `json:"running"`
	Total            int      `json:"total"`
	Processed        int      `json:"processed"`
	Succeeded        int      `json:"succeeded"`
	Skipped          int      `json:"skipped"`
	Failed           int      `json:"failed"`
	Overwrite        bool     `json:"overwrite"`
	APIURL           string   `json:"api_url"`
	CurrentCode      string   `json:"current_code"`
	CurrentFile      string   `json:"current_file"`
	CurrentStage     string   `json:"current_stage"`
	Message          string   `json:"message"`
	Errors           []string `json:"errors"`
	StartedAtUnixMS  int64    `json:"started_at_unix_ms"`
	FinishedAtUnixMS int64    `json:"finished_at_unix_ms"`
}

var subtitleBatchRunner = &subtitleBatchState{}

type subtitleBatchState struct {
	mu     sync.Mutex
	status SubtitleBatchStatus
	cancel context.CancelFunc
}

// SubtitleBatchDownloadStatus returns a snapshot of the current batch run.
func SubtitleBatchDownloadStatus() SubtitleBatchStatus {
	subtitleBatchRunner.mu.Lock()
	defer subtitleBatchRunner.mu.Unlock()
	return cloneSubtitleBatchStatus(subtitleBatchRunner.status)
}

// CancelSubtitleBatchDownload stops an in-flight batch run.
func CancelSubtitleBatchDownload() bool {
	subtitleBatchRunner.mu.Lock()
	cancel := subtitleBatchRunner.cancel
	subtitleBatchRunner.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

// StartSubtitleBatchDownload launches the background batch run.
//
// The downloader walks every visible video that is linked to a JAV code, asks
// the provider for that code and stores the best matching subtitle: an exact
// file name match wins, then a partial name match, and ties are broken by the
// smallest difference between the video and subtitle duration.
func StartSubtitleBatchDownload(opts SubtitleBatchOptions) (SubtitleBatchStatus, error) {
	subtitleBatchRunner.mu.Lock()
	if subtitleBatchRunner.status.Running {
		status := cloneSubtitleBatchStatus(subtitleBatchRunner.status)
		subtitleBatchRunner.mu.Unlock()
		return status, ErrSubtitleBatchRunning
	}
	ctx, cancel := context.WithCancel(context.Background())
	subtitleBatchRunner.cancel = cancel
	subtitleBatchRunner.status = SubtitleBatchStatus{
		Running:         true,
		Overwrite:       opts.Overwrite,
		APIURL:          opts.APIURL,
		CurrentStage:    "preparing",
		Message:         "",
		Errors:          []string{},
		StartedAtUnixMS: time.Now().UnixMilli(),
	}
	status := cloneSubtitleBatchStatus(subtitleBatchRunner.status)
	subtitleBatchRunner.mu.Unlock()

	go runSubtitleBatchDownload(ctx, opts)
	return status, nil
}

func runSubtitleBatchDownload(ctx context.Context, opts SubtitleBatchOptions) {
	defer func() {
		if recovered := recover(); recovered != nil {
			logging.Error("subtitle batch download panicked: %v", recovered)
		}
		subtitleBatchRunner.mu.Lock()
		subtitleBatchRunner.cancel = nil
		subtitleBatchRunner.status.Running = false
		subtitleBatchRunner.status.CurrentCode = ""
		subtitleBatchRunner.status.CurrentFile = ""
		subtitleBatchRunner.status.CurrentStage = ""
		subtitleBatchRunner.status.FinishedAtUnixMS = time.Now().UnixMilli()
		if subtitleBatchRunner.status.Message == "" {
			subtitleBatchRunner.status.Message = "done"
		}
		subtitleBatchRunner.mu.Unlock()
	}()

	apiURL := strings.TrimSpace(opts.APIURL)
	if apiURL == "" {
		apiURL = ConfiguredSubtitleAPIURL(ctx)
	}

	targets, err := dbpkg.ListSubtitleBatchTargets(ctx)
	if err != nil {
		logging.Error("list subtitle batch targets failed: %v", err)
		updateSubtitleBatch(func(status *SubtitleBatchStatus) {
			status.Message = "load-targets-failed"
			status.Errors = appendSubtitleBatchError(status.Errors, err.Error())
		})
		return
	}
	if opts.Limit > 0 && len(targets) > opts.Limit {
		targets = targets[:opts.Limit]
	}

	videoIDs := make([]int64, 0, len(targets))
	for _, target := range targets {
		videoIDs = append(videoIDs, target.VideoID)
	}
	counts, err := dbpkg.CountVideoSubtitlesByVideoIDs(ctx, videoIDs)
	if err != nil {
		logging.Error("count existing video subtitles failed: %v", err)
		counts = map[int64]int{}
	}

	updateSubtitleBatch(func(status *SubtitleBatchStatus) {
		status.Total = len(targets)
		status.APIURL = apiURL
		status.CurrentStage = "searching"
		status.Message = ""
	})

	for _, target := range targets {
		if ctx.Err() != nil {
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Message = "canceled"
			})
			return
		}
		if !opts.Overwrite && counts[target.VideoID] > 0 {
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Processed++
				status.Skipped++
				status.CurrentCode = target.Code
				status.CurrentFile = target.Filename
				status.CurrentStage = "skipped"
			})
			continue
		}

		updateSubtitleBatch(func(status *SubtitleBatchStatus) {
			status.CurrentCode = target.Code
			status.CurrentFile = target.Filename
			status.CurrentStage = "searching"
		})

		result, err := downloadBestSubtitleForTarget(ctx, apiURL, target)
		if err != nil {
			if ctx.Err() != nil {
				updateSubtitleBatch(func(status *SubtitleBatchStatus) {
					status.Message = "canceled"
				})
				return
			}
			logging.Error("subtitle batch download failed (video_id=%d, code=%s): %v", target.VideoID, target.Code, err)
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Processed++
				status.Failed++
				status.Errors = appendSubtitleBatchError(
					status.Errors,
					target.Code+" ("+target.Filename+"): "+err.Error(),
				)
			})
		} else if !result {
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Processed++
				status.Skipped++
			})
		} else {
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Processed++
				status.Succeeded++
			})
		}

		select {
		case <-ctx.Done():
			updateSubtitleBatch(func(status *SubtitleBatchStatus) {
				status.Message = "canceled"
			})
			return
		case <-time.After(subtitleBatchPause):
		}
	}

	updateSubtitleBatch(func(status *SubtitleBatchStatus) {
		status.Message = "done"
		status.CurrentStage = ""
	})
}

// downloadBestSubtitleForTarget returns true when a subtitle was stored.
func downloadBestSubtitleForTarget(ctx context.Context, apiURL string, target dbpkg.SubtitleBatchTarget) (bool, error) {
	results, err := subtitle.Search(ctx, apiURL, target.Code)
	if err != nil {
		return false, err
	}
	best, ok := subtitle.PickBest(results, target.Filename, target.DurationSec*1000)
	if !ok {
		return false, nil
	}
	request := SubtitleDownloadRequest{
		URL:        best.URL,
		Name:       best.Name,
		Ext:        best.Ext,
		Language:   best.Language(),
		DurationMS: best.DurationMS,
		SourceID:   best.SourceID,
		Auto:       true,
	}
	updateSubtitleBatch(func(status *SubtitleBatchStatus) {
		status.CurrentStage = "downloading"
	})
	if _, _, err := DownloadAndStoreVideoSubtitle(ctx, target.VideoID, request); err != nil {
		return false, err
	}
	return true, nil
}

func updateSubtitleBatch(mutate func(status *SubtitleBatchStatus)) {
	subtitleBatchRunner.mu.Lock()
	defer subtitleBatchRunner.mu.Unlock()
	mutate(&subtitleBatchRunner.status)
}

func appendSubtitleBatchError(existing []string, message string) []string {
	message = strings.TrimSpace(message)
	if message == "" {
		return existing
	}
	existing = append(existing, message)
	if len(existing) > subtitleBatchMaxErrors {
		existing = existing[len(existing)-subtitleBatchMaxErrors:]
	}
	return existing
}

func cloneSubtitleBatchStatus(status SubtitleBatchStatus) SubtitleBatchStatus {
	clone := status
	clone.Errors = append([]string{}, status.Errors...)
	return clone
}
