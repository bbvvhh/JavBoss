package subtitle

import (
	"strings"
)

// Known container formats, normalized to lower case without a leading dot.
const (
	FormatSRT = "srt"
	FormatVTT = "vtt"
	FormatASS = "ass"
	FormatSSA = "ssa"
)

// normalizeFormat lower-cases an extension and maps common aliases.
func normalizeFormat(ext string) string {
	value := strings.ToLower(strings.TrimSpace(ext))
	value = strings.TrimPrefix(value, ".")
	switch value {
	case "", "unknown":
		return ""
	case "webvtt", "vtt":
		return FormatVTT
	case "sub", "srt", "microdvd":
		return FormatSRT
	case "ass", "ssa", "advancedsubstation", "advancedsubstationalpha":
		return FormatASS
	default:
		return value
	}
}

// FormatFromFilename derives a normalized format from a file name.
func FormatFromFilename(name string) string {
	_, ext := splitFileName(name)
	return normalizeFormat(ext)
}

// DetectFormat picks the container format, preferring the file name and falling
// back to sniffing the payload.
func DetectFormat(name string, data []byte) string {
	if format := FormatFromFilename(name); format != "" {
		return format
	}
	return SniffFormat(data)
}

// SniffFormat guesses the format from the file content only.
func SniffFormat(data []byte) string {
	text := string(bytesTrimSpace(data))
	if text == "" {
		return ""
	}
	head := strings.ToUpper(firstLines(text, 4))
	switch {
	case strings.HasPrefix(head, "WEBVTT"):
		return FormatVTT
	case strings.Contains(head, "[SCRIPT INFO]"), strings.Contains(head, "[EVENTS]"):
		if strings.Contains(head, "V4+ STYLES") || strings.Contains(head, "DIALOGUE:") {
			return FormatASS
		}
		return FormatASS
	case strings.Contains(head, "-->"):
		return FormatSRT
	default:
		return FormatSRT
	}
}

// SupportedExtension reports whether a stored subtitle can be handed to a
// player. Anything else is still stored, but cannot be converted to WebVTT.
func SupportedExtension(format string) bool {
	switch normalizeFormat(format) {
	case FormatSRT, FormatVTT, FormatASS, FormatSSA:
		return true
	default:
		return false
	}
}

func firstLines(text string, count int) string {
	lines := strings.Split(text, "\n")
	if len(lines) > count {
		lines = lines[:count]
	}
	return strings.Join(lines, "\n")
}

func bytesTrimSpace(data []byte) []byte {
	return []byte(strings.TrimSpace(strings.TrimPrefix(string(data), "\ufeff")))
}
