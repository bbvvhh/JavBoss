package subtitle

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

// ErrUnsupportedFormat is returned when bytes cannot be rendered as WebVTT.
var ErrUnsupportedFormat = errors.New("unsupported subtitle format")

// DecodeText normalizes subtitle bytes to a UTF-8 string. Providers sometimes
// hand out GBK/Big5 encoded files, which would otherwise show up as mojibake in
// the browser.
func DecodeText(data []byte) string {
	data = stripBOM(data)
	if utf8.Valid(data) {
		return string(data)
	}
	if decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(data); err == nil && utf8.Valid(decoded) {
		return string(decoded)
	}
	if decoded, err := traditionalchinese.Big5.NewDecoder().Bytes(data); err == nil && utf8.Valid(decoded) {
		return string(decoded)
	}
	return string(data)
}

// ToVTT renders subtitle bytes as WebVTT so the browser player can display
// them. SRT and ASS/SSA are converted; WebVTT passes through unchanged.
func ToVTT(format string, data []byte) ([]byte, error) {
	text := DecodeText(data)
	normalized := normalizeFormat(format)
	if normalized == "" {
		normalized = SniffFormat(data)
	}
	switch normalized {
	case FormatVTT:
		return []byte(ensureVTTHeader(text)), nil
	case FormatSRT, "":
		return []byte(srtToVTT(text)), nil
	case FormatASS, FormatSSA:
		converted, ok := assToVTT(text)
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnsupportedFormat, normalized)
		}
		return []byte(converted), nil
	default:
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedFormat, normalized)
	}
}

func stripBOM(data []byte) []byte {
	return []byte(strings.TrimPrefix(string(data), "\ufeff"))
}

func ensureVTTHeader(text string) string {
	body := strings.TrimLeft(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	if strings.HasPrefix(strings.ToUpper(body), "WEBVTT") {
		return body
	}
	return "WEBVTT\n\n" + body
}

var srtTimestampRe = regexp.MustCompile(
	`^(\s*)(\d{1,3}:\d{1,2}:\d{1,2})([,.])(\d{1,3})(\s*-->\s*)(\d{1,3}:\d{1,2}:\d{1,2})([,.])(\d{1,3})(.*)$`,
)

// srtToVTT converts SubRip cues into WebVTT. Cue settings after the end
// timestamp (position/align) are preserved.
func srtToVTT(text string) string {
	body := strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(body)), "WEBVTT") {
		return body
	}
	lines := strings.Split(body, "\n")
	var out strings.Builder
	out.WriteString("WEBVTT\n\n")
	for _, line := range lines {
		match := srtTimestampRe.FindStringSubmatch(line)
		if match == nil {
			out.WriteString(line)
			out.WriteString("\n")
			continue
		}
		out.WriteString(match[1])
		out.WriteString(match[2])
		out.WriteString(".")
		out.WriteString(padMillis(match[4]))
		out.WriteString(" --> ")
		out.WriteString(match[6])
		out.WriteString(".")
		out.WriteString(padMillis(match[8]))
		out.WriteString(match[9])
		out.WriteString("\n")
	}
	return out.String()
}

func padMillis(value string) string {
	for len(value) < 3 {
		value += "0"
	}
	if len(value) > 3 {
		value = value[:3]
	}
	return value
}

var assOverrideTagRe = regexp.MustCompile(`\{[^{}]*\}`)

// assToVTT extracts dialogue lines from an Advanced SubStation Alpha script.
// It returns false when no usable [Events] section is found.
func assToVTT(text string) (string, bool) {
	body := strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(body, "\n")

	inEvents := false
	formatFields := []string(nil)
	var cues []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
			inEvents = strings.EqualFold(trimmed, "[Events]")
			continue
		}
		if !inEvents || trimmed == "" || strings.HasPrefix(trimmed, ";") {
			continue
		}
		key, value, found := strings.Cut(trimmed, ":")
		if !found {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "format":
			formatFields = splitASSTuple(value)
		case "dialogue":
			if len(formatFields) == 0 {
				continue
			}
			cue, ok := assDialogueToCue(formatFields, value)
			if ok {
				cues = append(cues, cue)
			}
		}
	}
	if len(cues) == 0 {
		return "", false
	}
	return "WEBVTT\n\n" + strings.Join(cues, "\n\n") + "\n", true
}

func splitASSTuple(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, strings.ToLower(strings.TrimSpace(part)))
	}
	return out
}

func assDialogueToCue(fields []string, value string) (string, bool) {
	// Text is always the last field and may itself contain commas.
	maxSplits := len(fields) - 1
	if maxSplits < 1 {
		return "", false
	}
	parts := strings.SplitN(value, ",", maxSplits+1)
	if len(parts) < len(fields) {
		return "", false
	}
	startIdx, endIdx, textIdx := -1, -1, -1
	for i, field := range fields {
		switch field {
		case "start":
			startIdx = i
		case "end":
			endIdx = i
		case "text":
			textIdx = i
		}
	}
	if startIdx < 0 || endIdx < 0 || textIdx < 0 {
		return "", false
	}
	start, ok := assTimeToVTT(parts[startIdx])
	if !ok {
		return "", false
	}
	end, ok := assTimeToVTT(parts[endIdx])
	if !ok {
		return "", false
	}
	text := strings.TrimSpace(parts[textIdx])
	text = assOverrideTagRe.ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, `\N`, "\n")
	text = strings.ReplaceAll(text, `\n`, "\n")
	text = strings.ReplaceAll(text, `\h`, " ")
	text = strings.TrimSpace(text)
	if text == "" {
		return "", false
	}
	return start + " --> " + end + "\n" + text, true
}

// assTimeToVTT converts an ASS timestamp (H:MM:SS.cc) into WebVTT form.
func assTimeToVTT(value string) (string, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", false
	}
	main, fraction, hasFraction := strings.Cut(raw, ".")
	segments := strings.Split(main, ":")
	if len(segments) != 3 {
		return "", false
	}
	hours, err := strconv.Atoi(strings.TrimSpace(segments[0]))
	if err != nil {
		return "", false
	}
	minutes, err := strconv.Atoi(strings.TrimSpace(segments[1]))
	if err != nil {
		return "", false
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(segments[2]))
	if err != nil {
		return "", false
	}
	millis := 0
	if hasFraction {
		fraction = strings.TrimSpace(fraction)
		for len(fraction) < 3 {
			fraction += "0"
		}
		parsed, err := strconv.Atoi(fraction[:3])
		if err != nil {
			return "", false
		}
		millis = parsed
	}
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, seconds, millis), true
}
