//go:build desktop

package main

// Wails 2.15 uses UTType for native file dialogs but its manual-build linker
// directives omit the framework. Link it explicitly for both Mac architectures.
// #cgo LDFLAGS: -framework UniformTypeIdentifiers
import "C"
