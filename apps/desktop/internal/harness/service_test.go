package harness

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceStartupReportsExitStatusWithoutChildOutput(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node needed for service fixtures")
	}
	directory := t.TempDir()
	bytes, err := os.ReadFile(node)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(NodePath(directory), bytes, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "api"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"42", "0"} {
		if err := os.WriteFile(filepath.Join(directory, "api", "desktop.mjs"), []byte("process.stderr.write('private-provider-output'); process.exit("+code+");"), 0600); err != nil {
			t.Fatal(err)
		}
		service, err := Start(context.Background(), directory, directory)
		if service != nil || err == nil || !strings.Contains(err.Error(), "exit status "+code) || strings.Contains(err.Error(), "private-provider-output") {
			t.Fatalf("startup: %v %v", service, err)
		}
	}
}
