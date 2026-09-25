# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/tools/placement_snap_engine'
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
  # can prove the click re-picked at its own coordinates. `faces` scripts
  # the host InputPoint#face surface (one entry per pick; nil = no face),
  # modelling wall/floor inference for the semantic snap (#469 incr. 2).
  class ScriptedInputPoint
    attr_reader :pick_count, :position, :picked_coords
    attr_accessor :faces

    def initialize(positions_mm, faces = nil)
      @positions = positions_mm
      @faces = faces
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

    # Host-faithful: InputPoint#face exposes the picked face, nil in space.
    def face
      return nil unless @faces

      @faces[@index] || @faces.last
    end
  end

  # Host-shaped face for scripted inference: a world normal only.
  class ScriptedFace
    attr_reader :normal

    def initialize(normal_mm)
      @normal = Geom::Vector3d.new(normal_mm[0], normal_mm[1], normal_mm[2])
    end
  end

  # Records viewport drawing. Any model access would have to happen through
  # the injected model — see StrictModel. The optional camera models the
  # host View#camera (eye in INCHES) — the deterministic room-side
  # reference for wall snapping.
  class ScriptedCamera
    attr_accessor :eye

    def initialize(eye_mm)
      @eye = Geom::Point3d.new(eye_mm[0] / MM, eye_mm[1] / MM, eye_mm[2] / MM)
    end
  end

  class RecordingView
    attr_reader :draw_calls, :invalidations, :texts, :text_points, :screen_projections
    attr_accessor :camera

    def initialize
      @draw_calls = []
      @invalidations = 0
      @texts = []
      @text_points = []
      @screen_projections = []
      @color = nil
      @camera = nil
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
    @view.camera = ScriptedCamera.new([3000.0, 2000.0, 1500.0])
    @commits = []
    @cancels = []
  end

  def tool(positions_mm, anchor: :back_left_bottom, faces: nil, managed_targets: nil, base_planes: nil)
    input_point = ScriptedInputPoint.new(positions_mm, faces)
    placement_tool = Tool.new(
      label: 'Torre horno', extents_mm: EXTENTS, anchor: anchor,
      on_commit: ->(transform) { @commits << transform },
      on_cancel: ->(reason) { @cancels << reason },
      input_point_factory: -> { input_point },
      model_provider: -> { @model },
      furniture_targets_provider: managed_targets,
      base_planes_provider: base_planes
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
    assert_in_delta 0.0, (xaxis.x * yaxis.x) + (xaxis.y * yaxis.y) + (xaxis.z * yaxis.z)
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
  # must not double the side effects. Owns its model: the global active
  # model is order-dependent across the suite.
  def test_activate_is_idempotent
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    previous_model = SketchupStub.active_model
    SketchupStub.active_model = SketchupStub::ModelStub.new
    view = SketchupStub.active_model.active_view
    before = view.invalidations

    placement_tool.activate
    placement_tool.activate

    assert_equal before + 1, view.invalidations, 'exactly one activation effect'
  ensure
    SketchupStub.active_model = previous_model
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

  # ---- #469 increment 2: semantic snaps ---------------------------------

  # Wall at x=0 facing +X: hovering near it, the preview transform puts
  # the BACK face exactly on the plane, front facing +X, and the snap
  # state is visible to the drawing layer. The cursor loop still touches
  # nothing but the InputPoint (StrictModel guards every model call).
  def test_wall_snap_moves_preview_back_face_onto_the_plane
    placement_tool, = tool([[0.0, 2000.0, 30.0]],
                           faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(placement_tool)

    assert placement_tool.active_snap, 'a wall candidate must be active'
    transform = placement_tool.current_transform
    # Back face = local y in [0..0]; the four back corners sit at x=0.
    [[0, 0, 0], [EXTENTS[:x], 0, 0], [0, 0, EXTENTS[:z]], [EXTENTS[:x], 0, EXTENTS[:z]]].each do |corner|
      placed = point_mm(transform, *corner)
      assert_in_delta 0.0, placed[0], 1e-6, 'every back corner lies on the wall plane'
    end
    # Front face one depth away, facing +X.
    assert_in_epsilon EXTENTS[:y], point_mm(transform, 0, EXTENTS[:y], 0)[0], 1e-6
    assert_in_epsilon 1.0, placement_tool.active_snap[:front_dir_mm][0], 1e-9, 'front maps to +X'
    assert_empty @model.selected_tools, 'the snap loop must not touch the model'
  end

  # #469 increment 3 — a wall at 30°: the back face lands exactly on the
  # rotated plane (through the picked point, normal from the face), the
  # front faces the EYE side, and the committed basis keeps the real
  # angle — never a rounded world axis.
  def test_wall_snap_at_30_degrees_places_back_on_the_rotated_plane
    normal = [0.5, Math.sqrt(3.0) / 2.0, 0.0]
    cursor = [500.0, 500.0, 0.0]
    placement_tool, = tool([cursor], faces: [ScriptedFace.new(normal)])
    move_cursor(placement_tool)

    assert placement_tool.active_snap, 'a 30° wall must offer a candidate'
    assert_equal :face, placement_tool.active_snap[:primary][:kind]
    assert_in_epsilon normal[0], placement_tool.active_snap[:front_dir_mm][0], 1e-9
    assert_in_epsilon normal[1], placement_tool.active_snap[:front_dir_mm][1], 1e-9

    transform = placement_tool.current_transform
    [[0, 0, 0], [EXTENTS[:x], 0, 0], [0, 0, EXTENTS[:z]], [EXTENTS[:x], 0, EXTENTS[:z]]].each do |corner|
      placed = point_mm(transform, *corner)
      signed = ((placed[0] - cursor[0]) * normal[0]) + ((placed[1] - cursor[1]) * normal[1])
      assert_in_delta 0.0, signed, 1e-6, 'every back corner lies on the 30° plane'
    end
    front_corner = point_mm(transform, 0, EXTENTS[:y], 0)
    signed_front = ((front_corner[0] - cursor[0]) * normal[0]) + ((front_corner[1] - cursor[1]) * normal[1])
    assert_in_epsilon EXTENTS[:y], signed_front, 1e-6, 'the front points into the room along the normal'
  end

  # The SAME reversed 30° wall (normal flipped) produces the identical
  # physical placement — the room side comes from the camera eye, never
  # from Face#normal, at any angle.
  def test_reversed_wall_at_30_degrees_places_identically
    normal = [0.5, Math.sqrt(3.0) / 2.0, 0.0]
    cursor = [500.0, 500.0, 0.0]
    unreversed, = tool([cursor], faces: [ScriptedFace.new(normal)])
    move_cursor(unreversed)
    reversed_tool, = tool([cursor], faces: [ScriptedFace.new([-normal[0], -normal[1], 0.0])])
    move_cursor(reversed_tool)

    assert unreversed.active_snap && reversed_tool.active_snap
    assert_equal unreversed.active_snap[:anchor_mm].map { |v| v.round(9) },
                 reversed_tool.active_snap[:anchor_mm].map { |v| v.round(9) },
                 'identical physical placement for the reversed wall'
    assert_equal(unreversed.active_snap[:front_dir_mm].map { |v| v.round(9) },
                 reversed_tool.active_snap[:front_dir_mm].map { |v| v.round(9) })
    assert_equal rounded_cells(unreversed.current_transform), rounded_cells(reversed_tool.current_transform),
                 'the accepted transforms are identical'
  end

  # NEGATIVE (increment 3 §5): the accepted transform at an arbitrary yaw
  # is a RIGID basis — unit orthogonal axes, determinant +1, +Z vertical.
  def test_arbitrary_yaw_transform_is_orthonormal_right_handed_and_vertical
    normal = [Math.sqrt(3.0) / 2.0, 0.5, 0.0]
    placement_tool, = tool([[500.0, 500.0, 0.0]], faces: [ScriptedFace.new(normal)])
    move_cursor(placement_tool)

    assert placement_tool.active_snap
    transform = placement_tool.current_transform
    x = v3(transform.xaxis)
    y = v3(transform.yaxis)
    z = v3(transform.zaxis)
    assert_in_epsilon 1.0, length3(x), 1e-9, '|X| = 1'
    assert_in_epsilon 1.0, length3(y), 1e-9, '|Y| = 1'
    assert_in_epsilon 1.0, length3(z), 1e-9, '|Z| = 1'
    assert_in_delta 0.0, dot3(x, y), 1e-9, 'X ⟂ Y'
    assert_in_delta 0.0, dot3(y, z), 1e-9, 'Y ⟂ Z'
    assert_in_delta 0.0, dot3(x, z), 1e-9, 'X ⟂ Z'
    assert_in_epsilon 1.0, det3(x, y, z), 1e-9, 'determinant = +1 (no mirror, no scale)'
    assert_in_epsilon 1.0, z[2], 1e-9, '+Z stays vertical'
    # The front basis keeps the exact angle — no axis rounding.
    assert_in_epsilon normal[0], y[0], 1e-9
    assert_in_epsilon normal[1], y[1], 1e-9
  end

  # Furniture side-to-side: a Granete-managed neighbor (descriptor by
  # furnitureInstanceId) receives the new left side at gap 0.
  def test_furniture_side_snap_from_managed_provider
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, = tool([[700.0, 300.0, 0.0]], managed_targets: -> { targets })
    move_cursor(placement_tool)
    placement_tool.draw(@view)

    side = placement_tool.active_snap[:components].find { |c| c[:kind] == :furniture_side }
    assert side, 'the managed neighbor must be a snap target'
    assert_equal 'fi-B03', side[:furniture_instance_id]
    transform = placement_tool.current_transform
    assert_in_epsilon 600.0, point_mm(transform, 0, 0, 0)[0], 1e-6,
                      'the new left side sits exactly on x=600 at gap 0'
    assert(@view.texts.any? { |text| text.include?('Encajar a B03 · lateral derecho · 0 mm') },
           'the snap label names the target side and the live gap')
  end

  # VCB gap: with an active side snap, "5" + Enter separates the sides by
  # exactly 5 mm — preview and commit. The box never resizes: the far
  # corner stays one width away along the run axis.
  def test_vcb_gap_applies_exact_mm_to_the_active_snap
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, = tool([[700.0, 300.0, 0.0], [700.0, 300.0, 0.0]],
                           managed_targets: -> { targets })
    move_cursor(placement_tool)

    assert_equal true, placement_tool.onUserText('5', @view)

    transform = placement_tool.current_transform
    assert_in_epsilon 605.0, point_mm(transform, 0, 0, 0)[0], 1e-6, 'gap 5 mm'
    assert_in_epsilon 605.0 + EXTENTS[:x], point_mm(transform, EXTENTS[:x], 0, 0)[0], 1e-6,
                      'the box slides whole — width unchanged'
    placement_tool.onLButtonDown(0, 10, 10, @view)
    assert_equal 1, @commits.length
    assert_in_epsilon 605.0, point_mm(@commits.first, 0, 0, 0)[0], 1e-6,
                      'the committed transform carries the exact gap'
  end

  # The gap belongs to its target: when the fresh pick at the click
  # resolves a DIFFERENT primary (or none), the stored offset does not
  # leak into an unrelated constraint.
  def test_gap_does_not_leak_to_a_different_or_absent_target
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, = tool([[700.0, 300.0, 0.0], [5000.0, 5000.0, 0.0]],
                           managed_targets: -> { targets })
    move_cursor(placement_tool)
    placement_tool.onUserText('5', @view)

    placement_tool.onLButtonDown(0, 10, 10, @view) # fresh pick far away: no snap

    assert_equal 1, @commits.length
    assert_nil placement_tool.active_snap
    assert_equal [5000.0, 5000.0, 0.0], point_mm(@commits.first, 0, 0, 0),
                 'free placement at the fresh inference, gap not applied'
  end

  # Stale-candidate rule: a target that disappears between move and click
  # can never be committed against — the click re-solves from fresh data.
  def test_erased_target_between_move_and_click_never_commits_the_snap
    live = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    provider = -> { live }
    placement_tool, = tool([[700.0, 300.0, 0.0], [700.0, 300.0, 0.0]], managed_targets: provider)
    move_cursor(placement_tool)
    assert placement_tool.active_snap

    live.clear # the managed root is erased before the click

    placement_tool.onLButtonDown(0, 10, 10, @view)
    assert_equal 1, @commits.length
    assert_nil placement_tool.active_snap, 'no stale solution may survive the fresh pick'
    assert_equal [700.0, 300.0, 0.0], point_mm(@commits.first, 0, 0, 0),
                 'the commit falls back to the fresh free inference'
  end

  # Invalid inference clears the snap together with the position.
  def test_invalid_pick_clears_the_active_snap
    placement_tool, = tool([[0.0, 2000.0, 30.0], nil],
                           faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(placement_tool)
    assert placement_tool.active_snap

    placement_tool.onMouseMove(0, 20, 20, @view) # invalid pick

    assert_nil placement_tool.active_snap
    assert_nil placement_tool.current_transform
  end

  # Rotation while an orientation snap is active is answered with a hint,
  # not a silent fight with the target; free mode keeps ←/→ working.
  def test_rotation_blocked_under_orientation_snap_but_free_mode_rotates
    blocked, = tool([[0.0, 2000.0, 30.0]], faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(blocked)
    blocked.onKeyDown(39, false, 0, @view)

    assert_in_epsilon 1.0, blocked.active_snap[:front_dir_mm][0], 1e-9, 'the snap keeps fixing the front'
    assert_equal 0, blocked.rotation_quarters, 'the user quarter was not consumed'

    free, = tool([[1000.0, 2000.0, 0.0]])
    move_cursor(free)
    free.onKeyDown(39, false, 0, @view)
    assert_equal 1, free.rotation_quarters
    assert_nil free.active_snap
  end

  # Without an active snap the VCB has no reference: honest hint, zero
  # state change, and invalid text never invents a distance.
  def test_vcb_without_snap_or_with_invalid_text_is_answered_not_guessed
    placement_tool, = tool([[1000.0, 2000.0, 0.0]])
    move_cursor(placement_tool)

    assert_equal true, placement_tool.onUserText('5', @view), 'handled with a hint'
    assert_equal true, placement_tool.onUserText('cinco', @view)

    walled, = tool([[0.0, 2000.0, 30.0]], faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(walled)
    assert_equal true, walled.onUserText('cinco', @view), 'invalid text is answered, not guessed'
    transform = walled.current_transform
    assert_in_delta 0.0, point_mm(transform, 0, 0, 0)[0], 1e-6, 'gap stays 0'
  end

  # Cancel with a live snap: zero residue, nothing drawn afterwards —
  # identical to increment 1 semantics.
  def test_cancel_with_active_snap_leaves_zero_residue
    placement_tool, = tool([[0.0, 2000.0, 30.0]], faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(placement_tool)
    placement_tool.onUserText('25', @view)
    assert placement_tool.active_snap

    placement_tool.onKeyDown(27, false, 0, @view) # Esc

    assert_equal [:escape], @cancels
    assert_empty @commits
    assert placement_tool.cancelled?
    assert_empty @model.selected_tools.slice(1..) # only the restore call
    placement_tool.draw(@view)
    assert_empty @view.draw_calls, 'a cancelled snap preview draws nothing more'
  end

  # NEGATIVE: a snapped commit stays rigid and never resizes the box —
  # every axis length of the placed box equals the preview extents, so no
  # manufacturing dimension can be derived from wall/neighbor geometry.
  def test_snapped_transform_is_rigid_and_never_resizes_the_box
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, = tool([[700.0, 300.0, 0.0]], managed_targets: -> { targets })
    move_cursor(placement_tool)
    placement_tool.onUserText('40', @view)

    transform = placement_tool.current_transform
    origin = point_mm(transform, 0, 0, 0)
    width_end = point_mm(transform, EXTENTS[:x], 0, 0)
    depth_end = point_mm(transform, 0, EXTENTS[:y], 0)
    height_end = point_mm(transform, 0, 0, EXTENTS[:z])
    assert_in_epsilon EXTENTS[:x], distance(origin, width_end), 1e-6, 'width intact'
    assert_in_epsilon EXTENTS[:y], distance(origin, depth_end), 1e-6, 'depth intact'
    assert_in_epsilon EXTENTS[:z], distance(origin, height_end), 1e-6, 'height intact'
  end

  # Cursor movement with snap discovery still issues NO callbacks and no
  # model access: discovery is pure data over the injected providers.
  def test_snap_discovery_during_moves_never_calls_back_or_touches_the_model
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, input_point = tool([[700.0, 300.0, 0.0], [710.0, 310.0, 0.0], [720.0, 320.0, 0.0]],
                                       faces: [ScriptedFace.new([1.0, 0.0, 0.0]), nil, nil],
                                       managed_targets: -> { targets })
    move_cursor(placement_tool, times: 3)

    assert_equal 3, input_point.pick_count, 'still exactly one pick per move'
    assert placement_tool.active_snap
    assert_empty @commits
    assert_empty @cancels
    assert_empty @model.selected_tools
  end

  # A REVERSED floor face (−Z normal) is the same base plane as an
  # unreversed one: the tool's discovery passes the winding through and
  # the floor snap activates identically (no Face#normal sign authority).
  def test_reversed_floor_face_activates_the_base_plane_snap
    unreversed, = tool([[1000.0, 1000.0, 1000.0]], faces: [ScriptedFace.new([0.0, 0.0, 1.0])])
    move_cursor(unreversed)
    reversed_tool, = tool([[1000.0, 1000.0, 1000.0]], faces: [ScriptedFace.new([0.0, 0.0, -1.0])])
    move_cursor(reversed_tool)

    assert_equal 'Piso', unreversed.active_snap[:label]
    assert_equal 'Piso', reversed_tool.active_snap[:label],
                 'the reversed floor offers the SAME base-plane snap'
    assert_equal [1000.0, 1000.0, 1000.0], reversed_tool.active_snap[:anchor_mm]
    refute reversed_tool.active_snap[:constrains_rotation]
  end

  # A REVERSED wall face (normal pointing −X, away from the room) must
  # produce the SAME placement as the unreversed face: the front is
  # resolved from the camera side, never from Face#normal — the furniture
  # can never end up facing the wall.
  def test_reversed_wall_face_yields_the_same_orientation_as_unreversed
    unreversed, = tool([[0.0, 2000.0, 30.0]], faces: [ScriptedFace.new([1.0, 0.0, 0.0])])
    move_cursor(unreversed)
    reversed_tool, = tool([[0.0, 2000.0, 30.0]], faces: [ScriptedFace.new([-1.0, 0.0, 0.0])])
    move_cursor(reversed_tool)

    assert_in_epsilon 1.0, unreversed.active_snap[:front_dir_mm][0], 1e-9
    assert_in_epsilon 1.0, reversed_tool.active_snap[:front_dir_mm][0], 1e-9,
                      'the reversed face must orient identically — front away from the wall'
    transform = reversed_tool.current_transform
    [[0, 0, 0], [EXTENTS[:x], 0, 0]].each do |corner|
      assert_in_delta 0.0, point_mm(transform, *corner)[0], 1e-6, 'back face on the wall'
    end
    assert_in_epsilon EXTENTS[:y], point_mm(transform, 0, EXTENTS[:y], 0)[0], 1e-6,
                      'front one depth into the room (+X)'
  end

  # Performance guard (#469 review): the managed-neighbor provider (a full
  # local model scan) runs exactly ONCE per cursor loop regardless of how
  # many mouse moves fire, plus exactly ONE commit-time revalidation —
  # never one full model index per mouse event.
  def test_cursor_loop_indexes_the_model_once_and_click_revalidates_once
    calls = 0
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    provider = lambda do
      calls += 1
      targets
    end
    placement_tool, = tool([[700.0, 300.0, 0.0]] * 5, managed_targets: provider)

    move_cursor(placement_tool, times: 5)

    assert_equal 1, calls, 'five mouse moves must index the model exactly once (gesture snapshot)'
    assert placement_tool.active_snap

    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 2, calls, 'the click revalidates the chosen targets exactly once'
    assert_equal 1, @commits.length
  end

  # The commit-time revalidation uses CURRENT data: a target mutated after
  # the gesture snapshot (moved neighbor) commits against the fresh plane,
  # never the stale one.
  def test_click_commits_against_fresh_target_geometry_not_the_snapshot
    targets = [managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [600.0, 560.0, 720.0], [0.0, 1.0, 0.0])]
    placement_tool, = tool([[700.0, 300.0, 0.0], [700.0, 300.0, 0.0]],
                           managed_targets: -> { targets })
    move_cursor(placement_tool)
    assert_in_epsilon 600.0, point_mm(placement_tool.current_transform, 0, 0, 0)[0], 1e-6

    targets.replace([managed_target('fi-B03', 'B03', [0.0, 0.0, 0.0], [650.0, 560.0, 720.0],
                                    [0.0, 1.0, 0.0])])
    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    assert_in_epsilon 650.0, point_mm(@commits.first, 0, 0, 0)[0], 1e-6,
                      'the committed side plane is the CURRENT neighbor geometry'
  end

  # #469 increment 3 — neighbor rotated to yaw 30° around Z: side-to-side
  # keeps the fronts PARALLEL, the 5mm VCB gap separates the sides exactly
  # along the ORIENTED normal, and the box never resizes or coerces to the
  # quarter grid.
  def test_rotated_neighbor_side_snap_keeps_parallel_fronts_and_exact_5mm_gap
    yaw = 30.0
    radians = yaw * Math::PI / 180.0
    front = [Math.sin(radians), Math.cos(radians), 0.0]
    right = [front[1], -front[0], 0.0]
    size = [600.0, 560.0, 720.0]
    targets = [rotated_target('fi-R30', 'R30', yaw, size, [0.0, 0.0, 0.0])]
    # Cursor 40mm off the oriented right side, mid-run — expressed IN the
    # target frame (a world offset changes the distance at every yaw).
    cursor = [(right[0] * 640.0) + (front[0] * 280.0),
              (right[1] * 640.0) + (front[1] * 280.0), 0.0]
    placement_tool, = tool([cursor, cursor], managed_targets: -> { targets })
    move_cursor(placement_tool)

    side = placement_tool.active_snap && placement_tool.active_snap[:components]
                                                       .find { |c| c[:kind] == :furniture_side }
    assert side, 'the rotated managed neighbor must offer a side candidate'
    assert_equal 'fi-R30', side[:furniture_instance_id]

    assert_equal true, placement_tool.onUserText('5', @view)
    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    transform = @commits.first
    y_axis = v3(transform.yaxis)
    assert_in_epsilon front[0], y_axis[0], 1e-6, 'fronts stay parallel at 30°'
    assert_in_epsilon front[1], y_axis[1], 1e-6
    # The new LEFT side (local x = 0 face) sits 5mm off the oriented side
    # plane x·right = 600, measured along the normal.
    [[0, 0, 0], [0, EXTENTS[:y], 0], [0, 0, EXTENTS[:z]]].each do |corner|
      placed = point_mm(transform, *corner)
      signed = (placed[0] * right[0]) + (placed[1] * right[1])
      assert_in_epsilon 605.0, signed, 1e-6, 'left side exactly 5mm off the oriented plane'
    end
    # Rigid: the width still spans 800mm along the run axis.
    width_end = point_mm(transform, EXTENTS[:x], 0, 0)
    origin = point_mm(transform, 0, 0, 0)
    assert_in_epsilon EXTENTS[:x], distance(origin, width_end), 1e-6, 'dimensions intact'
  end

  # Stale rotated target (increment 3 §13): the preview snaps against yaw
  # 30°, the target ROTATES to 35° before the click, and the commit uses
  # the FRESH frame — never the stale orientation.
  def test_click_uses_the_fresh_yaw_when_target_rotates_between_move_and_click
    live = [rotated_target('fi-R30', 'R30', 30.0, [600.0, 560.0, 720.0], [0.0, 0.0, 0.0])]
    radians = 30.0 * Math::PI / 180.0
    front = [Math.sin(radians), Math.cos(radians), 0.0]
    right = [front[1], -front[0], 0.0]
    cursor = [(right[0] * 640.0) + (front[0] * 280.0), (right[1] * 640.0) + (front[1] * 280.0), 0.0]
    placement_tool, = tool([cursor, cursor], managed_targets: -> { live })
    move_cursor(placement_tool)
    assert placement_tool.active_snap, 'the 30° preview snap is live'
    preview_front = placement_tool.active_snap[:front_dir_mm].dup

    live.replace([rotated_target('fi-R30', 'R30', 35.0, [600.0, 560.0, 720.0], [0.0, 0.0, 0.0])])
    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    y_axis = v3(@commits.first.yaxis)
    radians35 = 35.0 * Math::PI / 180.0
    assert_in_epsilon Math.sin(radians35), y_axis[0], 1e-6, 'the commit uses the FRESH 35° frame'
    assert_in_epsilon Math.cos(radians35), y_axis[1], 1e-6
    refute_in_epsilon preview_front[0], y_axis[0], 1e-4, 'the stale 30° orientation is gone'
  end

  # P1 (review): wall + floor must COMPOSE through the real tool — the
  # picked 30° wall constrains XY while the gesture-scoped base-plane
  # provider feeds the floor; preview AND commit carry both constraints.
  def test_wall_and_floor_compose_through_the_tool_at_30_degrees
    normal = [0.5, Math.sqrt(3.0) / 2.0, 0.0]
    aim = [-Math.sqrt(3.0) / 2.0 * 2000.0, 1000.0, 100.0] # on the wall, near the floor
    floor_planes = lambda do
      [{ 'point_mm' => [0.0, 0.0, 0.0], 'normal_mm' => [0.0, 0.0, 1.0],
         'footprint_min_mm' => [-10_000.0, -10_000.0, 0.0],
         'footprint_max_mm' => [10_000.0, 10_000.0, 0.0] }]
    end
    placement_tool, = tool([aim, aim], faces: [ScriptedFace.new(normal), ScriptedFace.new(normal)],
                                       base_planes: floor_planes)
    move_cursor(placement_tool)

    assert placement_tool.active_snap
    kinds = placement_tool.active_snap[:components].map { |component| component[:kind] }.sort
    assert_equal %i[face floor], kinds, 'the picked wall composes with the floor plane'
    assert_equal :face, placement_tool.active_snap[:primary][:kind], 'the wall stays primary'

    transform = placement_tool.current_transform
    [[0, 0, 0], [EXTENTS[:x], 0, 0]].each do |corner|
      placed = point_mm(transform, *corner)
      signed = ((placed[0] - aim[0]) * normal[0]) + ((placed[1] - aim[1]) * normal[1])
      assert_in_delta 0.0, signed, 1e-4, 'back face on the rotated wall plane'
    end
    assert_in_delta 0.0, point_mm(transform, 0, 0, 0)[2], 1e-4,
                    'base sits on the floor plane (composed constraint)'

    placement_tool.onLButtonDown(0, 10, 10, @view) # re-picks + revalidates both providers

    assert_equal 1, @commits.length
    committed_origin = point_mm(@commits.first, 0, 0, 0)
    signed_wall = ((committed_origin[0] - aim[0]) * normal[0]) + ((committed_origin[1] - aim[1]) * normal[1])
    assert_in_delta 0.0, signed_wall, 1e-4, 'committed back corner on the wall'
    assert_in_delta 0.0, committed_origin[2], 1e-4, 'committed base on the floor'
  end

  # The base-plane scan follows the same budget as managed targets: one
  # provider call per gesture regardless of mouse moves, plus exactly one
  # commit-time revalidation.
  def test_base_plane_provider_runs_once_per_gesture_and_once_at_click
    calls = 0
    floor_planes = lambda do
      calls += 1
      [{ 'point_mm' => [0.0, 0.0, 0.0], 'normal_mm' => [0.0, 0.0, 1.0],
         'footprint_min_mm' => [-10_000.0, -10_000.0, 0.0],
         'footprint_max_mm' => [10_000.0, 10_000.0, 0.0] }]
    end
    aim = [500.0, 500.0, 100.0]
    placement_tool, = tool([aim] * 4, faces: [ScriptedFace.new([0.5, Math.sqrt(3.0) / 2.0, 0.0]), nil, nil, nil],
                                      base_planes: floor_planes)

    move_cursor(placement_tool, times: 4)

    assert_equal 1, calls, 'four mouse moves scan the base planes exactly once'
    assert placement_tool.active_snap

    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 2, calls, 'the click revalidates the base planes exactly once'
    assert_equal 1, @commits.length
  end

  # A floor plane far below the cursor is NOT a candidate: a free pick
  # high above the ground keeps following the raw inference (#469
  # increment 1 rule preserved — no hijack toward z=0). The footprint
  # COVERS the cursor, so the rejection can only come from Z distance;
  # the mirrored case (close Z, distant XY footprint) is pinned at the
  # engine level — both dimensions of spatial relevance are required.
  def test_distant_floor_plane_never_hijacks_a_free_pick
    floor_planes = lambda do
      [{ 'point_mm' => [0.0, 0.0, 0.0], 'normal_mm' => [0.0, 0.0, 1.0],
         'footprint_min_mm' => [-10_000.0, -10_000.0, 0.0],
         'footprint_max_mm' => [10_000.0, 10_000.0, 0.0] }]
    end
    placement_tool, = tool([[1000.0, 2000.0, 1000.0], [1000.0, 2000.0, 1000.0]],
                           base_planes: floor_planes)
    move_cursor(placement_tool)

    assert_nil placement_tool.active_snap, '1000mm above the floor offers no candidate'

    placement_tool.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    assert_equal [1000.0, 2000.0, 1000.0], point_mm(@commits.first, 0, 0, 0),
                 'free placement at the raw inference'
  end

  # Review r2 D: the base-plane snapshot revalidates at the click — a
  # nested floor MOVED between preview and click commits against the
  # FRESH plane; a floor DELETED before the click falls safe (the wall
  # constraint survives, Z follows the fresh free inference).
  def test_click_revalidates_base_planes_against_fresh_nested_state
    normal = [0.5, Math.sqrt(3.0) / 2.0, 0.0]
    aim = [-Math.sqrt(3.0) / 2.0 * 2000.0, 1000.0, 100.0]
    live = [{ 'point_mm' => [0.0, 0.0, 0.0], 'normal_mm' => [0.0, 0.0, 1.0],
              'footprint_min_mm' => [-10_000.0, -10_000.0, 0.0],
              'footprint_max_mm' => [10_000.0, 10_000.0, 0.0] }]
    moved, = tool([aim, aim], faces: [ScriptedFace.new(normal), ScriptedFace.new(normal)],
                              base_planes: -> { live })
    move_cursor(moved)
    assert moved.active_snap
    assert_in_delta 0.0, point_mm(moved.current_transform, 0, 0, 0)[2], 1e-4

    live.replace([{ 'point_mm' => [0.0, 0.0, 120.0], 'normal_mm' => [0.0, 0.0, 1.0],
                    'footprint_min_mm' => [-10_000.0, -10_000.0, 120.0],
                    'footprint_max_mm' => [10_000.0, 10_000.0, 120.0] }])
    moved.onLButtonDown(0, 10, 10, @view)

    assert_equal 1, @commits.length
    assert_in_delta 120.0, point_mm(@commits.first, 0, 0, 0)[2], 1e-4,
                    'the committed base uses the CURRENT (moved) floor plane'

    erased, = tool([aim, aim], faces: [ScriptedFace.new(normal), ScriptedFace.new(normal)],
                               base_planes: -> { live })
    move_cursor(erased)
    live.clear # the nested floor is deleted before the click
    erased.onLButtonDown(0, 10, 10, @view)

    assert_equal 2, @commits.length
    committed = point_mm(@commits.last, 0, 0, 0)
    signed_wall = ((committed[0] - aim[0]) * normal[0]) + ((committed[1] - aim[1]) * normal[1])
    assert_in_delta 0.0, signed_wall, 1e-4, 'the wall constraint survives (fresh pick)'
    assert_in_delta aim[2], committed[2], 1e-4, 'Z falls back to the fresh free inference'
    assert_equal(%i[face], erased.active_snap[:components].map { |c| c[:kind] })
  end

  private

  # Axis-aligned world-box fixture (min at the frame origin, front on a
  # quarter direction) expressed as the ORIENTED frame descriptor the
  # increment 3 provider/engine contract uses.
  def managed_target(id, label, min_mm, max_mm, front_dir)
    front = [front_dir[0].to_f, front_dir[1].to_f, 0.0]
    length = Math.sqrt((front[0]**2) + (front[1]**2))
    front = [front[0] / length, front[1] / length, 0.0]
    right = [front[1], -front[0], 0.0]
    { 'furniture_instance_id' => id, 'label' => label,
      'origin_world_mm' => min_mm.map(&:to_f),
      'front_dir_mm' => front, 'right_dir_mm' => right,
      'local_min_mm' => [0.0, 0.0, 0.0],
      'local_max_mm' => [max_mm[0] - min_mm[0], max_mm[1] - min_mm[1], max_mm[2] - min_mm[2]] }
  end

  # ORIENTED frame descriptor for a neighbor rotated by yaw around Z at a
  # world position: unit front/right + LOCAL extents — the shape the real
  # provider derives from the rigid transform + local definition bounds,
  # never from the world AABB.
  def rotated_target(id, label, yaw_degrees, size, at)
    radians = yaw_degrees * Math::PI / 180.0
    front = [Math.sin(radians), Math.cos(radians), 0.0]
    right = [front[1], -front[0], 0.0]
    { 'furniture_instance_id' => id, 'label' => label,
      'origin_world_mm' => at, 'front_dir_mm' => front, 'right_dir_mm' => right,
      'local_min_mm' => [0.0, 0.0, 0.0], 'local_max_mm' => size }
  end

  def v3(vector)
    [vector.x.to_f, vector.y.to_f, vector.z.to_f]
  end

  def length3(vector)
    Math.sqrt((vector[0]**2) + (vector[1]**2) + (vector[2]**2))
  end

  def dot3(vec_a, vec_b)
    (vec_a[0] * vec_b[0]) + (vec_a[1] * vec_b[1]) + (vec_a[2] * vec_b[2])
  end

  def det3(x_vec, y_vec, z_vec)
    dot3(x_vec, [(y_vec[1] * z_vec[2]) - (y_vec[2] * z_vec[1]),
                 (y_vec[2] * z_vec[0]) - (y_vec[0] * z_vec[2]),
                 (y_vec[0] * z_vec[1]) - (y_vec[1] * z_vec[0])])
  end

  def rounded_cells(transform)
    transform.to_a.map { |value| value.round(9) }
  end

  def distance(from_point, to_point)
    Math.sqrt(from_point.each_index.map { |i| (from_point[i] - to_point[i])**2 }.sum)
  end

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

  # ------------------------------------------------------------------
  # Typed yaw (VCB) + right-click menu — power-user native affordances
  # (UX review 2026-09). Grammar pinned here: "45°"/"-90 deg" is ALWAYS a
  # yaw; a bare number is a yaw ONLY in free mode; with an active snap a
  # bare number keeps meaning the exact gap in mm.
  # ------------------------------------------------------------------

  def test_typed_bare_yaw_in_free_mode_rotates_the_basis
    placement_tool, = tool([[1000.0, 2000.0, 30.0]])
    placement_tool.activate
    move_cursor(placement_tool)

    assert placement_tool.onUserText('45', @view)
    assert_equal 45.0, placement_tool.yaw_degrees

    transform = placement_tool.current_transform
    cos45 = Math.cos(45 * Math::PI / 180.0)
    sin45 = Math.sin(45 * Math::PI / 180.0)
    assert_in_delta 1000.0 + (EXTENTS[:x] * cos45), point_mm(transform, EXTENTS[:x], 0, 0)[0], 1e-6
    assert_in_delta 2000.0 + (EXTENTS[:x] * sin45), point_mm(transform, EXTENTS[:x], 0, 0)[1], 1e-6
    # The anchor corner itself never moves: rotation is about the anchor.
    assert_equal [1000.0, 2000.0, 30.0], point_mm(transform, 0, 0, 0)
  end

  def test_typed_yaw_accepts_explicit_suffix_and_wraps_negative
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)

    assert placement_tool.onUserText('-90°', @view)
    assert_equal 270.0, placement_tool.yaw_degrees
    assert placement_tool.onUserText('30 deg', @view)
    assert_equal 30.0, placement_tool.yaw_degrees
  end

  def test_typed_yaw_matches_one_quarter_turn_at_90_degrees
    placement_tool, = tool([[500.0, 500.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)
    placement_tool.onUserText('90', @view)
    typed = placement_tool.current_transform

    placement_tool2, = tool([[500.0, 500.0, 0.0]])
    placement_tool2.activate
    placement_tool2.onMouseMove(0, 10, 10, @view)
    placement_tool2.onKeyDown(39, 1, 0, @view) # → right arrow quarter turn
    arrowed = placement_tool2.current_transform

    assert_equal rounded_cells(arrowed), rounded_cells(typed),
                 'typed 90° must reproduce exactly one arrow-key quarter turn'
  end

  def test_arrows_add_quarter_turns_on_top_of_a_typed_yaw
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)
    placement_tool.onUserText('45', @view)
    placement_tool.onKeyDown(39, 1, 0, @view) # right arrow: +90 on the yaw

    assert_equal 135.0, placement_tool.yaw_degrees
    assert_equal 0, placement_tool.rotation_quarters
  end

  def test_bare_number_with_floor_snap_stays_a_gap_not_a_yaw
    floor = [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }]
    placement_tool, = tool([[1000.0, 2000.0, 30.0]], base_planes: -> { floor })
    placement_tool.activate
    move_cursor(placement_tool)
    refute_nil placement_tool.active_snap, 'floor plane must produce a snap'

    assert placement_tool.onUserText('5', @view)
    assert_nil placement_tool.yaw_degrees, 'a bare number over a snap is the gap in mm'

    # An EXPLICIT angle still rotates: the floor never locks orientation.
    assert placement_tool.onUserText('45°', @view)
    assert_equal 45.0, placement_tool.yaw_degrees
  end

  def test_invalid_vcb_text_never_guesses
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)

    assert placement_tool.onUserText('hola', @view)
    assert_nil placement_tool.yaw_degrees
    assert_equal 0, placement_tool.rotation_quarters
  end

  # Host-faithful menu double: records the exact Sketchup::Menu surface a
  # real host offers (add_item(title) { block } / add_separator), in order.
  class RecordingMenu
    attr_reader :entries

    def initialize
      @entries = []
    end

    def add_item(title, &block)
      @entries << { type: :item, title: title, block: block }
      @entries.length
    end

    def add_separator
      @entries << { type: :separator }
    end

    def item_titles
      @entries.select { |e| e[:type] == :item }.map { |e| e[:title] }
    end

    def invoke(title)
      entry = @entries.find { |e| e[:type] == :item && e[:title] == title }
      raise "no menu item #{title.inspect}" unless entry

      entry[:block].call
    end
  end

  # Review #847 P1: the host entry point is the REAL Tool protocol
  # (#getMenu(menu) receiving a Sketchup::Menu), not a bespoke API. The
  # signature and the menu shape are asserted against a menu double that
  # mirrors the host surface; nothing here invents a callback.
  def test_context_menu_uses_the_real_get_menu_tool_protocol
    placement_tool, = tool([[0.0, 0.0, 0.0]])
    placement_tool.activate
    move_cursor(placement_tool)

    assert_equal 1, placement_tool.method(:getMenu).arity,
                 'SketchUp calls getMenu(menu) with exactly the menu'

    menu = RecordingMenu.new
    result = placement_tool.getMenu(menu)
    assert_same menu, result, 'getMenu returns the host menu it populated'

    assert_equal [
      Tool::CONTEXT_MENU_ROTATE_LEFT,
      Tool::CONTEXT_MENU_ROTATE_RIGHT,
      Tool::CONTEXT_MENU_CYCLE_ANCHOR,
      Tool::CONTEXT_MENU_CANCEL
    ], menu.item_titles

    separator_index = menu.entries.index { |e| e[:type] == :separator }
    cancel_index = menu.entries.index { |e| e[:title] == Tool::CONTEXT_MENU_CANCEL }
    anchor_index = menu.entries.index { |e| e[:title] == Tool::CONTEXT_MENU_CYCLE_ANCHOR }
    assert separator_index, 'the menu carries a separator'
    assert(anchor_index < separator_index && separator_index < cancel_index,
           'the separator groups the destructive exit below the gestures')

    menu.invoke(Tool::CONTEXT_MENU_ROTATE_RIGHT)
    assert_equal 1, placement_tool.rotation_quarters
    menu.invoke(Tool::CONTEXT_MENU_CYCLE_ANCHOR)
    assert_equal :back_right_bottom, placement_tool.anchor
    menu.invoke(Tool::CONTEXT_MENU_CANCEL)
    assert placement_tool.cancelled?
    assert_equal [:escape], @cancels
  end
end
