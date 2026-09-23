# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/tools/furniture_placement_tool'

# #469 — shared transient placement tool mechanics. These tests pin the
# interaction contract only (no service, no transport, no model mutation):
#   * the preview follows the cursor through View#draw — no entity,
#     definition or metadata is ever created (zero residue by construction);
#   * the semantic anchor corner sits exactly at the inference point, with
#     orientation/rotation math proven on an ASYMMETRIC fixture;
#   * Esc cancels once with zero residue and late events are ignored;
#   * a double click commits exactly once;
#   * deactivation without commit (tool switch / model close) is a cancel;
#   * cursor movement performs InputPoint picking only — no callback, no
#     model access (the tool holds no service handles at all).
class FurniturePlacementToolTest < Minitest::Test
  Tool = Granete::SketchUpExtension::Tools::FurniturePlacementTool
  MM = 25.4

  # Asymmetric cabinet: 800 wide × 560 deep × 2100 high — every axis
  # distinguishable, so a swapped-axis bug cannot pass.
  EXTENTS = { x: 800.0, y: 560.0, z: 2100.0 }.freeze

  # Scriptable InputPoint: each #pick advances to the next scripted
  # position (mm), mimicking host inference output.
  class ScriptedInputPoint
    attr_reader :pick_count, :position

    def initialize(positions_mm)
      @positions = positions_mm
      @index = -1
      @pick_count = 0
      @valid = false
    end

    def pick(_view, x_pos, y_pos, _other = nil)
      _ = x_pos
      _ = y_pos
      @index += 1
      @pick_count += 1
      current = @positions[@index] || @positions.last
      @position = Geom::Point3d.new(current[0] / MM, current[1] / MM, current[2] / MM)
      @valid = true
    end

    def valid?
      @valid
    end
  end

  # Records viewport drawing. Any model access would have to happen through
  # the injected model — see StrictModel.
  class RecordingView
    attr_reader :draw_calls, :invalidations, :texts

    def initialize
      @draw_calls = []
      @invalidations = 0
      @texts = []
      @color = nil
    end

    def invalidate
      @invalidations += 1
    end

    def drawing_color=(color)
      @color = color
    end

    def line_width=(_width); end

    def line_stipple=(_stipple); end

    def draw(mode, points)
      @draw_calls << { mode: mode, points: points.length, color: @color }
    end

    def draw_points(points, _size, _style, _color)
      @draw_calls << { mode: :points, points: points.length, color: @color }
    end

    def draw_text(_point, text, _options = {})
      @texts << text
    end
  end

  # Any call other than select_tool is a contract violation: the transient
  # preview must never touch the model.
  class StrictModel
    attr_reader :selected_tools

    def initialize
      @selected_tools = []
    end

    def select_tool(tool)
      @selected_tools << tool
    end

    def method_missing(name, *_args)
      raise "the placement preview must not touch the model (#{name})"
    end

    def respond_to_missing?(name, _include_private = false)
      name == :select_tool
    end
  end

  def setup
    @model = StrictModel.new
    @view = RecordingView.new
    @commits = []
    @cancels = []
  end

  def tool(positions_mm, anchor: :back_left_bottom)
    input_point = ScriptedInputPoint.new(positions_mm)
    placement_tool = Tool.new(
      label: 'Torre horno', extents_mm: EXTENTS, anchor: anchor,
      on_commit: ->(transform) { @commits << transform },
      on_cancel: ->(reason) { @cancels << reason },
      input_point_factory: -> { input_point },
      model_provider: -> { @model }
    )
    [placement_tool, input_point]
  end

  def move_cursor(placement_tool, times: 1)
    times.times { placement_tool.onMouseMove(0, 10, 10, @view) }
  end

  def point_mm(transform, x_mm, y_mm, z_mm)
    local = Geom::Point3d.new(x_mm / MM, y_mm / MM, z_mm / MM)
    moved = local.transform(transform)
    [(moved.x * MM).round(6), (moved.y * MM).round(6), (moved.z * MM).round(6)]
  end

  def test_cursor_movement_draws_preview_only_no_callbacks_no_model_access
    placement_tool, input_point = tool([[0, 0, 0], [100, 200, 0], [300, 400, 10]])
    placement_tool.activate

    move_cursor(placement_tool, times: 3)
    placement_tool.draw(@view)

    assert_equal 3, input_point.pick_count, 'one pick per mouse move, nothing else'
    assert_equal 3, @view.invalidations
    refute_empty @view.draw_calls, 'the transient preview must be visible'
    assert_empty @commits
    assert_empty @cancels
    assert_empty @model.selected_tools, 'preview must not touch the model'
    assert placement_tool.active?
  end

  def test_preview_box_draws_twelve_edges_front_face_and_visible_anchor
    placement_tool, = tool([[100, 200, 0]])
    move_cursor(placement_tool)
    placement_tool.draw(@view)

    lines = @view.draw_calls.find { |call| call[:mode] == GL_LINES }
    refute_nil lines
    assert_equal 24, lines[:points], 'box wireframe: 12 edges × 2 points'
    front = @view.draw_calls.find { |call| call[:mode] == GL_LINE_LOOP }
    refute_nil front, 'the +Y (front) face must be highlighted'
    assert_equal 4, front[:points]
    assert(@view.texts.any? { |text| text.include?('Ancla') },
           'the active anchor must be visibly labelled')
  end

  def test_no_draw_before_first_cursor_position
    placement_tool, = tool([[0, 0, 0]])
    placement_tool.activate
    placement_tool.draw(@view)
    assert_empty @view.draw_calls
  end

  # BACK_LEFT_BOTTOM anchor, no rotation: the local back-left-bottom corner
  # sits at the cursor and the extents grow along the world axes.
  def test_anchor_back_left_bottom_maps_corner_to_cursor_asymmetric_fixture
    placement_tool, = tool([[1000.0, 2000.0, 30.0]])
    move_cursor(placement_tool)

    transform = placement_tool.current_transform
    assert_equal [1000.0, 2000.0, 30.0], point_mm(transform, 0, 0, 0)
    assert_equal [1800.0, 2000.0, 30.0], point_mm(transform, EXTENTS[:x], 0, 0)
    assert_equal [1000.0, 2560.0, 30.0], point_mm(transform, 0, EXTENTS[:y], 0)
    assert_equal [1000.0, 2000.0, 2130.0], point_mm(transform, 0, 0, EXTENTS[:z])
  end

  # FRONT_RIGHT_BOTTOM: the opposite corner is now the grab point.
  def test_anchor_front_right_bottom_maps_its_corner_to_cursor
    placement_tool, = tool([[500.0, 700.0, 0.0]], anchor: :front_right_bottom)
    move_cursor(placement_tool)

    transform = placement_tool.current_transform
    assert_equal [500.0, 700.0, 0.0], point_mm(transform, EXTENTS[:x], EXTENTS[:y], 0)
    assert_equal [-300.0, 140.0, 0.0], point_mm(transform, 0, 0, 0),
                 'back-left corner is width+depth away from the grabbed corner'
    assert_equal [500.0, 700.0, 2100.0], point_mm(transform, EXTENTS[:x], EXTENTS[:y], EXTENTS[:z])
  end

  # One quarter turn about +Z through the anchor: the local frame rotates,
  # the anchor stays under the cursor, and the transform stays rigid
  # (right-handed — never a mirror).
  def test_quarter_rotation_about_anchor_keeps_anchor_and_stays_rigid
    placement_tool, = tool([[1000.0, 2000.0, 0.0]])
    move_cursor(placement_tool)
    placement_tool.onKeyDown(39, false, 0, @view) # right arrow (+90° about Z)

    transform = placement_tool.current_transform
    assert_equal [1000.0, 2000.0, 0.0], point_mm(transform, 0, 0, 0),
                 'the anchor remains exactly at the cursor'
    # local +X (width) now points along world +Y; local +Y (depth) along -X.
    assert_equal [1000.0, 2800.0, 0.0], point_mm(transform, EXTENTS[:x], 0, 0)
    assert_equal [440.0, 2000.0, 0.0], point_mm(transform, 0, EXTENTS[:y], 0)
    # Height axis untouched.
    assert_equal [1000.0, 2000.0, 2100.0], point_mm(transform, 0, 0, EXTENTS[:z])

    # Rigid: the three transformed basis vectors stay orthonormal.
    xaxis = transform.xaxis
    yaxis = transform.yaxis
    zaxis = transform.zaxis
    assert_in_epsilon 1.0, Math.sqrt((xaxis.x**2) + (xaxis.y**2) + (xaxis.z**2))
    assert_in_epsilon 0.0, (xaxis.x * yaxis.x) + (xaxis.y * yaxis.y) + (xaxis.z * yaxis.z)
    assert_in_epsilon 1.0, zaxis.z, 1e-9, 'Z stays vertical under a Z rotation'
  end

  def test_tab_cycles_anchor_without_identity_or_model_calls
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.onKeyDown(9, false, 0, @view) # Tab

    assert_equal :back_right_bottom, placement_tool.anchor
    assert placement_tool.active?
    assert_empty @model.selected_tools
    assert_empty @commits
    assert_empty @cancels
  end

  def test_click_commits_once_double_click_is_ignored
    placement_tool, = tool([[1000.0, 2000.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.onLButtonDown(0, 10, 10, @view)
    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length, 'one gesture, one commit'
    assert placement_tool.committed?
    assert_equal [nil], @model.selected_tools, 'commit returns to the selection tool'
    # The committed transform is exactly the previewed anchor transform.
    assert_equal [1000.0, 2000.0, 0.0], point_mm(@commits.first, 0, 0, 0)
  end

  def test_escape_cancels_once_with_zero_residue_and_ignores_late_events
    placement_tool, = tool([[1000.0, 2000.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.onKeyDown(27, false, 0, @view) # Esc
    placement_tool.onKeyDown(27, false, 0, @view) # late duplicate Esc
    placement_tool.onLButtonDown(0, 10, 10, @view) # late click
    placement_tool.onMouseMove(0, 10, 10, @view) # late movement

    assert_equal [:escape], @cancels
    assert_empty @commits, 'cancel leaves no placement'
    assert placement_tool.cancelled?
    assert_equal [nil], @model.selected_tools
    placement_tool.draw(@view)
    assert_empty @view.draw_calls, 'a cancelled preview draws nothing more'
  end

  def test_sketchup_on_cancel_also_routes_to_single_cancel
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.onCancel(:decide, @view)

    assert_equal [:escape], @cancels
    assert placement_tool.cancelled?
  end

  def test_deactivate_without_commit_cancels_tool_switch_or_model_close
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.deactivate(@view)

    assert_equal [:tool_switched], @cancels
    assert_empty @commits
    # Late draw after deactivation: nothing transient remains.
    placement_tool.draw(@view)
    assert_empty @view.draw_calls
  end

  def test_deactivate_after_commit_does_not_cancel
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)
    placement_tool.onLButtonDown(0, 10, 10, @view)

    placement_tool.deactivate(@view)

    assert_empty @cancels, 'a committed gesture must not be reinterpreted as cancel'
    assert_equal 1, @commits.length
  end

  def test_click_before_any_cursor_position_is_ignored
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    placement_tool.activate

    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_empty @commits
    assert placement_tool.active?
  end

  def test_extents_from_layout_prefers_authoritative_dimensions_mm
    layout = Object.new.tap do |fake|
      fake.define_singleton_method(:dimensions_mm) { [600, 720, 560] }
    end
    extents = Tool.extents_from_layout(layout)
    expected = { x: 600.0, y: 560.0, z: 720.0 }
    assert_equal expected, extents,
                 'dimensionsMm is [width, height, depth]; local Y is depth, Z is height'
  end

  def test_extents_from_layout_falls_back_to_resolved_boards_aabb
    boards = [board_at(translation: [0.0, 0.0, 0.0], size: [600.0, 18.0, 720.0]),
              board_at(translation: [582.0, 0.0, 0.0], size: [18.0, 560.0, 720.0])]
    layout = Object.new
    layout.define_singleton_method(:dimensions_mm) { nil }
    layout.define_singleton_method(:boards) { boards }
    extents = Tool.extents_from_layout(layout)
    assert_equal 600.0, extents[:x]
    assert_equal 560.0, extents[:y]
    assert_equal 720.0, extents[:z]
  end

  def test_extents_from_layout_rejects_unresolvable_input
    layout = Object.new.tap do |fake|
      fake.define_singleton_method(:dimensions_mm) { nil }
      fake.define_singleton_method(:boards) { [] }
    end
    assert_nil Tool.extents_from_layout(layout)
  end

  def test_constructor_rejects_invalid_extents_and_anchor
    assert_raises(ArgumentError) do
      Tool.new(label: 'X', extents_mm: { x: 0.0, y: 560.0, z: 720.0 },
               on_commit: ->(_) {}, on_cancel: ->(_) {})
    end
    assert_raises(ArgumentError) do
      Tool.new(label: 'X', extents_mm: EXTENTS, anchor: :center,
               on_commit: ->(_) {}, on_cancel: ->(_) {})
    end
  end

  private

  # Identity-basis board at a translated position (#414 shape).
  def board_at(translation:, size:)
    board = Object.new
    board.define_singleton_method(:translation) { translation }
    board.define_singleton_method(:basis) do
      { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
    end
    board.define_singleton_method(:width_mm) { size[0] }
    board.define_singleton_method(:thickness_mm) { size[1] }
    board.define_singleton_method(:length_mm) { size[2] }
    board
  end
end
