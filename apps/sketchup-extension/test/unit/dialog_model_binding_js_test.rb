# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #388 model binding panel
# (dialog.html) through Node: renders binding status payloads in the actual
# dialog script and proves the distinct states, the project/design picker,
# the explicit rebind review and fail-closed error rendering — the HtmlDialog
# half the Ruby connector tests can't cover.
class DialogModelBindingJsTest < Minitest::Test
  def test_real_javascript_model_binding_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_model_binding_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_model_binding_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript model binding test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 9,
                    'model binding harness must keep covering states, picker, ' \
                    'rebind review and error rendering'
  end
end
