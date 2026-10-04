package harness

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Error string

func (e Error) Error() string { return string(e) }

type Request struct {
	Executable                    string
	Args                          []string
	Stdin                         string
	Directory                     string
	Environment                   []string
	Timeout                       time.Duration
	MaxInput, MaxOutput, MaxError int
}
type Runner interface {
	Run(context.Context, Request, func(string)) (string, error)
}
type ProcessRunner struct{ Node string }
type outputChunk struct {
	stdout bool
	data   []byte
}
type channelWriter struct {
	stdout bool
	output chan<- outputChunk
}

func (w channelWriter) Write(data []byte) (int, error) {
	w.output <- outputChunk{w.stdout, bytes.Clone(data)}
	return len(data), nil
}

// Run is the only provider process boundary. It never invokes a shell, retains
// no stderr, and cancels the process group on cancellation, deadlines, or limits.
func (runner ProcessRunner) Run(parent context.Context, request Request, onLine func(string)) (string, error) {
	if len(request.Stdin) > request.MaxInput {
		return "", Error("harness_overflow")
	}
	if parent.Err() != nil {
		return "", Error("harness_cancelled")
	}
	ctx, cancel := context.WithTimeout(parent, request.Timeout)
	defer cancel()
	executable, args := request.Executable, request.Args
	switch strings.ToLower(filepath.Ext(executable)) {
	case ".cmd", ".bat", ".ps1":
		return "", Error("harness_config")
	case ".js", ".mjs", ".cjs":
		args = append([]string{executable}, args...)
		executable = runner.Node
	}
	cmd := exec.Command(executable, args...)
	cmd.Dir = request.Directory
	cmd.Env = request.Environment
	cmd.Stdin = strings.NewReader(request.Stdin)
	chunks := make(chan outputChunk, 16)
	cmd.Stdout = channelWriter{true, chunks}
	cmd.Stderr = channelWriter{false, chunks}
	tree, err := startProcess(cmd)
	if err != nil {
		return "", Error("harness_missing")
	}
	defer tree.close()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(chunks) }()
	var stdout bytes.Buffer
	var pending []byte
	stderrBytes := 0
	var failure error
	var kill <-chan time.Time
	var timer *time.Timer
	terminate := func(code Error) {
		if failure != nil {
			return
		}
		failure = code
		tree.kill(false)
		timer = time.NewTimer(2 * time.Second)
		kill = timer.C
	}
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	contextDone := ctx.Done()
	for chunks != nil {
		select {
		case <-contextDone:
			contextDone = nil
			code := Error("harness_cancelled")
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				code = Error("harness_timeout")
			}
			terminate(code)
		case <-kill:
			tree.kill(true)
			kill = nil
		case chunk, ok := <-chunks:
			if !ok {
				chunks = nil
				break
			}
			if failure != nil {
				continue
			}
			if !chunk.stdout {
				stderrBytes += len(chunk.data)
				if stderrBytes > request.MaxError {
					terminate(Error("harness_overflow"))
				}
				continue
			}
			if stdout.Len()+len(chunk.data) > request.MaxOutput {
				terminate(Error("harness_overflow"))
				continue
			}
			stdout.Write(chunk.data)
			if onLine != nil {
				pending = append(pending, chunk.data...)
				for {
					index := bytes.IndexByte(pending, '\n')
					if index < 0 {
						break
					}
					line := string(pending[:index])
					pending = pending[index+1:]
					if strings.TrimSpace(line) != "" {
						onLine(line)
					}
				}
			}
		}
	}
	waitErr := <-done
	if failure != nil {
		return "", failure
	}
	if waitErr != nil {
		return "", Error("harness_exit")
	}
	return stdout.String(), nil
}
