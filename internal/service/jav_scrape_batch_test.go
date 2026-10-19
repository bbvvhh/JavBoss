package service

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/db"
)

func resetJavScrapeBatchRunner(t *testing.T) {
	t.Helper()
	_ = CancelJavScrapeBatch()
	javScrapeBatchRunner.mu.Lock()
	javScrapeBatchRunner.status = JavScrapeBatchStatus{}
	javScrapeBatchRunner.cancel = nil
	javScrapeBatchRunner.mu.Unlock()
}

func TestStartJavScrapeBatchRejectsConcurrentRuns(t *testing.T) {
	resetJavScrapeBatchRunner(t)
	defer resetJavScrapeBatchRunner(t)

	javScrapeBatchRunner.mu.Lock()
	javScrapeBatchRunner.status = JavScrapeBatchStatus{Running: true, Total: 3}
	javScrapeBatchRunner.mu.Unlock()

	status, err := StartJavScrapeBatch()
	if !errors.Is(err, ErrJavScrapeBatchRunning) {
		t.Fatalf("StartJavScrapeBatch error = %v, want ErrJavScrapeBatchRunning", err)
	}
	if !status.Running || status.Total != 3 {
		t.Fatalf("running status = %+v, want running=true total=3", status)
	}
}

func TestStartJavScrapeBatchFinishesOnEmptyLibrary(t *testing.T) {
	gdb, err := db.Open(filepath.Join(t.TempDir(), "jav-scrape-batch.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := gdb.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	resetJavScrapeBatchRunner(t)
	defer resetJavScrapeBatchRunner(t)

	status, err := StartJavScrapeBatch()
	if err != nil {
		t.Fatalf("StartJavScrapeBatch error = %v", err)
	}
	if !status.Running {
		t.Fatalf("status after start = %+v, want running", status)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !JavScrapeBatchSnapshot().Running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	done := JavScrapeBatchSnapshot()
	if done.Running {
		t.Fatalf("job still running after deadline: %+v", done)
	}
	if done.Total != 0 || done.Processed != 0 || done.Linked != 0 || done.Failed != 0 {
		t.Fatalf("unexpected counters: %+v", done)
	}
	if done.Message != "done" {
		t.Fatalf("message = %q, want done", done.Message)
	}
}
