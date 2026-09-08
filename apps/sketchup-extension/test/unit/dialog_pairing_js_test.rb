# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #499 Slice 3 pairing entry
# (dialog.html): code submit/Enter wiring, busy states, inline result
# messaging, the raw-code-never-persists rule and the manual-result toast
# regression — the HtmlDialog rendering half the Ruby connector tests
# cannot cover.
class DialogPairingJsTest < Minitest::Test
  def test_real_javascript_pairing_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_pairing_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_pairing_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript pairing test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 8,
                    'pairing harness must keep covering submit, busy, inline ' \
                    'errors, code persistence and manual regression'
  end
end
