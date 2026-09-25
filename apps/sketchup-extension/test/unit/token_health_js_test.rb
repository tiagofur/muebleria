# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the static design-token health harness over every HtmlDialog surface:
# each var(--token) reference must resolve inside its own file (or carry an
# inline fallback). A dead token silently erases state signal (the amber
# border of "Guardá este archivo SketchUp" was invisible for months) and no
# copy-level test can catch it.
class TokenHealthJsTest < Minitest::Test
  def test_real_javascript_token_health_harness_executes_and_passes
    js_test_path = File.expand_path('../js/token_health_test.js', __dir__)
    assert File.exist?(js_test_path), 'token_health_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript token health test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['referencesChecked'], :>=, 150,
                    'token health must keep covering every var() reference of the four surfaces'
  end
end
