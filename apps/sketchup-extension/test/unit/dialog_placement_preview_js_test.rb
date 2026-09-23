# frozen_string_literal: true

require 'open3'
require 'json'
require_relative '../test_helper'

# #469 — runs the real dialog.html script through the node harness and pins
# the placement-preview wiring: shared entry points for Proyecto and
# Biblioteca, honest disabled/re-armed button states, cancel leaving the
# unit pending, and the commit flowing through the EXISTING result handlers.
class DialogPlacementPreviewJsTest < Minitest::Test
  def test_real_javascript_placement_preview_harness_executes_and_passes
    path = File.expand_path('../js/dialog_placement_preview_test.js', __dir__)
    stdout, stderr, status = Open3.capture3('node', path)
    assert status.success?, "JavaScript placement preview test failed: #{stderr}\n#{stdout}"

    result = JSON.parse(stdout)
    assert result['success']
    assert_operator result['testsPassed'], :>=, 9
  end
end
