# frozen_string_literal: true

require 'json'
require 'open3'
require_relative '../test_helper'

# #1264 — runs the real-JavaScript harness for granete-opening.js (the
# «Apertura» card module under window.GraneteUI.opening) inside CI: the
# filtered options, the read-only resolution, the ONE write carrying draft +
# workingVersion, the INVALID refusal, the requestId correlation, and the
# geometry convergence outcome of #1264 (honest converged/failed feedback —
# never a local guess).
class GraneteOpeningJsTest < Minitest::Test
  def test_real_javascript_opening_harness_executes_and_passes
    js_test_path = File.expand_path('../js/granete_opening_test.js', __dir__)
    assert File.exist?(js_test_path), 'granete_opening_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript opening card test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 10,
                    'opening harness must keep covering: filtered options, read-only fronts, ' \
                    'no-dims truth, ONE write + token, invalid refusal, late-answer discard, ' \
                    'and the #1264 geometry outcome'
  end
end
