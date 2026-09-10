package domain

import (
	"errors"
	"testing"
)

func TestDecodeDesignRevisionPresentationSnapshot(t *testing.T) {
	snapshot, err := DecodeDesignRevisionPresentationSnapshot([]byte(`{"schema_version":1,"unit":{"label":"Gabinete 1"},"definition":{"code":"MOD-1","name":"Gabinete"},"parameters":[],"materials":[],"room":{"state":"unavailable"}}`))
	if err != nil || snapshot.Unit.Label != "Gabinete 1" {
		t.Fatalf("decode snapshot: %#v, %v", snapshot, err)
	}
	if DesignRevisionDescriptorStateFor(snapshot) != DesignRevisionDescriptorAvailable {
		t.Fatal("snapshot must be available")
	}
	if DesignRevisionDescriptorStateFor(nil) != DesignRevisionDescriptorUnavailableLegacy {
		t.Fatal("nil snapshot must be legacy unavailable")
	}
}

func TestDecodeDesignRevisionPresentationSnapshotFailsClosed(t *testing.T) {
	for _, raw := range []string{`{"schema_version":2,"unit":{"label":"x"}}`, `{"schema_version":1,"unit":{"label":""}}`, `{`} {
		if _, err := DecodeDesignRevisionPresentationSnapshot([]byte(raw)); !errors.Is(err, ErrSerializationFailed) {
			t.Fatalf("%s: got %v", raw, err)
		}
	}
}
