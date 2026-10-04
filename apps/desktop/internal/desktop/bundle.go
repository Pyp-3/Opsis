package desktop

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ExtractRuntime installs immutable, versioned application code into the cache.
// It never touches the database or model cache; a failed extraction is disposable.
func ExtractRuntime(bundle []byte, cache string) (string, error) {
	digest := sha256.Sum256(bundle)
	destination := filepath.Join(cache, "runtime-"+hex.EncodeToString(digest[:16]))
	if _, err := os.Stat(filepath.Join(destination, ".complete")); err == nil {
		return destination, nil
	}
	stage, err := os.MkdirTemp(cache, ".runtime-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	if err := extract(bundle, stage); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(stage, ".complete"), []byte("ok\n"), 0600); err != nil {
		return "", err
	}
	if err := os.Rename(stage, destination); err != nil {
		// A concurrent first launch may have finished the same immutable version.
		if _, complete := os.Stat(filepath.Join(destination, ".complete")); complete != nil {
			return "", err
		}
	}
	return destination, nil
}

func inside(root, name string) (string, error) {
	if filepath.IsAbs(name) {
		return "", fmt.Errorf("absolute path in runtime archive")
	}
	path := filepath.Join(root, filepath.FromSlash(name))
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path outside runtime archive")
	}
	return path, nil
}

func extract(bundle []byte, root string) error {
	gz, err := gzip.NewReader(bytes.NewReader(bundle))
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		path, err := inside(root, header.Name)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(path, 0700); err != nil {
				return err
			}
		case tar.TypeReg:
			mode := os.FileMode(0600)
			if header.Mode&0111 != 0 {
				mode = 0700
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, reader)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			if filepath.IsAbs(header.Linkname) {
				return fmt.Errorf("absolute symlink in runtime archive")
			}
			if _, err := inside(root, filepath.Join(filepath.Dir(header.Name), header.Linkname)); err != nil {
				return err
			}
			if err := os.Symlink(header.Linkname, path); err != nil {
				return err
			}
		case tar.TypeLink:
			target, err := inside(root, header.Linkname)
			if err != nil {
				return err
			}
			if err := os.Link(target, path); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported runtime archive entry")
		}
	}
}
