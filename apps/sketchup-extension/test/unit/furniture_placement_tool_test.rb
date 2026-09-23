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
  # Scriptable InputPoint: each #pick advances to the next scripted
  # position (mm); a nil entry models an INVALID pick (no inference).
  # picked_coords records the screen coordinates of every pick so tests
  # can prove the click re-picked at its own coordinates.
  class ScriptedInputPoint
    attr_reader :pick_count, :position, :picked_coords

    def initialize(positions_mm)
      @positions = positions_mm
      @index = -1
      @pick_count = 0
      @valid = false
      @picked_coords = []
    end

    def pick(_view, x_pos, y_pos, _other = nil)
      @picked_coords << [x_pos, y_pos]
      @index += 1
      @pick_count += 1
      current = @index < @positions.length ? @positions[@index] : @positions.last
      if current.nil?
        @valid = false
        return
      end

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
    attr_reader :draw_calls, :invalidations, :texts, :text_points, :screen_projections

    def initialize
      @draw_calls = []
      @invalidations = 0
      @texts = []
      @text_points = []
      @screen_projections = []
      @color = nil
    end

    # Host-faithful screen projection for draw_text: pixel x/y derived
    # deterministically from the 3D point so tests can assert the exact
    # label position.
    def screen_coords(point)
      projected = Geom::Point3d.new((point.x * 100).round(3), (point.y * 100).round(3), 0)
      @screen_projections << point
      projected
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

    def draw_text(point, text, _options = {})
      @text_points << point
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

  # No prior mouse move: the click still verifies its OWN inference — a
  # valid pick at the click coordinates commits with that position; an
  # invalid one commits nothing.
  def test_click_without_prior_move_commits_only_on_its_own_valid_pick
    placement_tool, = tool([[400.0, 300.0, 0.0]])
    placement_tool.activate
    assert_nil placement_tool.current_transform, 'no cursor position before any pick'

    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    assert_equal [400.0, 300.0, 0.0], point_mm(@commits.first, 0, 0, 0),
                 'the commit uses the click-verified position, not a stale one'

    invalid_tool, = tool([[0.0, 0.0, 0.0], nil])
    invalid_tool.activate
    move_cursor(invalid_tool)
    invalid_tool.onLButtonDown(0, 10, 10, @view) # re-pick invalid
    assert_empty @commits[1..], 'an invalid click pick commits nothing'
  end

  # An invalid pick INVALIDATES the previous position: the preview stops
  # drawing and a click cannot commit against the stale point.
  def test_invalid_pick_invalidates_stale_position
    placement_tool, = tool([[1000.0, 2000.0, 0.0], nil, nil, [500.0, 500.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)
    assert placement_tool.current_transform

    placement_tool.onMouseMove(0, 20, 20, @view) # invalid inference
    assert_nil placement_tool.current_transform, 'the stale position must be invalidated'
    placement_tool.draw(@view)
    assert_empty @view.draw_calls

    placement_tool.onLButtonDown(0, 20, 20, @view) # click re-pick still invalid
    assert_empty @commits, 'a click without a fresh valid position commits nothing'
    assert placement_tool.active?

    move_cursor(placement_tool) # recovers on the next valid pick
    placement_tool.onLButtonDown(0, 30, 30, @view)
    assert_equal 1, @commits.length
  end

  # The click verifies the position AT THE CLICK: it re-picks at its own
  # coordinates instead of trusting the last mouse-move inference.
  def test_click_repicks_and_uses_click_position_not_last_move
    placement_tool, input_point = tool([[1000.0, 2000.0, 0.0], [300.0, 400.0, 50.0]])
    move_cursor(placement_tool) # first position from the move

    placement_tool.onLButtonDown(0, 77, 88, @view) # re-pick yields position 2

    assert_equal [[10, 10], [77, 88]], input_point.picked_coords,
                 'the click must re-pick at its own coordinates'
    assert_equal 1, @commits.length
    # The committed transform anchors at the CLICK's inference, not the move's.
    assert_equal [300.0, 400.0, 50.0], point_mm(@commits.first, 0, 0, 0)
  end

  # draw_text takes SCREEN coordinates: the label sits exactly at the
  # projected anchor position (minus a small pixel lift), not at raw 3D.
  def test_anchor_label_draws_at_projected_screen_point
    placement_tool, = tool([[1000.0, 2000.0, 30.0]])
    move_cursor(placement_tool)
    placement_tool.draw(@view)

    assert_equal 1, @view.text_points.length
    anchor_world = Geom::Point3d.new(1000.0 / MM, 2000.0 / MM, 30.0 / MM)
    expected = @view.screen_coords(anchor_world)
    actual = @view.text_points.first
    assert_in_epsilon expected.x, actual.x, 1e-9
    assert_in_epsilon expected.y - 14, actual.y, 1e-9, 'label lifted a few pixels above the anchor'
    assert_equal 0.0, actual.z
  end

  # Controller-facing cancellation (dialog close) shares Esc semantics:
  # single-shot, zero residue, no model calls beyond tool restoration.
  def test_cancel_preview_public_entry_cancels_once
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.cancel_preview(:dialog_closed)
    placement_tool.cancel_preview(:escape)

    assert_equal [:dialog_closed], @cancels
    assert placement_tool.cancelled?
    assert_empty @commits
  end

  # A resolved layout whose boards sit AWAY from the local origin keeps
  # its minimum: the anchor maps the real box, not an origin-shifted one.
  def test_extents_fallback_keeps_the_local_minimum
    boards = [board_at(translation: [100.0, 50.0, 20.0], size: [500.0, 400.0, 700.0])]
    layout = Object.new
    layout.define_singleton_method(:dimensions_mm) { nil }
    layout.define_singleton_method(:boards) { boards }

    extents = Tool.extents_from_layout(layout)

    assert_equal 500.0, extents[:x]
    assert_equal 400.0, extents[:y]
    assert_equal 700.0, extents[:z]
    assert_equal [100.0, 50.0, 20.0], extents[:origin_mm]
  end

  # Shifted box: the anchor corner is the MIN corner of the real box, and
  # the committed transform maps exactly that corner to the cursor.
  def test_anchor_maps_local_minimum_of_shifted_layout
    placement_tool = Tool.new(
      label: 'Desplazado', extents_mm: { x: 500.0, y: 400.0, z: 700.0 },
      origin_mm: [100.0, 50.0, 20.0],
      on_commit: ->(transform) { @commits << transform },
      on_cancel: ->(reason) { @cancels << reason },
      input_point_factory: -> { ScriptedInputPoint.new([[2000.0, 1500.0, 100.0]]) },
      model_provider: -> { @model }
    )
    move_cursor(placement_tool)

    transform = placement_tool.current_transform
    # BACK_LEFT_BOTTOM anchor = local (100, 50, 20) sits at the cursor…
    assert_equal [2000.0, 1500.0, 100.0], point_mm(transform, 100, 50, 20)
    # …and the far corner (min + extents) lands where the box really ends.
    assert_equal [2500.0, 1900.0, 800.0], point_mm(transform, 600, 450, 720)
  end

  # Deactivation by tool switch must NOT restore the selection tool: the
  # host already moved to the tool the user chose next.
  def test_deactivate_does_not_clobber_the_user_next_tool
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    user_tool = Object.new
    @model.select_tool(user_tool)
    placement_tool.deactivate(@view)

    assert_equal [:tool_switched], @cancels
    assert_equal [user_tool], @model.selected_tools,
                 'no select_tool(nil) after a tool switch — the user choice stays'
  end

  # Explicit ends (Esc / controller cancel) DO restore the selection tool.
  def test_explicit_cancel_restores_the_selection_tool
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    move_cursor(placement_tool)

    placement_tool.onKeyDown(27, false, 0, @view)

    assert_equal [nil], @model.selected_tools
  end

  # Double activation (host select_tool + explicit controller activate)
  # must not double the side effects.
  def test_activate_is_idempotent
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    view = Sketchup.active_model.active_view
    before = view.invalidations

    placement_tool.activate
    placement_tool.activate

    assert_equal before + 1, view.invalidations, 'exactly one activation effect'
  end

  def test_extents_from_layout_prefers_authoritative_dimensions_mm
    layout = Object.new.tap do |fake|
      fake.define_singleton_method(:dimensions_mm) { [600, 720, 560] }
    end
    extents = Tool.extents_from_layout(layout)
    expected = { x: 600.0, y: 560.0, z: 720.0, origin_mm: [0.0, 0.0, 0.0] }
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
    assert_equal [0.0, 0.0, 0.0], extents[:origin_mm],
                 'boards touching the local origin keep a zero minimum'
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
