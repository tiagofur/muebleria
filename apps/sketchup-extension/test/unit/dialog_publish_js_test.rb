# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #392 / DT-8 publish panel
# (dialog.html) through Node: drives the actual dialog script and asserts the
# publish button availability (connected + can_publish_revision only), the
# honest progress steps, the success/failure rendering and in-flight
# re-entry protection — the HtmlDialog half the Ruby publisher tests can't
# cover.
class DialogPublishJsTest < Minitest::Test
  def test_real_javascript_publish_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_publish_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_publish_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript publish test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 9,
                    'publish harness must keep covering availability, progress, ' \
                    'success/failure rendering and re-entry protection'
  end
end
