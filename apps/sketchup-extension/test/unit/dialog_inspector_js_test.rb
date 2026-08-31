# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #476 contextual inspector
# (dialog.html) through Node: it renders SelectionContext payloads in the
# actual dialog script and proves capability-driven gating, breadcrumb
# navigation, provenance copy, unmanaged state and multi-selection
# fail-closed behavior — the HtmlDialog half the Ruby payload tests can't
# cover.
class DialogInspectorJsTest < Minitest::Test
  def test_real_javascript_inspector_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_inspector_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_inspector_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript inspector test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 50,
                    'inspector harness must keep covering gating, breadcrumb, ' \
                    'provenance, unmanaged and multi-selection'
  end
end
