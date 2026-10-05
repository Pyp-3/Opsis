package updater

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// Launch starts the verified installer outside this process tree so it can
// replace opsis.exe after the application exits; /relaunch=1 reopens it.
func Launch(installer string) error {
	cmd := exec.Command(installer, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/relaunch=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
