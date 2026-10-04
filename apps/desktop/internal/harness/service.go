package harness

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Service struct {
	URL   *url.URL
	cmd   *exec.Cmd
	tree  *processTree
	input io.WriteCloser
	done  chan struct{}
	once  sync.Once
}

// Start launches packaged Kokoro inference without a shell. Its process group
// is terminated on shutdown, including any native inference workers.
func Start(ctx context.Context, runtimeDir, models string) (*Service, error) {
	cmd := exec.Command(NodePath(runtimeDir), filepath.Join(runtimeDir, "api", "desktop.mjs"))
	cmd.Dir = filepath.Join(runtimeDir, "api")
	cmd.Env = append(os.Environ(), "OPSIS_MODEL_DIR="+models)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	// The service has logging disabled. Never forward provider output or credentials.
	cmd.Stderr = io.Discard
	tree, err := startProcess(cmd)
	if err != nil {
		return nil, fmt.Errorf("start bundled Node runtime: %w", err)
	}
	s := &Service{cmd: cmd, tree: tree, input: input, done: make(chan struct{})}
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if address, ok := strings.CutPrefix(scanner.Text(), "OPSIS_READY="); ok {
				select {
				case ready <- address:
				default:
				}
			}
		}
		// Keep draining even after malformed/excessive output so shutdown cannot hang.
		_, _ = io.Copy(io.Discard, stdout)
	}()
	go func() { _ = cmd.Wait(); close(s.done) }()
	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	select {
	case address := <-ready:
		u, err := url.Parse(address)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil {
			s.Close()
			return nil, errors.New("invalid local service address")
		}
		s.URL = u
		return s, nil
	case <-s.done:
		tree.close()
		return nil, errors.New("local service exited before becoming ready")
	case <-timer.C:
		s.Close()
		return nil, errors.New("local service startup timed out")
	case <-ctx.Done():
		s.Close()
		return nil, ctx.Err()
	}
}

func (s *Service) Done() <-chan struct{} { return s.done }

func (s *Service) Close() {
	s.once.Do(func() {
		_ = s.input.Close()
		// Cancel the whole inference group.
		s.tree.kill(false)
		select {
		case <-s.done:
		case <-time.After(5 * time.Second):
		}
		s.tree.kill(true)
		<-s.done
		s.tree.close()
	})
}
