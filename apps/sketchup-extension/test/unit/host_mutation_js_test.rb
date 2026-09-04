# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #498 mutation controller
# (granete-mutation.js) through Node: drives the actual module files in a
# vm sandbox and asserts the interaction state machine, the double-submit
# guard (one command → exactly one Ruby callback), late-response rejection
# by correlation, status copy keyed on outcome/category (never text),
# preflight badge honesty and callback registration surviving reopen.
class HostMutationJsTest < Minitest::Test
  def test_real_javascript_harness_executes_and_passes
    js_test_path = File.expand_path('../js/host_mutation_test.js', __dir__)
    assert File.exist?(js_test_path), 'host_mutation_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript host-mutation test failed: #{stderr}\n#{stdout}"

    json_line = stdout.lines.reverse.find { |line| line.strip.start_with?('{') }
    result = JSON.parse(json_line || stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 16,
                    'host-mutation harness must keep covering the state machine, guards and copy'
  end
end
