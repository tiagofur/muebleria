# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #563: Runs the real-JavaScript harness for the enrollment flow (dialog.html)
# through Node: asserts 5s poll interval, countdown display, copy button,
# web devices link, and resilient error handling (429 does not abort enrollment).
class DialogEnrollmentJsTest < Minitest::Test
  def test_real_javascript_enrollment_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_enrollment_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_enrollment_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript enrollment test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 7,
                    'enrollment harness must cover 5s polling, countdown, copy, web link and 429 resilience'
  end
end
