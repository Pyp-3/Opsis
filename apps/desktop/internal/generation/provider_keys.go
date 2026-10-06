package generation

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var apiKeyPattern = regexp.MustCompile(`^[\x21-\x7e]+$`)
var APIProviders = []string{"kimi", "grok", "antigravity"}

type ProviderKeys struct {
	mu     sync.RWMutex
	path   string
	values map[string]string
}

func NewProviderKeys(database string) (*ProviderKeys, error) {
	k := &ProviderKeys{values: map[string]string{}}
	if database == ":memory:" {
		return k, nil
	}
	k.path = database + ".provider-keys.json"
	data, err := os.ReadFile(k.path)
	if errors.Is(err, os.ErrNotExist) {
		return k, nil
	}
	if err != nil || len(data) > 30000 || json.Unmarshal(data, &k.values) != nil {
		return nil, errors.New("could not read instance provider keys")
	}
	for provider, key := range k.values {
		if !validProvider(provider) || len(key) > 4096 || !apiKeyPattern.MatchString(key) {
			return nil, errors.New("invalid instance provider keys")
		}
	}
	return k, nil
}
func validProvider(value string) bool {
	for _, provider := range APIProviders {
		if value == provider {
			return true
		}
	}
	return false
}
func (k *ProviderKeys) Get(provider string) string {
	if value := os.Getenv("OPSIS_" + strings.ToUpper(provider) + "_API_KEY"); value != "" {
		return value
	}
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.values[provider]
}
func (k *ProviderKeys) Status() []map[string]any {
	k.mu.RLock()
	defer k.mu.RUnlock()
	result := []map[string]any{}
	for _, provider := range APIProviders {
		source := "none"
		if k.values[provider] != "" {
			source = "instance"
		}
		if os.Getenv("OPSIS_"+strings.ToUpper(provider)+"_API_KEY") != "" {
			source = "environment"
		}
		result = append(result, map[string]any{"id": provider, "configured": source != "none", "source": source})
	}
	return result
}
func (k *ProviderKeys) Set(provider, key string) error {
	if !validProvider(provider) || len(key) > 4096 || (key != "" && !apiKeyPattern.MatchString(key)) {
		return errors.New("invalid provider key")
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	next := map[string]string{}
	for id, value := range k.values {
		next[id] = value
	}
	if key == "" {
		delete(next, provider)
	} else {
		next[provider] = key
	}
	if k.path != "" {
		if err := os.MkdirAll(filepath.Dir(k.path), 0700); err != nil {
			return errors.New("could not save instance provider keys")
		}
		file, err := os.CreateTemp(filepath.Dir(k.path), filepath.Base(k.path)+".*.tmp")
		if err != nil {
			return errors.New("could not save instance provider keys")
		}
		defer os.Remove(file.Name())
		data, _ := json.Marshal(next)
		if _, err = file.Write(data); err == nil {
			err = file.Sync()
		}
		closeError := file.Close()
		if err != nil || closeError != nil {
			return errors.New("could not save instance provider keys")
		}
		if err = os.Rename(file.Name(), k.path); err != nil {
			return errors.New("could not save instance provider keys")
		}
	}
	k.values = next
	return nil
}
