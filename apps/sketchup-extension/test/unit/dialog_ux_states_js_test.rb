# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the dialog UX polish presentation
# states (dialog.html): no-selection copy, loading skeletons, catalog error
# recovery, visible info/warning toasts, denied canDelete explanation and the
# distinct stale_base binding badge — the HtmlDialog rendering half that Ruby
# payload tests cannot prove.
class DialogUxStatesJsTest < Minitest::Test
  def test_real_javascript_ux_states_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_ux_states_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_ux_states_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript UX states test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 20,
                    'UX states harness must keep covering empty, loading, ' \
                    'error recovery, toast and disabled-reason presentation'
  end
end
