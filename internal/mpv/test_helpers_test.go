package mpv

import (
	"bufio"
	"encoding/json"
	"testing"
	"time"
)

// Shared MPV IPC helpers for the opt-in regression tests. They live outside the
// platform-tagged integration file so the subtitle regression test can run on
// every platform.

func readMPVTestProperty(t *testing.T, endpoint, name string) any {
	t.Helper()
	conn, err := dialPlatformMPVIPC(endpoint, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if conn, ok := conn.(interface{ SetDeadline(time.Time) error }); ok {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	}
	if err := json.NewEncoder(conn).Encode(map[string]any{"command": []any{"get_property", name}, "request_id": 1}); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			RequestID int `json:"request_id"`
			Data      any `json:"data"`
		}
		if err := json.Unmarshal(line, &response); err != nil {
			t.Fatal(err)
		}
		if response.RequestID == 1 {
			return response.Data
		}
	}
}

func waitMPVTestProperty(t *testing.T, endpoint, name string, expected any) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got := readMPVTestProperty(t, endpoint, name)
		if got == expected {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s=%v, want %v", name, got, expected)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
