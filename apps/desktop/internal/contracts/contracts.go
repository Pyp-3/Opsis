package contracts

import (
	_ "embed"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/dop251/goja"
)

//go:embed dist/contracts.js
var source string

type ValidationError struct {
	Message string `json:"message"`
	Field   any    `json:"field,omitempty"`
}

func (e *ValidationError) Error() string { return e.Message }

// The VM has no filesystem, networking, process, or module-loading capabilities.
// Only the bundled, pure Opsis contracts execute in it, with bounded JSON input.
type Contracts struct {
	mu    sync.Mutex
	vm    *goja.Runtime
	apply goja.Callable
}

func New() (*Contracts, error) {
	vm := goja.New()
	if _, err := vm.RunString(source); err != nil {
		return nil, err
	}
	apply, ok := goja.AssertFunction(vm.Get("OpsisContracts").ToObject(vm).Get("apply"))
	if !ok {
		return nil, errors.New("missing contract entrypoint")
	}
	return &Contracts{vm: vm, apply: apply}, nil
}

func (c *Contracts) Apply(operation string, input any) (json.RawMessage, error) {
	data, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	if len(data) > 20_000_000 {
		return nil, &ValidationError{Message: "Board data is too large."}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	// Synchronize the timer callback before clearing an interrupt so it cannot
	// accidentally interrupt the next request after this invocation completes.
	finished := make(chan struct{})
	timer := time.AfterFunc(5*time.Second, func() { c.vm.Interrupt("contract deadline"); close(finished) })
	result, err := c.apply(goja.Undefined(), c.vm.ToValue(operation), c.vm.ToValue(string(data)))
	if !timer.Stop() {
		<-finished
	}
	c.vm.ClearInterrupt()
	if err != nil {
		return nil, errors.New("board contract evaluation failed")
	}
	var response struct {
		OK      bool            `json:"ok"`
		Value   json.RawMessage `json:"value"`
		Message string          `json:"message"`
		Field   any             `json:"field"`
	}
	if err := json.Unmarshal([]byte(result.String()), &response); err != nil {
		return nil, err
	}
	if !response.OK {
		return nil, &ValidationError{Message: response.Message, Field: response.Field}
	}
	return response.Value, nil
}
