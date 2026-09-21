package subtitle

import (
	"strings"
	"testing"
)

const srtSample = "\ufeff1\r\n00:00:01,000 --> 00:00:04,500\r\n第一句\r\n\r\n2\r\n00:01:02,250 --> 00:01:05,000\r\nSecond line\r\n"

func TestToVTTConvertsSRT(t *testing.T) {
	payload, err := ToVTT(FormatSRT, []byte(srtSample))
	if err != nil {
		t.Fatalf("ToVTT: %v", err)
	}
	text := string(payload)
	if !strings.HasPrefix(text, "WEBVTT\n\n") {
		t.Fatalf("missing WEBVTT header: %q", text[:min(20, len(text))])
	}
	if strings.Contains(text, ",") && strings.Contains(text, "00:00:01,000") {
		t.Fatalf("SRT comma timestamps were not converted: %q", text)
	}
	if !strings.Contains(text, "00:00:01.000 --> 00:00:04.500") {
		t.Fatalf("first cue timestamp = %q", text)
	}
	if !strings.Contains(text, "00:01:02.250 --> 00:01:05.000") {
		t.Fatalf("second cue timestamp = %q", text)
	}
	if !strings.Contains(text, "第一句") || !strings.Contains(text, "Second line") {
		t.Fatalf("cue text missing: %q", text)
	}
	if strings.Contains(text, "\r") {
		t.Fatalf("carriage returns were not normalized: %q", text)
	}
}

func TestToVTTKeepsExistingVTT(t *testing.T) {
	payload, err := ToVTT(FormatVTT, []byte("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n"))
	if err != nil {
		t.Fatalf("ToVTT: %v", err)
	}
	text := string(payload)
	if strings.Count(text, "WEBVTT") != 1 {
		t.Fatalf("WEBVTT header duplicated: %q", text)
	}
}

func TestToVTTDetectsFormatWithoutExtension(t *testing.T) {
	payload, err := ToVTT("", []byte(srtSample))
	if err != nil {
		t.Fatalf("ToVTT: %v", err)
	}
	if !strings.Contains(string(payload), "00:00:01.000 --> 00:00:04.500") {
		t.Fatalf("sniffed SRT was not converted: %q", string(payload))
	}
}

const assSample = `[Script Info]
Title: test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.50,Default,,0,0,0,,{\i1}第一句{\i0}\N第二行
Dialogue: 0,0:01:02.25,0:01:05.00,Default,,0,0,0,,line, with comma
`

func TestToVTTConvertsASS(t *testing.T) {
	payload, err := ToVTT(FormatASS, []byte(assSample))
	if err != nil {
		t.Fatalf("ToVTT: %v", err)
	}
	text := string(payload)
	if !strings.HasPrefix(text, "WEBVTT\n\n") {
		t.Fatalf("missing WEBVTT header: %q", text)
	}
	if !strings.Contains(text, "00:00:01.000 --> 00:00:04.500") {
		t.Fatalf("ASS timestamps were not converted: %q", text)
	}
	if strings.Contains(text, `{\i1}`) {
		t.Fatalf("override tags were not stripped: %q", text)
	}
	if !strings.Contains(text, "第一句\n第二行") {
		t.Fatalf("\\N was not converted to a line break: %q", text)
	}
	if !strings.Contains(text, "line, with comma") {
		t.Fatalf("text field with commas was truncated: %q", text)
	}
}

func TestToVTTRejectsUnknownFormat(t *testing.T) {
	if _, err := ToVTT("vob", []byte("not a subtitle")); err == nil {
		t.Fatal("expected an error for an unsupported container")
	}
}

func TestDecodeTextFallsBackToGBK(t *testing.T) {
	// "中文字幕" encoded as GBK.
	gbk := []byte{0xD6, 0xD0, 0xCE, 0xC4, 0xD7, 0xD6, 0xC4, 0xBB}
	if got := DecodeText(gbk); got != "中文字幕" {
		t.Fatalf("DecodeText(GBK) = %q, want 中文字幕", got)
	}
}

func TestDecodeTextKeepsUTF8(t *testing.T) {
	if got := DecodeText([]byte("\ufeff中文字幕")); got != "中文字幕" {
		t.Fatalf("DecodeText(UTF-8) = %q", got)
	}
}
