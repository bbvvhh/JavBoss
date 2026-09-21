package subtitle

import "strings"

// splitFileName splits a raw file name into its base name and extension.
//
// It deliberately does not use filepath: on Windows filepath.Base("a:b.srt")
// drops everything up to the colon, which would make filename matching and
// sanitizing behave differently per platform.
func splitFileName(value string) (string, string) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), `\`, "/")
	normalized = strings.TrimRight(normalized, "/")
	if index := strings.LastIndex(normalized, "/"); index >= 0 {
		normalized = normalized[index+1:]
	}
	dot := strings.LastIndex(normalized, ".")
	if dot <= 0 {
		return normalized, ""
	}
	return normalized[:dot], normalized[dot:]
}
