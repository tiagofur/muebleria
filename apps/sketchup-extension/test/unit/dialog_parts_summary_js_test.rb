# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the honest dock piece count
# (review #847): "Aprox." labels for local estimates (definition counts at
# default params, recomputed from CURRENT values after edits) and an
# explicit "se calculan al resolver" when nothing can be estimated — the
# resolved BOM is never fabricated client-side.
class DialogPartsSummaryJsTest < Minitest::Test
  def test_real_javascript_parts_summary_harness_executes_and_passes
    js_test_path = File.expand_path('../js/dialog_parts_summary_test.js', __dir__)
    assert File.exist?(js_test_path), 'dialog_parts_summary_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript parts summary test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 5,
                    'parts summary harness must keep covering estimate ' \
                    'labeling, current-value recomputation and the honest fallback'
  end
end
