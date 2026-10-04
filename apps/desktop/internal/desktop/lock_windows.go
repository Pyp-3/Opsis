package desktop

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
)

// Closing the file releases the kernel lock, including after a crash.
func LockProfile(data string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(data, "desktop.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	overlapped := windows.Overlapped{}
	if err := windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped); err != nil {
		file.Close()
		return nil, errors.New("Opsis is already running with this data directory")
	}
	return file, nil
}
