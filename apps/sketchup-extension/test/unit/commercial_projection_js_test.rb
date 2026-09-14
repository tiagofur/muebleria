# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

class CommercialProjectionJsTest < Minitest::Test
  def test_real_javascript_commercial_projection_harness_executes_and_passes
    path = File.expand_path('../js/commercial_projection_test.js', __dir__)
    stdout, stderr, status = Open3.capture3('node', path)
    assert status.success?, "JavaScript Commercial Projection test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert result['success']
    assert_operator result['testsPassed'], :>=, 25
  end
end
