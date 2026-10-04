package desktop

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Take the lock before starting a service or writing its discovery record.
func LockProfile(data string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(data, "desktop.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, errors.New("Opsis is already running with this data directory")
	}
	return file, nil
}
