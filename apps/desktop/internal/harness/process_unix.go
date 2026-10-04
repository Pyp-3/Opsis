//go:build linux || darwin

package harness

import (
	"os/exec"
	"syscall"
)

type processTree struct{ cmd *exec.Cmd }

func startProcess(cmd *exec.Cmd) (*processTree, error) {
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &processTree{cmd}, nil
}
func (p *processTree) kill(force bool) {
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	_ = syscall.Kill(-p.cmd.Process.Pid, signal)
}
func (p *processTree) close() {}
