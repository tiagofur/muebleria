// Package testshard discovers and deterministically partitions Go test roots.
package testshard

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"hash/fnv"
	"io"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Test is a top-level Go test root. Subtests are deliberately not represented.
type Test struct {
	Name string `json:"name"`
	File string `json:"file,omitempty"`
}

// Strategy controls deterministic test allocation.
type Strategy string

const (
	// StrategyHash ranks roots by FNV-1a then deals them round-robin so every
	// valid shard count receives a root without retaining a manual test list.
	StrategyHash Strategy = "hash"
	// StrategyLPT greedily assigns longest estimated roots first.
	StrategyLPT Strategy = "lpt"
)

// Shard is a complete top-level-root allocation and its estimated duration.
type Shard struct {
	Index     int           `json:"index"`
	Tests     []Test        `json:"tests"`
	Estimated time.Duration `json:"estimated_nanoseconds"`
}

type goList struct {
	Dir          string
	TestGoFiles  []string
	XTestGoFiles []string
}

// Discover uses go list solely to select active test files, then parses the
// current source with Go's AST. It rejects no-test and malformed packages.
func Discover(packagePath string, workingDir string) ([]Test, error) {
	command := exec.Command("go", "list", "-json", packagePath)
	command.Dir = workingDir
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("resolve active Go files for %q: %w", packagePath, err)
	}
	var listed goList
	if err := json.Unmarshal(output, &listed); err != nil {
		return nil, fmt.Errorf("decode go list for %q: %w", packagePath, err)
	}
	if listed.Dir == "" {
		return nil, fmt.Errorf("go list for %q returned no directory", packagePath)
	}
	files := append(append([]string{}, listed.TestGoFiles...), listed.XTestGoFiles...)
	if len(files) == 0 {
		return nil, fmt.Errorf("package %q has no active test files", packagePath)
	}
	return DiscoverFiles(listed.Dir, files)
}

// DiscoverFiles parses selected package files and returns only valid test roots.
func DiscoverFiles(directory string, files []string) ([]Test, error) {
	if len(files) == 0 {
		return nil, errors.New("no active test files")
	}
	set := token.NewFileSet()
	found := make([]Test, 0)
	seen := make(map[string]string)
	for _, fileName := range files {
		path := filepath.Join(directory, fileName)
		file, err := parser.ParseFile(set, path, nil, parser.ParseComments)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", fileName, err)
		}
		imports := testingImports(file)
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || !isTestFunction(function, imports) {
				continue
			}
			if previous, exists := seen[function.Name.Name]; exists {
				return nil, fmt.Errorf("duplicate canonical test identity %q in %s and %s", function.Name.Name, previous, fileName)
			}
			seen[function.Name.Name] = fileName
			found = append(found, Test{Name: function.Name.Name, File: fileName})
		}
	}
	if len(found) == 0 {
		return nil, errors.New("discovery found no top-level TestXxx functions")
	}
	sortTests(found)
	return found, nil
}

func testingImports(file *ast.File) map[string]bool {
	imports := make(map[string]bool)
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil || path != "testing" {
			continue
		}
		name := "testing"
		if spec.Name != nil {
			name = spec.Name.Name
		}
		imports[name] = true
	}
	return imports
}

func isTestFunction(function *ast.FuncDecl, imports map[string]bool) bool {
	if function.Recv != nil || function.Name == nil || !isTestName(function.Name.Name) || function.Type == nil {
		return false
	}
	if function.Type.Results != nil && len(function.Type.Results.List) != 0 {
		return false
	}
	parameters := function.Type.Params
	if parameters == nil || len(parameters.List) != 1 {
		return false
	}
	parameter := parameters.List[0]
	if len(parameter.Names) != 1 {
		return false
	}
	pointer, ok := parameter.Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	switch expression := pointer.X.(type) {
	case *ast.SelectorExpr:
		qualifier, ok := expression.X.(*ast.Ident)
		return ok && imports[qualifier.Name] && expression.Sel != nil && expression.Sel.Name == "T"
	case *ast.Ident:
		return imports["."] && expression.Name == "T"
	default:
		return false
	}
}

func isTestName(name string) bool {
	if !strings.HasPrefix(name, "Test") || len(name) == len("Test") {
		return false
	}
	first, _ := utf8Rune(name[len("Test"):])
	return !unicode.IsLower(first)
}

func utf8Rune(value string) (rune, int) {
	for _, r := range value {
		return r, len(string(r))
	}
	return 0, 0
}

// Names returns sorted canonical identities.
func Names(tests []Test) []string {
	names := make([]string, len(tests))
	for i, test := range tests {
		names[i] = test.Name
	}
	sort.Strings(names)
	return names
}

// Assign partitions all test roots. Unknown LPT timing receives the positive
// median known duration, or one millisecond when no historical data exists.
func Assign(tests []Test, count int, strategy Strategy, timings map[string]time.Duration) ([]Shard, error) {
	if err := validateTests(tests); err != nil {
		return nil, err
	}
	if count <= 0 || count > len(tests) {
		return nil, fmt.Errorf("invalid shard count %d for %d tests", count, len(tests))
	}
	shards := make([]Shard, count)
	for index := range shards {
		shards[index].Index = index
	}
	sorted := append([]Test(nil), tests...)
	switch strategy {
	case StrategyHash:
		sort.Slice(sorted, func(i, j int) bool {
			left, right := stableHash(sorted[i].Name), stableHash(sorted[j].Name)
			if left == right {
				return sorted[i].Name < sorted[j].Name
			}
			return left < right
		})
		for index, test := range sorted {
			add(&shards[index%count], test, estimate(test.Name, timings))
		}
	case StrategyLPT:
		fallback := medianTiming(timings)
		sort.Slice(sorted, func(i, j int) bool {
			left, right := estimateWithFallback(sorted[i].Name, timings, fallback), estimateWithFallback(sorted[j].Name, timings, fallback)
			if left == right {
				return sorted[i].Name < sorted[j].Name
			}
			return left > right
		})
		for _, test := range sorted {
			index := leastLoaded(shards)
			add(&shards[index], test, estimateWithFallback(test.Name, timings, fallback))
		}
	default:
		return nil, fmt.Errorf("unsupported assignment strategy %q", strategy)
	}
	for index := range shards {
		sortTests(shards[index].Tests)
	}
	if err := VerifyPartition(tests, shards); err != nil {
		return nil, err
	}
	return shards, nil
}

func SelectShard(tests []Test, count, index int, strategy Strategy, timings map[string]time.Duration) (Shard, error) {
	shards, err := Assign(tests, count, strategy, timings)
	if err != nil {
		return Shard{}, err
	}
	if index < 0 || index >= len(shards) {
		return Shard{}, fmt.Errorf("invalid shard index %d for %d shards", index, len(shards))
	}
	return shards[index], nil
}

// VerifyPartition fail-closes missing, duplicate, unexpected, or empty shards.
func VerifyPartition(tests []Test, shards []Shard) error {
	if err := validateTests(tests); err != nil {
		return err
	}
	if len(shards) == 0 {
		return errors.New("partition has no shards")
	}
	expected := make(map[string]struct{}, len(tests))
	for _, test := range tests {
		expected[test.Name] = struct{}{}
	}
	seen := make(map[string]int, len(tests))
	for position, shard := range shards {
		if shard.Index != position {
			return fmt.Errorf("inconsistent shard metadata: position %d has index %d", position, shard.Index)
		}
		if len(shard.Tests) == 0 {
			return fmt.Errorf("shard %d has zero tests", shard.Index)
		}
		for _, test := range shard.Tests {
			if _, ok := expected[test.Name]; !ok {
				return fmt.Errorf("shard %d contains unexpected test %q", shard.Index, test.Name)
			}
			seen[test.Name]++
			if seen[test.Name] > 1 {
				return fmt.Errorf("test %q appears in multiple shards", test.Name)
			}
		}
	}
	for name := range expected {
		if seen[name] != 1 {
			return fmt.Errorf("test %q is not assigned", name)
		}
	}
	return nil
}

func validateTests(tests []Test) error {
	if len(tests) == 0 {
		return errors.New("test suite is empty")
	}
	seen := make(map[string]struct{}, len(tests))
	for _, test := range tests {
		if test.Name == "" || strings.Contains(test.Name, "/") {
			return fmt.Errorf("invalid top-level test identity %q", test.Name)
		}
		if _, exists := seen[test.Name]; exists {
			return fmt.Errorf("duplicate test identity %q", test.Name)
		}
		seen[test.Name] = struct{}{}
	}
	return nil
}

func stableHash(name string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	return h.Sum64()
}
func add(shard *Shard, test Test, duration time.Duration) {
	shard.Tests = append(shard.Tests, test)
	shard.Estimated += duration
}
func estimate(name string, timings map[string]time.Duration) time.Duration {
	return estimateWithFallback(name, timings, time.Millisecond)
}
func estimateWithFallback(name string, timings map[string]time.Duration, fallback time.Duration) time.Duration {
	if duration, ok := timings[name]; ok {
		return duration
	}
	return fallback
}
func leastLoaded(shards []Shard) int {
	best := 0
	for index := 1; index < len(shards); index++ {
		if shards[index].Estimated < shards[best].Estimated {
			best = index
		}
	}
	return best
}
func medianTiming(timings map[string]time.Duration) time.Duration {
	values := make([]time.Duration, 0, len(timings))
	for _, value := range timings {
		if value > 0 {
			values = append(values, value)
		}
	}
	if len(values) == 0 {
		return time.Millisecond
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return values[len(values)/2]
}
func sortTests(tests []Test) {
	sort.Slice(tests, func(i, j int) bool { return tests[i].Name < tests[j].Name })
}

// BuildRunRegex creates an exact, escaped selection for Go's -run flag.
func BuildRunRegex(tests []Test) (string, error) {
	if err := validateTests(tests); err != nil {
		return "", err
	}
	names := Names(tests)
	for index, name := range names {
		names[index] = regexp.QuoteMeta(name)
	}
	return "^(" + strings.Join(names, "|") + ")$", nil
}

// ExecutionReport proves the exact requested roots ran and passed.
type ExecutionReport struct {
	Expected []string `json:"expected"`
	Executed []string `json:"executed"`
}

// ParseGoTestJSON verifies complete top-level execution from go test -json output.
func ParseGoTestJSON(reader io.Reader, expected []Test) (ExecutionReport, error) {
	if err := validateTests(expected); err != nil {
		return ExecutionReport{}, err
	}
	wanted := make(map[string]struct{}, len(expected))
	for _, test := range expected {
		wanted[test.Name] = struct{}{}
	}
	executed := make(map[string]struct{}, len(expected))
	decoder := json.NewDecoder(reader)
	for decoder.More() {
		var event struct{ Action, Test string }
		if err := decoder.Decode(&event); err != nil {
			return ExecutionReport{}, fmt.Errorf("decode go test json: %w", err)
		}
		if event.Test == "" {
			continue
		}
		root := strings.SplitN(event.Test, "/", 2)[0]
		if _, ok := wanted[root]; !ok {
			return ExecutionReport{}, fmt.Errorf("unexpected executed test %q", event.Test)
		}
		if event.Action == "skip" {
			return ExecutionReport{}, fmt.Errorf("selected test %q skipped", event.Test)
		}
		if event.Test != root || event.Action != "pass" {
			continue
		}
		executed[root] = struct{}{}
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err != nil {
			return ExecutionReport{}, fmt.Errorf("decode go test json: %w", err)
		}
	}
	if len(executed) == 0 {
		return ExecutionReport{}, errors.New("zero tests executed")
	}
	if len(executed) != len(wanted) {
		return ExecutionReport{}, fmt.Errorf("missing executed tests: got %d, want %d", len(executed), len(wanted))
	}
	report := ExecutionReport{Expected: Names(expected)}
	for name := range executed {
		report.Executed = append(report.Executed, name)
	}
	sort.Strings(report.Executed)
	return report, nil
}

var timingLine = regexp.MustCompile(`^\s*--- PASS: (Test[^[:space:]]+) \(([0-9]+(?:\.[0-9]+)?)s\)$`)

// ParseVerboseTimings extracts top-level timing hints from verbose go test output.
func ParseVerboseTimings(reader io.Reader) (map[string]time.Duration, error) {
	timings := make(map[string]time.Duration)
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		match := timingLine.FindStringSubmatch(scanner.Text())
		if match == nil || strings.Contains(match[1], "/") {
			continue
		}
		seconds, err := strconv.ParseFloat(match[2], 64)
		if err != nil {
			return nil, fmt.Errorf("parse timing %q: %w", match[2], err)
		}
		timings[match[1]] = time.Duration(seconds * float64(time.Second))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read timing log: %w", err)
	}
	return timings, nil
}
