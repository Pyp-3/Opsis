package generation

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/Pyp-3/Opsis/apps/desktop/internal/harness"
	"github.com/dop251/goja"
)

//go:embed dist/workflows.js
var source string
var programOnce sync.Once
var program *goja.Program
var programError error

type Outcome struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}
type Engine struct {
	ProviderKeys *ProviderKeys
	Runner       harness.Runner
	slots        chan struct{}
	agentsMu     sync.Mutex
	agents       json.RawMessage
	expires      time.Time
}

func New(runner harness.Runner) (*Engine, error) {
	programOnce.Do(func() { program, programError = goja.Compile("opsis-workflows.js", source, true) })
	if programError != nil {
		return nil, programError
	}
	return &Engine{Runner: runner, slots: make(chan struct{}, 2)}, nil
}

func encode(value any) string { data, _ := json.Marshal(value); return string(data) }
func response(value any, err error) string {
	if err != nil {
		var code harness.Error
		if !errors.As(err, &code) {
			code = harness.Error("harness_exit")
		}
		return encode(map[string]any{"error": code.Error()})
	}
	return encode(map[string]any{"value": value})
}

// Each workflow receives an isolated VM and fixed native capabilities. Its JSON
// input is data; all validation, prompts, repair policy and review decisions use
// the same TS feature modules as the browser API, without a Node process.
func (e *Engine) execute(ctx context.Context, method string, args []string, progress func(json.RawMessage)) (json.RawMessage, error) {
	vm := goja.New()
	providerSession := &providerSession{pending: map[string]string{}}
	defer providerSession.close()
	_ = vm.Set("nativeProviderKey", func(provider string) string {
		if e.ProviderKeys == nil {
			return ""
		}
		return e.ProviderKeys.Get(provider)
	})
	_ = vm.Set("nativeProviderHttp", func(raw string) string {
		var input providerRequest
		if json.Unmarshal([]byte(raw), &input) != nil {
			return response(nil, harness.Error("harness_config"))
		}
		value, err := providerSession.send(ctx, input)
		return response(value, err)
	})
	_ = vm.Set("nativeProviderPause", func() {
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	})
	approved := make(map[string]bool)
	_ = vm.Set("nativeCancelled", func() bool { return ctx.Err() != nil })
	_ = vm.Set("nativeProgress", func(data string) {
		if progress != nil && ctx.Err() == nil {
			progress(json.RawMessage(data))
		}
	})
	_ = vm.Set("nativePrepareClient", func(agent, configuredPath string) string {
		executable, version, err := harness.ProbePath(ctx, e.Runner, agent, configuredPath)
		if err == nil {
			approved[executable] = true
		}
		return response(map[string]string{"executable": executable, "version": version}, err)
	})
	_ = vm.Set("nativeDecodeFile", func(data string) string {
		bytes, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			bytes, err = base64.RawStdEncoding.DecodeString(data)
		}
		if err != nil {
			panic(vm.NewGoError(errors.New("invalid attachment encoding")))
		}
		return encode(map[string]any{"data": base64.StdEncoding.EncodeToString(bytes), "text": strings.ToValidUTF8(string(bytes), "\uFFFD"), "length": len(bytes)})
	})
	_ = vm.Set("nativeExtname", func(name string) string {
		base := path.Base(name)
		extension := path.Ext(base)
		if extension == base || base == ".." || base == "." {
			return ""
		}
		return extension
	})
	_ = vm.Set("nativePdfText", func(data string) string {
		bytes, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return ""
		}
		output, err := e.Runner.Run(ctx, harness.Request{Executable: "pdftotext", Args: []string{"-layout", "-enc", "UTF-8", "-", "-"}, Stdin: string(bytes), Environment: harness.ChildEnvironment(), Timeout: 20 * time.Second, MaxInput: 10 * 1024 * 1024, MaxOutput: 8 * 1024 * 1024, MaxError: 8 * 1024 * 1024}, nil)
		if err != nil {
			return ""
		}
		return output
	})
	_ = vm.Set("nativeComplete", func(call goja.FunctionCall) goja.Value {
		var input harness.Completion
		if json.Unmarshal([]byte(call.Argument(0).String()), &input) != nil || !approved[input.Executable] {
			return vm.ToValue(response(nil, harness.Error("harness_config")))
		}
		arguments, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			return vm.ToValue(response(nil, harness.Error("harness_config")))
		}
		onLine, ok := goja.AssertFunction(call.Argument(2))
		if !ok {
			return vm.ToValue(response(nil, harness.Error("harness_config")))
		}
		local, cancel := context.WithCancel(ctx)
		defer cancel()
		output, err := harness.Complete(local, e.Runner, input, func(schema string, paths []string) ([]string, error) {
			value, err := arguments(goja.Undefined(), vm.ToValue(schema), vm.ToValue(encode(paths)))
			if err != nil {
				return nil, err
			}
			var args []string
			err = json.Unmarshal([]byte(value.String()), &args)
			return args, err
		}, func(line string) {
			if _, err := onLine(goja.Undefined(), vm.ToValue(line)); err != nil {
				cancel()
			}
		})
		return vm.ToValue(response(map[string]string{"stdout": output}, err))
	})
	finished := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			vm.Interrupt("workflow cancelled")
		case <-finished:
		}
	}()
	defer close(finished)
	if _, err := vm.RunProgram(program); err != nil {
		return nil, err
	}
	function, ok := goja.AssertFunction(vm.Get("OpsisWorkflows").ToObject(vm).Get(method))
	if !ok {
		return nil, errors.New("missing workflow entrypoint")
	}
	values := make([]goja.Value, len(args))
	for i, arg := range args {
		values[i] = vm.ToValue(arg)
	}
	value, err := function(goja.Undefined(), values...)
	if err != nil {
		return nil, err
	}
	promise, ok := value.Export().(*goja.Promise)
	if !ok || promise.State() != goja.PromiseStateFulfilled {
		return nil, errors.New("workflow did not finish")
	}
	return json.RawMessage(promise.Result().String()), nil
}

func (e *Engine) Run(ctx context.Context, operation string, body json.RawMessage, progress func(json.RawMessage)) (Outcome, error) {
	select {
	case e.slots <- struct{}{}:
		defer func() { <-e.slots }()
	case <-ctx.Done():
		return Outcome{}, ctx.Err()
	}
	result, err := e.execute(ctx, "run", []string{operation, string(body)}, progress)
	if err != nil {
		return Outcome{}, err
	}
	var outcome Outcome
	err = json.Unmarshal(result, &outcome)
	return outcome, err
}

func (e *Engine) Agents(ctx context.Context) (json.RawMessage, error) {
	e.agentsMu.Lock()
	defer e.agentsMu.Unlock()
	if time.Now().Before(e.expires) {
		return e.agents, nil
	}
	result, err := e.execute(ctx, "agents", nil, nil)
	if err != nil {
		return nil, err
	}
	e.agents = result
	e.expires = time.Now().Add(30 * time.Second)
	return result, nil
}
