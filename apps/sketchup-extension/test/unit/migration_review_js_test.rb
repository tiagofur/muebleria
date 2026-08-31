# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# Runs the real-JavaScript harness for the #416 migration review dialog
# (migration_review.html) through Node: it renders scan payloads and batch
# reports in the actual dialog script and proves the honest review workflow —
# counts, per-item reasons, disabled migration when nothing is ready, and
# partial/aborted reports that never dress up as total success.
class MigrationReviewJsTest < Minitest::Test
  def test_real_javascript_migration_review_harness_executes_and_passes
    js_test_path = File.expand_path('../js/migration_review_test.js', __dir__)
    assert File.exist?(js_test_path), 'migration_review_test.js must exist'

    stdout, stderr, status = Open3.capture3('node', js_test_path)
    assert status.success?, "JavaScript migration review test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert_equal true, result['success']
    assert_operator result['testsPassed'], :>=, 20,
                    'migration review harness must keep covering counts, reasons, ' \
                    'disabled state and honest partial/aborted reports'
  end
end
