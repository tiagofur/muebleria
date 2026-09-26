// testshard discovers, allocates, and verifies Go test shards for #842.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/testshard"
)

func main() {
	if len(os.Args) < 2 {
		fail("usage: testshard <discover|shard|simulate|verify> [flags]")
	}
	switch os.Args[1] {
	case "discover":
		discover(os.Args[2:])
	case "shard":
		shard(os.Args[2:])
	case "simulate":
		simulate(os.Args[2:])
	case "verify":
		verify(os.Args[2:])
	default:
		fail("unknown command %q", os.Args[1])
	}
}

func common(flags *flag.FlagSet) (*string, *string) {
	packagePath := flags.String("package", "./internal/storage", "Go package to discover")
	format := flags.String("format", "text", "text, json, names, or run")
	return packagePath, format
}

func discover(args []string) {
	flags := flag.NewFlagSet("discover", flag.ExitOnError)
	packagePath, format := common(flags)
	flags.Parse(args)
	tests := mustDiscover(*packagePath)
	writeTests(tests, *format)
}

func shard(args []string) {
	flags := flag.NewFlagSet("shard", flag.ExitOnError)
	packagePath, format := common(flags)
	count := flags.Int("count", 0, "number of shards")
	index := flags.Int("index", 0, "one-based shard index")
	strategy := flags.String("strategy", string(testshard.StrategyHash), "hash or lpt")
	timingPath := flags.String("timings", "", "verbose go test timing log")
	flags.Parse(args)
	if *index <= 0 {
		fail("shard index must be one-based and positive")
	}
	tests := mustDiscover(*packagePath)
	selected, err := testshard.SelectShard(tests, *count, *index-1, testshard.Strategy(*strategy), mustTimings(*timingPath))
	if err != nil {
		fail("select shard: %v", err)
	}
	writeShard(selected, *format)
}

func simulate(args []string) {
	flags := flag.NewFlagSet("simulate", flag.ExitOnError)
	packagePath, format := common(flags)
	count := flags.Int("count", 0, "number of shards")
	strategy := flags.String("strategy", string(testshard.StrategyLPT), "hash or lpt")
	timingPath := flags.String("timings", "", "verbose go test timing log")
	flags.Parse(args)
	tests := mustDiscover(*packagePath)
	shards, err := testshard.Assign(tests, *count, testshard.Strategy(*strategy), mustTimings(*timingPath))
	if err != nil {
		fail("simulate: %v", err)
	}
	if *format == "json" {
		writeJSON(shards)
		return
	}
	for _, shard := range shards {
		fmt.Printf("shard %d/%d: tests=%d estimated=%s\n", shard.Index+1, len(shards), len(shard.Tests), shard.Estimated.Round(time.Millisecond))
		for _, test := range shard.Tests {
			fmt.Printf("  %s\n", test.Name)
		}
	}
}

func verify(args []string) {
	flags := flag.NewFlagSet("verify", flag.ExitOnError)
	expectedPath := flags.String("expected", "", "newline-delimited expected top-level roots")
	jsonPath := flags.String("json", "", "go test -json output")
	flags.Parse(args)
	if *expectedPath == "" || *jsonPath == "" {
		fail("verify requires -expected and -json")
	}
	expectedData, err := os.ReadFile(*expectedPath)
	if err != nil {
		fail("read expected: %v", err)
	}
	var expected []testshard.Test
	for _, name := range strings.Fields(string(expectedData)) {
		expected = append(expected, testshard.Test{Name: name})
	}
	file, err := os.Open(*jsonPath)
	if err != nil {
		fail("read json: %v", err)
	}
	defer file.Close()
	report, err := testshard.ParseGoTestJSON(file, expected)
	if err != nil {
		fail("verify execution: %v", err)
	}
	writeJSON(report)
}

func mustDiscover(packagePath string) []testshard.Test {
	tests, err := testshard.Discover(packagePath, "")
	if err != nil {
		fail("discover: %v", err)
	}
	return tests
}
func mustTimings(path string) map[string]time.Duration {
	if path == "" {
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		fail("open timings: %v", err)
	}
	defer file.Close()
	timings, err := testshard.ParseVerboseTimings(file)
	if err != nil {
		fail("parse timings: %v", err)
	}
	return timings
}
func writeTests(tests []testshard.Test, format string) {
	switch format {
	case "json":
		writeJSON(tests)
	case "names":
		for _, test := range tests {
			fmt.Println(test.Name)
		}
	case "text":
		for _, test := range tests {
			fmt.Printf("%s\t%s\n", test.Name, test.File)
		}
	default:
		fail("unsupported format %q", format)
	}
}
func writeShard(shard testshard.Shard, format string) {
	switch format {
	case "json":
		writeJSON(shard)
	case "names":
		for _, test := range shard.Tests {
			fmt.Println(test.Name)
		}
	case "run":
		regex, err := testshard.BuildRunRegex(shard.Tests)
		if err != nil {
			fail("build run regex: %v", err)
		}
		fmt.Println(regex)
	case "text":
		fmt.Printf("shard %d: tests=%d estimated=%s\n", shard.Index+1, len(shard.Tests), shard.Estimated.Round(time.Millisecond))
		for _, test := range shard.Tests {
			fmt.Println(test.Name)
		}
	default:
		fail("unsupported format %q", format)
	}
}
func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		fail("write json: %v", err)
	}
}
func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "testshard: "+format+"\n", args...)
	os.Exit(2)
}
