# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/tools/internal_component_move_tool'

# #467 final cleanup: the viewport gesture commits ONLY on the axis Granete
# published (authoringCapability.axis → explicit index mapping), fails closed
# on an invalid/missing axis before the tool exists, and Esc never produces a
# semantic commit.
class InternalComponentMoveToolTest < Minitest::Test
  def build_tool(axis, base = [10.0, 20.0, 30.0])
    commits = []
    tool = Granete::SketchUpExtension::Tools::InternalComponentMoveTool.new(
      furniture: Object.new, child: nil, base_translation_mm: base,
      authoring_axis: axis
    ) { |translation| commits << translation }
    [tool, commits]
  end

  def test_commit_modifies_only_the_published_axis
    cases = {
      'x' => [15.0, 20.0, 30.0],
      'y' => [10.0, 25.0, 30.0],
      'z' => [10.0, 20.0, 35.0]
    }
    cases.each do |axis, expected|
      tool, commits = build_tool(axis)
      tool.instance_variable_set(:@delta_mm, 5.0)
      tool.send(:commit)
      assert_equal 1, commits.length, "axis #{axis} commits exactly once"
      assert_equal expected, commits.first, "axis #{axis} changes only its own component"
    end
  end

  def test_invalid_or_missing_axis_fails_closed_before_the_tool_starts
    assert_raises(ArgumentError) { build_tool('w') }
    assert_raises(ArgumentError) { build_tool(nil) }
  end

  def test_cancel_commits_nothing_and_disables_the_tool
    tool, commits = build_tool('z')
    tool.instance_variable_set(:@delta_mm, 5.0)
    tool.onCancel(nil, Object.new)
    assert_empty commits, 'Esc never produces a semantic commit'
    tool.send(:commit)
    assert_empty commits, 'a cancelled tool cannot commit afterwards'
  end

  def test_commit_is_single_shot
    tool, commits = build_tool('z')
    tool.instance_variable_set(:@delta_mm, 5.0)
    tool.send(:commit)
    tool.send(:commit)
    assert_equal 1, commits.length
  end
end
