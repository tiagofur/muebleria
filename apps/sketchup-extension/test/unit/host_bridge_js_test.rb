# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #498 versioned bridge
# (granete-bridge.js) through Node: drives the actual module file in a vm
# sandbox and asserts fail-closed envelope validation, correlation ids and
# neutral semantic targets (componentInstanceId / hardwarePlacementId).
class HostBridgeJsTest < Minitest::Test
  def test_real_javascript_harness_executes_and_passes
    js_test_path = File.expand_path('../js/host_bridge_test.js', __dir__)
    assert File.exist?(js_test_path), 'host_bridge_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript host-bridge test failed: #{stderr}\n#{stdout}"

    json_line = stdout.lines.reverse.find { |line| line.strip.start_with?('{') }
    result = JSON.parse(json_line || stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 10,
                    'host-bridge harness must keep covering validation, correlation and targets'
  end
end
