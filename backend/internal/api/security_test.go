package api

import "testing"

func TestValidationHelpers(t *testing.T) {
	for _, bad := range []string{"Name <a@example.com>", "not-an-email", "a@example.com,b@example.com"} {
		if _, ok := cleanEmail(bad); ok {
			t.Errorf("accepted invalid email %q", bad)
		}
	}
	if value, ok := cleanEmail(" USER@Example.com "); !ok || value != "user@example.com" {
		t.Error("failed email normalization")
	}
	if validHex("AABB", 4) || validHex("abcd", 5) || !validHex("aabb", 4) {
		t.Error("hex validation failed")
	}
	if singleLine("line\nbreak", 1, 20) || validText("bad\x00", 1, 20) {
		t.Error("accepted control character")
	}
	for _, label := range []string{"=1+1", "+123", "-123", "@sum"} {
		if excelSafe(label) != "'"+label {
			t.Errorf("CSV label not escaped: %q", label)
		}
	}
}
