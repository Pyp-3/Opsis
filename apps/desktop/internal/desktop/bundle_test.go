package desktop

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRuntimeExtractionIsReusableAndPreservesExecutableMode(t *testing.T) {
	var buffer bytes.Buffer
	gz := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(gz)
	if err := archive.WriteHeader(&tar.Header{Name: "node", Mode: 0755, Size: 4}); err != nil {
		t.Fatal(err)
	}
	_, _ = archive.Write([]byte("test"))
	_ = archive.Close()
	_ = gz.Close()
	cache := t.TempDir()
	first, err := ExtractRuntime(buffer.Bytes(), cache)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(first, "node"))
	// Windows has no POSIX mode bits; the per-user cache ACL provides privacy there.
	if err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != 0700) {
		t.Fatal("executable not private/executable")
	}
	second, err := ExtractRuntime(buffer.Bytes(), cache)
	if err != nil || first != second {
		t.Fatal("runtime not reused")
	}
}

func TestProfileLockPreventsConcurrentOwners(t *testing.T) {
	data := t.TempDir()
	lock, err := LockProfile(data)
	if err != nil {
		t.Fatal(err)
	}
	if other, err := LockProfile(data); err == nil {
		other.Close()
		t.Fatal("two desktop owners")
	}
	_ = lock.Close()
	next, err := LockProfile(data)
	if err != nil {
		t.Fatal(err)
	}
	next.Close()
}

func TestUserDataSurvivesRuntimeChanges(t *testing.T) {
	directory := t.TempDir()
	t.Setenv("OPSIS_DATA_DIR", filepath.Join(directory, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(directory, "cache"))
	t.Setenv("LocalAppData", filepath.Join(directory, "cache")) // os.UserCacheDir on Windows
	t.Setenv("HOME", directory) // os.UserCacheDir on macOS uses ~/Library/Caches
	t.Setenv("OPSIS_DB_PATH", "")
	t.Setenv("OPSIS_MODEL_DIR", "")
	paths, err := UserPaths()
	if err != nil {
		t.Fatal(err)
	}
	if paths.Database != filepath.Join(directory, "data", "opsis.sqlite") {
		t.Fatal(paths.Database)
	}
	cache := filepath.Join(directory, "cache")
	if runtime.GOOS == "darwin" {
		cache = filepath.Join(directory, "Library", "Caches")
	}
	if paths.Models != filepath.Join(cache, "opsis", "models") {
		t.Fatal(paths.Models)
	}
}
