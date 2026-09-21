package subtitle

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildSearchURLUsesPlaceholder(t *testing.T) {
	got, err := BuildSearchURL("https://example.com/sub?name={keyword}&from=javboss", "ABP 001")
	if err != nil {
		t.Fatalf("BuildSearchURL: %v", err)
	}
	if got != "https://example.com/sub?name=ABP+001&from=javboss" {
		t.Fatalf("BuildSearchURL = %q", got)
	}

	// {name} 是同一个占位符的别名。
	got, err = BuildSearchURL("https://example.com/sub?name={name}", "ABP-001")
	if err != nil {
		t.Fatalf("BuildSearchURL: %v", err)
	}
	if got != "https://example.com/sub?name=ABP-001" {
		t.Fatalf("BuildSearchURL({name}) = %q", got)
	}
}

func TestBuildSearchURLAppendsQueryWhenNoPlaceholder(t *testing.T) {
	got, err := BuildSearchURL("https://example.com/sub", "ABP-001")
	if err != nil {
		t.Fatalf("BuildSearchURL: %v", err)
	}
	if got != "https://example.com/sub?name=ABP-001" {
		t.Fatalf("BuildSearchURL = %q", got)
	}

	got, err = BuildSearchURL("https://example.com/sub?lang=zh", "ABP-001")
	if err != nil {
		t.Fatalf("BuildSearchURL: %v", err)
	}
	if got != "https://example.com/sub?lang=zh&name=ABP-001" {
		t.Fatalf("BuildSearchURL = %q", got)
	}
}

func TestBuildSearchURLFallsBackToDefault(t *testing.T) {
	got, err := BuildSearchURL("   ", "ABP-001")
	if err != nil {
		t.Fatalf("BuildSearchURL: %v", err)
	}
	if !strings.HasPrefix(got, "https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=") {
		t.Fatalf("BuildSearchURL(empty) = %q", got)
	}
}

func TestBuildSearchURLRejectsNonHTTP(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd?name={keyword}", "not a url {keyword}", "ftp://x/{keyword}"} {
		if _, err := BuildSearchURL(raw, "ABP-001"); err == nil {
			t.Fatalf("BuildSearchURL(%q) should fail", raw)
		}
	}
}

const xunleiPayload = `{"code":0,"data":[
	{"gcid":"AAA","cid":"CID1","url":"https://cdn.example/1.srt","ext":"srt","name":"abp001.srt","duration":5672987,"languages":["简体"],"source":0,"score":0,"extra_name":"（网友上传）"},
	{"gcid":"BBB","cid":"CID2","url":"https://cdn.example/2.srt","ext":"SRT","name":"ABP-001.srt","duration":"7467301","languages":["默认","简体","简体"],"source":0,"extra_name":""},
	{"gcid":"CCC","cid":"CID1","url":"https://cdn.example/dup.srt","ext":"srt","name":"duplicate.srt","duration":0,"languages":[]},
	{"gcid":"DDD","cid":"","url":"","ext":"srt","name":"no-url.srt","duration":1},
	{"gcid":"EEE","cid":"","url":"https://cdn.example/no-name.srt","ext":"srt","name":"","duration":1},
	{"gcid":"FFF","cid":"CID3","url":"https://cdn.example/3.ass","ext":"ass","name":"ABP-001.ass","duration":7468000,"languages":["繁體"]}
],"result":"ok"}`

func TestParseSearchResponseNormalizesProviderData(t *testing.T) {
	results, err := ParseSearchResponse([]byte(xunleiPayload))
	if err != nil {
		t.Fatalf("ParseSearchResponse: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("len(results) = %d, want 3 (duplicates and unusable rows dropped)", len(results))
	}
	if results[0].SourceID != "CID1" || results[0].DurationMS != 5672987 {
		t.Fatalf("first result = %+v", results[0])
	}
	if results[0].Language() != "简体" {
		t.Fatalf("language = %q", results[0].Language())
	}
	if results[1].Ext != FormatSRT {
		t.Fatalf("ext = %q, want srt", results[1].Ext)
	}
	if results[1].DurationMS != 7467301 {
		t.Fatalf("string duration was not parsed: %+v", results[1])
	}
	if results[1].Language() != "默认 / 简体" {
		t.Fatalf("duplicate languages were not collapsed: %q", results[1].Language())
	}
	if results[2].Ext != FormatASS {
		t.Fatalf("ass ext = %q", results[2].Ext)
	}
}

func TestParseSearchResponseRejectsErrorPayload(t *testing.T) {
	if _, err := ParseSearchResponse([]byte(`{"code":400,"data":[],"result":"bad request"}`)); err == nil {
		t.Fatal("expected an error for a non-zero code")
	}
	if _, err := ParseSearchResponse([]byte(`not json`)); err == nil {
		t.Fatal("expected an error for invalid JSON")
	}
}

func TestSearchUsesConfiguredEndpoint(t *testing.T) {
	var gotKeyword string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKeyword = r.URL.Query().Get("name")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":   0,
			"result": "ok",
			"data": []map[string]any{{
				"cid":      "CID1",
				"url":      "https://cdn.example/1.srt",
				"ext":      "srt",
				"name":     "ABP-001.srt",
				"duration": 7467301,
			}},
		})
	}))
	defer server.Close()

	results, err := Search(context.Background(), server.URL+"/oracle/subtitle?name={keyword}", "ABP-001")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if gotKeyword != "ABP-001" {
		t.Fatalf("provider received name=%q", gotKeyword)
	}
	if len(results) != 1 || results[0].Name != "ABP-001.srt" {
		t.Fatalf("results = %+v", results)
	}
}

func TestSearchRequiresKeyword(t *testing.T) {
	if _, err := Search(context.Background(), "https://example.com/{keyword}", "  "); err == nil {
		t.Fatal("expected an error for an empty keyword")
	}
}
