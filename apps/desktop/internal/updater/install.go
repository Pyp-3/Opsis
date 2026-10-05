package updater

import (
	"os"
	"path/filepath"
)

// InstalledMarker is written next to opsis.exe by the setup program. Portable
// copies from the zip lack it and are only told where to download updates.
const InstalledMarker = "installed-by-setup"

func Installed() bool {
	executable, err := os.Executable()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(filepath.Dir(executable), InstalledMarker))
	return err == nil
}
