package testshard

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func writeTestSource(t *testing.T, source string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample_test.go"), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestDiscoverFilesAcceptsOnlyTopLevelTestingT(t *testing.T) {
	dir := writeTestSource(t, `package sample
import tt "testing"
func TestAlpha(t *tt.T) {}
func helper(t *tt.T) {}
func BenchmarkAlpha(b *tt.B) {}
func ExampleAlpha() {}
type suite struct{}
func (suite) TestMethod(t *tt.T) {}
func TestBad() {}
func TestMany(a, b *tt.T) {}
func TestResult(t *tt.T) error { return nil }
`)
	if err := os.WriteFile(filepath.Join(dir, "dot_test.go"), []byte("package sample\nimport . \"testing\"\nfunc TestDot(t *T) {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	tests, err := DiscoverFiles(dir, []string{"sample_test.go", "dot_test.go"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := Names(tests), []string{"TestAlpha", "TestDot"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("names = %v, want %v", got, want)
	}
}

func TestDiscoverUsesGoListForActiveFiles(t *testing.T) {
	dir := t.TempDir()
	for path, source := range map[string]string{
		"go.mod":          "module example.com/sample\n\ngo 1.25.0\n",
		"active_test.go":  "package sample\nimport \"testing\"\nfunc TestActive(t *testing.T) {}\n",
		"ignored_test.go": "//go:build never\n\npackage sample\nimport \"testing\"\nfunc TestIgnored(t *testing.T) {}\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, path), []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	tests, err := Discover(".", dir)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := Names(tests), []string{"TestActive"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("names = %v, want %v", got, want)
	}
}

func TestDiscoverFilesFailsClosed(t *testing.T) {
	dir := writeTestSource(t, "package sample\nfunc TestBroken(")
	if _, err := DiscoverFiles(dir, []string{"sample_test.go"}); err == nil {
		t.Fatal("expected parse error")
	}
}

func TestDiscoverFilesRejectsDuplicateIdentity(t *testing.T) {
	dir := t.TempDir()
	for _, file := range []string{"a_test.go", "b_test.go"} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte("package sample\nimport \"testing\"\nfunc TestDuplicate(t *testing.T) {}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := DiscoverFiles(dir, []string{"a_test.go", "b_test.go"}); err == nil {
		t.Fatal("expected duplicate error")
	}
}

func TestAssignmentProvesUnionIntersectionsAndCardinality(t *testing.T) {
	tests := named("TestA", "TestB", "TestC", "TestD", "TestE", "TestF")
	shards, err := Assign(tests, 3, StrategyHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPartition(tests, shards); err != nil {
		t.Fatal(err)
	}
	if got := len(shards[0].Tests) + len(shards[1].Tests) + len(shards[2].Tests); got != len(tests) {
		t.Fatalf("cardinality = %d", got)
	}
}

func TestAssignmentIsDeterministic(t *testing.T) {
	tests := named("TestA", "TestB", "TestC", "TestD")
	first, err := Assign(tests, 3, StrategyHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Assign(tests, 3, StrategyHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("assignments differ: %#v vs %#v", first, second)
	}
}

func TestNewSyntheticTestIsAutomaticallyAssignedExactlyOnce(t *testing.T) {
	tests := named("TestExisting", "TestNew")
	shards, err := Assign(tests, 2, StrategyHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, shard := range shards {
		for _, test := range shard.Tests {
			if test.Name == "TestNew" {
				count++
			}
		}
	}
	if count != 1 {
		t.Fatalf("TestNew assigned %d times", count)
	}
}

func TestSubtestsRemainWithTopLevelRoot(t *testing.T) {
	tests := named("TestParent", "TestOther")
	shards, err := Assign(tests, 2, StrategyHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, shard := range shards {
		for _, test := range shard.Tests {
			if strings.Contains(test.Name, "/") {
				t.Fatalf("subtest was independently assigned: %q", test.Name)
			}
		}
	}
}

func TestAssignmentRejectsInvalidShardMetadata(t *testing.T) {
	tests := named("TestA")
	for _, count := range []int{0, 2} {
		if _, err := Assign(tests, count, StrategyHash, nil); err == nil {
			t.Fatalf("count %d unexpectedly accepted", count)
		}
	}
	if _, err := SelectShard(tests, 2, 2, StrategyHash, nil); err == nil {
		t.Fatal("expected invalid index error")
	}
}

func TestVerifyPartitionRejectsMissingDuplicateAndZeroShard(t *testing.T) {
	tests := named("TestA", "TestB")
	cases := []struct {
		name   string
		shards []Shard
	}{
		{"missing", []Shard{{Index: 0, Tests: named("TestA")}, {Index: 1, Tests: nil}}},
		{"duplicate", []Shard{{Index: 0, Tests: named("TestA")}, {Index: 1, Tests: named("TestA", "TestB")}}},
		{"unexpected", []Shard{{Index: 0, Tests: named("TestA")}, {Index: 1, Tests: named("TestB", "TestOther")}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := VerifyPartition(tests, tc.shards); err == nil {
				t.Fatal("expected failure")
			}
		})
	}
}

func TestLPTAssignsUnknownTimingAndIsDeterministic(t *testing.T) {
	tests := named("TestSlow", "TestKnown", "TestUnknown", "TestOther")
	timings := map[string]time.Duration{"TestSlow": 10 * time.Second, "TestKnown": 2 * time.Second, "TestOther": time.Second}
	first, err := Assign(tests, 2, StrategyLPT, timings)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Assign(tests, 2, StrategyLPT, timings)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("LPT assignment was not deterministic")
	}
	if err := VerifyPartition(tests, first); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, shard := range first {
		for _, test := range shard.Tests {
			found = found || test.Name == "TestUnknown"
		}
	}
	if !found {
		t.Fatal("unknown-timing test omitted")
	}
}

func TestBuildRunRegexIsAnchoredAndEscaped(t *testing.T) {
	regex, err := BuildRunRegex(named("TestAlpha", "TestDollar$"))
	if err != nil {
		t.Fatal(err)
	}
	if regex != "^(TestAlpha|TestDollar\\$)$" {
		t.Fatalf("regex = %q", regex)
	}
	compiled, err := regexp.Compile(regex)
	if err != nil {
		t.Fatal(err)
	}
	if !compiled.MatchString("TestDollar$") || compiled.MatchString("TestDollar$x") || compiled.MatchString("prefixTestAlpha") {
		t.Fatal("selection was not an exact safe match")
	}
	if _, err := BuildRunRegex(nil); err == nil {
		t.Fatal("expected empty selection failure")
	}
}

func TestParseGoTestJSONRejectsZeroMissingAndUnexpectedRoots(t *testing.T) {
	expected := named("TestA", "TestB")
	cases := []struct {
		name, input string
		wantErr     bool
	}{
		{"complete", `{"Action":"run","Test":"TestA"}\n{"Action":"pass","Test":"TestA"}\n{"Action":"run","Test":"TestB"}\n{"Action":"pass","Test":"TestB"}\n`, false},
		{"zero", `{"Action":"pass","Package":"example"}\n`, true},
		{"missing", `{"Action":"run","Test":"TestA"}\n{"Action":"pass","Test":"TestA"}\n`, true},
		{"unexpected", `{"Action":"run","Test":"TestA"}\n{"Action":"pass","Test":"TestA"}\n{"Action":"run","Test":"TestOther"}\n{"Action":"pass","Test":"TestOther"}\n`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseGoTestJSON(strings.NewReader(strings.ReplaceAll(tc.input, `\n`, "\n")), expected)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestParseVerboseTimingsUsesTopLevelTestsOnly(t *testing.T) {
	timings, err := ParseVerboseTimings(strings.NewReader("--- PASS: TestParent (2.50s)\n    --- PASS: TestParent/child (1.00s)\n--- PASS: TestOther (0.25s)\n"))
	if err != nil {
		t.Fatal(err)
	}
	if got := timings["TestParent"]; got != 2500*time.Millisecond {
		t.Fatalf("parent = %s", got)
	}
	if _, ok := timings["TestParent/child"]; ok {
		t.Fatal("subtest timing must not be a shard root")
	}
}

func named(names ...string) []Test {
	out := make([]Test, len(names))
	for i, name := range names {
		out[i] = Test{Name: name}
	}
	return out
}

func TestStorageDiscoveryPartitionsAllRoots(t *testing.T) {
	moduleRoot := filepath.Clean(filepath.Join("..", ".."))
	tests, err := Discover("./internal/storage", moduleRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, count := range []int{3, 4} {
		shards, err := Assign(tests, count, StrategyHash, nil)
		if err != nil {
			t.Fatalf("assign %d shards: %v", count, err)
		}
		if err := VerifyPartition(tests, shards); err != nil {
			t.Fatalf("verify %d shards: %v", count, err)
		}
	}
}
