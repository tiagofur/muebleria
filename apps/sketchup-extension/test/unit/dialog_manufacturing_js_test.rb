# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #470 manufacturing inspection
# controller (granete-manufacturing.js) through Node: validated envelopes,
# read-only command submission, honest stale/unavailable copy and rendering
# driven only by the Ruby state.
class DialogManufacturingJsTest < Minitest::Test
  def test_real_javascript_harness_executes_and_passes
    js_test_path = File.expand_path('../js/manufacturing_test.js', __dir__)
    assert File.exist?(js_test_path), 'manufacturing_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript manufacturing test failed: #{stderr}\n#{stdout}"

    assert_match(/manufacturing_test: \d+ passed/, stdout)
    tests = stdout.match(/manufacturing_test: (\d+) passed/)[1].to_i
    assert_operator tests, :>=, 8,
                    'manufacturing harness must keep covering envelopes, commands and rendering'
  end
end
