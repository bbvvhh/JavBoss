package service

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/util"
)

// ErrJavScrapeBatchRunning is returned when a batch scrape is already active.
var ErrJavScrapeBatchRunning = errors.New("jav scrape batch is already running")

const (
	javScrapeBatchMaxErrors = 20
	javScrapeBatchPause     = 200 * time.Millisecond
)

// JavScrapeBatchStatus is the pollable progress report of the one-click scraper.
type JavScrapeBatchStatus struct {
	Running          bool     `json:"running"`
	Total            int      `json:"total"`
	Processed        int      `json:"processed"`
	Linked           int      `json:"linked"`
	Failed           int      `json:"failed"`
	CurrentCode      string   `json:"current_code"`
	CurrentFile      string   `json:"current_file"`
	Message          string   `json:"message"`
	Errors           []string `json:"errors"`
	StartedAtUnixMS  int64    `json:"started_at_unix_ms"`
	FinishedAtUnixMS int64    `json:"finished_at_unix_ms"`
}

var javScrapeBatchRunner = &javScrapeBatchState{}

type javScrapeBatchState struct {
	mu     sync.Mutex
	status JavScrapeBatchStatus
	cancel context.CancelFunc
}

// JavScrapeBatchSnapshot returns a snapshot of the current batch run.
func JavScrapeBatchSnapshot() JavScrapeBatchStatus {
	javScrapeBatchRunner.mu.Lock()
	defer javScrapeBatchRunner.mu.Unlock()
	return cloneJavScrapeBatchStatus(javScrapeBatchRunner.status)
}

// CancelJavScrapeBatch stops an in-flight batch run.
func CancelJavScrapeBatch() bool {
	javScrapeBatchRunner.mu.Lock()
	cancel := javScrapeBatchRunner.cancel
	javScrapeBatchRunner.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

// StartJavScrapeBatch launches the background scrape of every unscraped video.
//
// It walks active video locations that are not linked to JAV metadata yet and
// retries the same filename/provider matching a directory scan would run, so a
// user can re-attempt the videos that failed to match earlier. Locations whose
// video is explicitly marked ":skip" are left untouched.
func StartJavScrapeBatch() (JavScrapeBatchStatus, error) {
	javScrapeBatchRunner.mu.Lock()
	if javScrapeBatchRunner.status.Running {
		status := cloneJavScrapeBatchStatus(javScrapeBatchRunner.status)
		javScrapeBatchRunner.mu.Unlock()
		return status, ErrJavScrapeBatchRunning
	}
	ctx, cancel := context.WithCancel(context.Background())
	javScrapeBatchRunner.cancel = cancel
	javScrapeBatchRunner.status = JavScrapeBatchStatus{
		Running:         true,
		Errors:          []string{},
		Message:         "preparing",
		StartedAtUnixMS: time.Now().UnixMilli(),
	}
	status := cloneJavScrapeBatchStatus(javScrapeBatchRunner.status)
	javScrapeBatchRunner.mu.Unlock()

	go runJavScrapeBatch(ctx)
	return status, nil
}

func runJavScrapeBatch(ctx context.Context) {
	defer func() {
		if recovered := recover(); recovered != nil {
			logging.Error("jav scrape batch panicked: %v", recovered)
		}
		javScrapeBatchRunner.mu.Lock()
		javScrapeBatchRunner.cancel = nil
		javScrapeBatchRunner.mu.Unlock()
		updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
			status.Running = false
			status.CurrentCode = ""
			status.CurrentFile = ""
			status.FinishedAtUnixMS = time.Now().UnixMilli()
			if status.Message == "" || status.Message == "preparing" {
				status.Message = "done"
			}
		})
	}()

	locationIDs, err := dbpkg.ListUnscrapedVideoLocationIDs(ctx)
	if err != nil {
		logging.Error("list unscraped video locations failed: %v", err)
		updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
			status.Message = "load-targets-failed"
			status.Errors = appendJavScrapeBatchError(status.Errors, err.Error())
		})
		return
	}

	updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
		status.Total = len(locationIDs)
		status.Message = ""
	})

	for _, locationID := range locationIDs {
		if ctx.Err() != nil {
			updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
				status.Message = "canceled"
			})
			return
		}

		code, file := javScrapeBatchTarget(ctx, locationID)
		updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
			status.CurrentCode = code
			status.CurrentFile = file
		})

		linkErr := processVideoLocationJavLink(ctx, locationID)
		if ctx.Err() != nil {
			updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
				status.Message = "canceled"
			})
			return
		}

		// Read the persisted result: unmatched work counts as failed while a
		// location that became linked counts as scraped.
		linked := false
		if v, err := dbpkg.GetVideoForJavScan(ctx, locationID); err != nil {
			logging.Error("read jav scrape batch progress failed location=%d err=%v", locationID, err)
		} else if v != nil && v.JavID != nil {
			linked = true
		}

		updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
			status.Processed++
			if linked {
				status.Linked++
			} else {
				status.Failed++
				if linkErr != nil {
					status.Errors = appendJavScrapeBatchError(status.Errors, file+": "+linkErr.Error())
				}
			}
		})

		select {
		case <-ctx.Done():
			updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
				status.Message = "canceled"
			})
			return
		case <-time.After(javScrapeBatchPause):
		}
	}

	updateJavScrapeBatch(func(status *JavScrapeBatchStatus) {
		status.Message = "done"
	})
}

// javScrapeBatchTarget returns a display code and file name for progress reporting.
func javScrapeBatchTarget(ctx context.Context, locationID int64) (string, string) {
	v, err := dbpkg.GetVideoForJavScan(ctx, locationID)
	if err != nil || v == nil {
		return "", ""
	}
	filename := filepath.Base(filepath.FromSlash(v.Filename))
	code := ""
	if codes := util.ExtractCodeFromName(filename); len(codes) > 0 {
		code = strings.ToUpper(strings.TrimSpace(codes[0]))
	}
	return code, filename
}

func updateJavScrapeBatch(mutate func(status *JavScrapeBatchStatus)) {
	javScrapeBatchRunner.mu.Lock()
	defer javScrapeBatchRunner.mu.Unlock()
	mutate(&javScrapeBatchRunner.status)
}

func appendJavScrapeBatchError(existing []string, message string) []string {
	message = strings.TrimSpace(message)
	if message == "" {
		return existing
	}
	existing = append(existing, message)
	if len(existing) > javScrapeBatchMaxErrors {
		existing = existing[len(existing)-javScrapeBatchMaxErrors:]
	}
	return existing
}

func cloneJavScrapeBatchStatus(status JavScrapeBatchStatus) JavScrapeBatchStatus {
	clone := status
	clone.Errors = append([]string{}, status.Errors...)
	return clone
}
