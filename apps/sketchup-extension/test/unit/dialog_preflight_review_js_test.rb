# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #466 preflight review
# controller (granete-preflight-review.js) through Node: status badges,
# issue group rendering, Spanish remediation, navigation actions,
# fallback notes, and publish gating.
class DialogPreflightReviewJsTest < Minitest::Test
  def test_real_javascript_preflight_review_harness_executes_and_passes
    js_test_path = File.expand_path('../js/preflight_review_test.js', __dir__)
    assert File.exist?(js_test_path), 'preflight_review_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript preflight review test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 8,
                    'preflight review harness must cover status, groups, actions, and publish gate'
  end
end
