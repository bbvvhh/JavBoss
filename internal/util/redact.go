package util

import (
	"errors"
	"regexp"
	"strings"
)

// credentialPattern matches the userinfo section of a URL: scheme://user:pass@host.
var credentialPattern = regexp.MustCompile(`(?i)([a-z][a-z0-9+.\-]*://)[^/@\s]+@`)

// RedactURLs removes embedded URL credentials so media URLs built for ffprobe,
// ffmpeg and mpv can never leak passwords into logs or error messages.
func RedactURLs(text string) string {
	if text == "" || !strings.Contains(text, "@") {
		return text
	}
	return credentialPattern.ReplaceAllString(text, "${1}***@")
}

// RedactError returns an error with URL credentials removed from its message.
// The original error is returned unchanged when there is nothing to redact.
func RedactError(err error) error {
	if err == nil {
		return nil
	}
	original := err.Error()
	redacted := RedactURLs(original)
	if redacted == original {
		return err
	}
	return errors.New(redacted)
}

// RedactArgs returns a copy of args with URL credentials removed, for logging.
func RedactArgs(args []string) []string {
	out := make([]string, len(args))
	for i, arg := range args {
		out[i] = RedactURLs(arg)
	}
	return out
}
