package db

import (
	"context"
	"errors"
	"testing"
	"time"

	"javboss/internal/models"
	"javboss/internal/storage"
)

func strPtr(value string) *string { return &value }

func TestStorageConnectionLifecycle(t *testing.T) {
	openTestDB(t)
	ctx := context.Background()

	created, err := CreateStorageConnection(ctx, StorageConnectionInput{
		Name:     strPtr("  my dav  "),
		URL:      strPtr("dav.example.com/dav/"),
		Username: strPtr("user"),
		Password: strPtr("secret"),
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	if created.Name != "my dav" {
		t.Fatalf("name should be trimmed: %q", created.Name)
	}
	if created.URL != "http://dav.example.com/dav" {
		t.Fatalf("url should be normalized: %q", created.URL)
	}

	if _, err := CreateStorageConnection(ctx, StorageConnectionInput{Name: strPtr("my dav"), URL: strPtr("http://other")}); err == nil {
		t.Fatal("duplicate connection names must be rejected")
	}

	listed, err := ListStorageConnections(ctx)
	if err != nil {
		t.Fatalf("list connections: %v", err)
	}
	if len(listed) != 1 || !listed[0].HasPassword || listed[0].DirectoryCount != 0 {
		t.Fatalf("unexpected listing: %#v", listed)
	}

	updated, err := UpdateStorageConnection(ctx, created.ID, StorageConnectionInput{Username: strPtr("other")})
	if err != nil {
		t.Fatalf("update connection: %v", err)
	}
	if updated.Username != "other" || updated.Password != "secret" {
		t.Fatalf("partial update must keep the password: %#v", updated)
	}

	if err := DeleteStorageConnection(ctx, created.ID); err != nil {
		t.Fatalf("delete connection: %v", err)
	}
	if err := DeleteStorageConnection(ctx, created.ID); !errors.Is(err, ErrStorageConnectionNotFound) {
		t.Fatalf("deleting twice = %v, want ErrStorageConnectionNotFound", err)
	}
}

func TestDeleteStorageConnectionBlockedWhileInUse(t *testing.T) {
	openTestDB(t)
	ctx := context.Background()

	connection, err := CreateStorageConnection(ctx, StorageConnectionInput{
		Name: strPtr("busy"),
		URL:  strPtr("http://dav.example.com/dav"),
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	connectionID := connection.ID
	if _, err := CreateDirectoryFromSource(ctx, DirectorySource{
		Kind:         storage.KindWebDAV,
		Path:         "/library",
		ConnectionID: &connectionID,
	}); err != nil {
		t.Fatalf("create remote directory: %v", err)
	}

	if err := DeleteStorageConnection(ctx, connection.ID); !errors.Is(err, ErrStorageConnectionInUse) {
		t.Fatalf("delete in-use connection = %v, want ErrStorageConnectionInUse", err)
	}
}

func TestCreateRemoteDirectoryStoresIdentityPath(t *testing.T) {
	openTestDB(t)
	ctx := context.Background()

	connection, err := CreateStorageConnection(ctx, StorageConnectionInput{
		Name: strPtr("dav"),
		URL:  strPtr("https://dav.example.com/dav"),
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	connectionID := connection.ID

	dir, err := CreateDirectoryFromSource(ctx, DirectorySource{
		Kind:         storage.KindWebDAV,
		Path:         "library/hd/",
		ConnectionID: &connectionID,
	})
	if err != nil {
		t.Fatalf("create remote directory: %v", err)
	}
	if dir.Kind != storage.KindWebDAV {
		t.Fatalf("kind = %q", dir.Kind)
	}
	if dir.RemotePath != "/library/hd" {
		t.Fatalf("remote path = %q, want /library/hd", dir.RemotePath)
	}
	if dir.Path != "webdav://1/library/hd" {
		t.Fatalf("identity path = %q", dir.Path)
	}
	if dir.ConnectionID == nil || *dir.ConnectionID != connectionID {
		t.Fatalf("connection id not stored: %#v", dir.ConnectionID)
	}

	if _, err := CreateDirectoryFromSource(ctx, DirectorySource{Kind: storage.KindWebDAV, Path: "/x"}); err == nil {
		t.Fatal("a remote directory without a connection must be rejected")
	}
	missing := int64(9999)
	if _, err := CreateDirectoryFromSource(ctx, DirectorySource{
		Kind: storage.KindWebDAV, Path: "/x", ConnectionID: &missing,
	}); !errors.Is(err, ErrStorageConnectionNotFound) {
		t.Fatalf("unknown connection = %v, want ErrStorageConnectionNotFound", err)
	}
}

// Switching an existing local directory to WebDAV must keep its video locations
// and the videos they point at: this is what makes the migration seamless.
func TestSwitchLocalDirectoryToWebDAVKeepsVideos(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	localRoot := t.TempDir()
	local, err := CreateDirectoryFromSource(ctx, DirectorySource{Kind: storage.KindLocal, Path: localRoot})
	if err != nil {
		t.Fatalf("create local directory: %v", err)
	}
	if local.Kind != storage.KindLocal || local.RemotePath != "" {
		t.Fatalf("unexpected local directory: %#v", local)
	}

	video := models.Video{Fingerprint: "switch-keeps-videos", Size: 2048, DurationSec: 600}
	if err := gdb.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc, err := UpsertVideoLocation(ctx, video.ID, local.ID, "JAV/IPX/IPX-001/movie.mp4", now)
	if err != nil {
		t.Fatalf("upsert location: %v", err)
	}
	jav := models.Jav{Code: "IPX-001"}
	if err := gdb.Create(&jav).Error; err != nil {
		t.Fatalf("create jav: %v", err)
	}
	if err := gdb.Model(&models.VideoLocation{}).
		Where("id = ?", loc.ID).
		Update("jav_id", jav.ID).Error; err != nil {
		t.Fatalf("link jav: %v", err)
	}

	connection, err := CreateStorageConnection(ctx, StorageConnectionInput{
		Name: strPtr("dav"), URL: strPtr("https://dav.example.com/dav"),
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	connectionID := connection.ID

	switched, err := UpdateDirectorySource(ctx, local.ID, &DirectorySource{
		Kind:         storage.KindWebDAV,
		Path:         "/JAV",
		ConnectionID: &connectionID,
	}, nil, nil)
	if err != nil {
		t.Fatalf("switch directory to webdav: %v", err)
	}
	if switched.Kind != storage.KindWebDAV || switched.RemotePath != "/JAV" {
		t.Fatalf("directory not switched: %#v", switched)
	}
	if switched.ID != local.ID {
		t.Fatalf("switch must keep the directory id: got %d want %d", switched.ID, local.ID)
	}
	if switched.Missing {
		t.Fatal("a source switch must clear the missing flag so the next scan retries")
	}

	// The location, its relative path and its JAV link are untouched.
	var stored models.VideoLocation
	if err := gdb.First(&stored, loc.ID).Error; err != nil {
		t.Fatalf("load location: %v", err)
	}
	if stored.IsDelete {
		t.Fatal("locations must stay visible after the switch")
	}
	if stored.RelativePath != "JAV/IPX/IPX-001/movie.mp4" {
		t.Fatalf("relative path changed: %q", stored.RelativePath)
	}
	if stored.JavID == nil || *stored.JavID != jav.ID {
		t.Fatalf("jav link lost: %#v", stored.JavID)
	}
	if stored.DirectoryID != local.ID {
		t.Fatalf("location must still belong to the same directory: %d", stored.DirectoryID)
	}

	// The video with its fingerprint is still listed under the directory.
	items, err := ListVideos(ctx, 20, 0, nil, "", "recent", nil, []int64{local.ID})
	if err != nil {
		t.Fatalf("list videos: %v", err)
	}
	if len(items) != 1 || items[0].ID != video.ID {
		t.Fatalf("scraped video lost after switch: %#v", items)
	}

	// Switching back to local clears the remote fields.
	back, err := UpdateDirectorySource(ctx, local.ID, &DirectorySource{Kind: storage.KindLocal, Path: localRoot}, nil, nil)
	if err != nil {
		t.Fatalf("switch back: %v", err)
	}
	if back.Kind != storage.KindLocal || back.ConnectionID != nil || back.RemotePath != "" {
		t.Fatalf("switching back must clear remote fields: %#v", back)
	}
}
