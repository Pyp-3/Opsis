//go:build !windows

package updater

import "errors"

func Launch(string) error { return errors.New("in-app updates are only available on Windows") }
