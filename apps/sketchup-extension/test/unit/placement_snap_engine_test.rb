# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/tools/placement_snap_engine'

# #469 increment 2 — the deterministic semantic snap engine. Pure unit
# tests over mm numerics: the three candidate families, the selection
# policy (per-axis ranking → type → key, cross-axis composition with
# orientation consistency), exact gap offsets and the fail-safe filters
# (sloped faces, non-axis-aligned targets, tolerance, free picks).
class PlacementSnapEngineTest < Minitest::Test
  Engine = Granete::SketchUpExtension::Tools::PlacementSnapEngine

  EXTENTS = { x: 800.0, y: 560.0, z: 720.0 }.freeze # w × d × h (asymmetric)
  ORIGIN = [0.0, 0.0, 0.0].freeze

  def solve(cursor_mm:, anchor: :back_left_bottom, rotation_quarters: 0,
            faces: [], managed_targets: [], extents: EXTENTS, origin: ORIGIN, eye_mm: nil)
    Engine.solve(cursor_mm: cursor_mm, extents_mm: extents, origin_mm: origin,
                 anchor: anchor, rotation_quarters: rotation_quarters,
                 faces: faces, managed_targets: managed_targets, eye_mm: eye_mm)
  end

  # ---- wall / face ----------------------------------------------------

  # Wall at x=0 facing +X: the box BACK face lands exactly on the plane,
  # the front faces +X (into the room) and the anchor keeps the cursor's
  # other coordinates (slide along the wall).
  def test_wall_snap_aligns_back_face_and_orients_front_away
    solution = solve(cursor_mm: [120.0, 2000.0, 30.0], eye_mm: [5000.0, 2000.0, 1600.0],
                     faces: [{ point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }])

    refute_nil solution
    face = solution[:components].find { |component| component[:kind] == :face }
    assert_equal [0.0, 2000.0, 30.0], solution[:anchor_mm],
                 'back-left-bottom anchor sits ON the wall plane; y/z follow the cursor'
    assert_equal 3, solution[:rotation_quarters], 'front (+Y local) maps to +X under q3'
    assert solution[:constrains_rotation]
    assert_equal 'Encajar a pared', face[:label]
    assert_equal 120.0, face[:displacement_mm], 'displacement is the anchor jump'
  end

  # The quarter turn derives from the EYE side of the plane — the same
  # physical wall reversed (±normal) must yield the SAME orientation: a
  # reversed face can never leave the furniture front facing the wall.
  def test_wall_orientation_comes_from_the_eye_side_not_the_face_normal
    walls = [
      { plane: [500.0, 500.0, 0.0], normals: [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]],
        eye_here: [600.0, 500.0, 0.0], q_here: 3, eye_there: [400.0, 500.0, 0.0], q_there: 1 },
      { plane: [500.0, 500.0, 0.0], normals: [[0.0, 1.0, 0.0], [0.0, -1.0, 0.0]],
        eye_here: [500.0, 600.0, 0.0], q_here: 0, eye_there: [500.0, 400.0, 0.0], q_there: 2 }
    ]
    walls.each do |wall|
      { wall[:eye_here] => wall[:q_here], wall[:eye_there] => wall[:q_there] }.each do |eye, quarters|
        wall[:normals].each do |normal|
          solution = solve(cursor_mm: [600.0, 600.0, 0.0], eye_mm: eye,
                           faces: [{ point_mm: wall[:plane], normal_mm: normal }])
          refute_nil solution, "eye #{eye} normal #{normal} must produce a wall candidate"
          assert_equal quarters, solution[:rotation_quarters],
                       "eye #{eye}: front faces the eye side regardless of the normal sign #{normal}"
        end
      end
    end
  end

  # Without an eye (no camera context), or with the eye exactly on the
  # plane, the room side is unresolvable: no wall candidate, no guess.
  def test_wall_candidate_requires_a_resolvable_eye_side
    face = { point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }
    assert_nil solve(cursor_mm: [100.0, 2000.0, 30.0], faces: [face]), 'no eye → no candidate'
    assert_nil solve(cursor_mm: [100.0, 2000.0, 30.0], faces: [face], eye_mm: [0.0, 2000.0, 900.0]),
               'eye exactly on the plane → unresolvable → no candidate'
  end

  # A front-anchored grab still aligns the BACK: the anchor is one depth
  # away from the wall (the active anchor participates in the math).
  def test_wall_snap_with_front_anchor_places_anchor_a_depth_away
    solution = solve(cursor_mm: [600.0, 2000.0, 0.0], anchor: :front_left_bottom,
                     eye_mm: [5000.0, 2000.0, 1600.0],
                     faces: [{ point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }])

    refute_nil solution
    assert_equal [560.0, 2000.0, 0.0], solution[:anchor_mm],
                 'the front anchor ends at wall plane + depth (560)'
  end

  # Sloped faces are orientation-incompatible: nothing is proposed.
  def test_sloped_face_offers_no_candidate
    assert_nil solve(cursor_mm: [100.0, 100.0, 100.0],
                     faces: [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [0.7, 0.0, 0.7] }])
  end

  # Beyond the tolerance there is no snap — the preview keeps the pick.
  def test_face_candidate_outside_tolerance_is_dropped
    assert_nil solve(cursor_mm: [Engine::TOLERANCE_MM + 1.0, 100.0, 0.0],
                     eye_mm: [5000.0, 100.0, 900.0],
                     faces: [{ point_mm: [0.0, 100.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }])
  end

  # ---- floor / base plane ----------------------------------------------

  def test_floor_snap_pins_base_to_horizontal_face_and_keeps_rotation
    solution = solve(cursor_mm: [1000.0, 2000.0, 0.0], rotation_quarters: 2,
                     faces: [{ point_mm: [900.0, 900.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal [1000.0, 2000.0, 0.0], solution[:anchor_mm]
    assert_equal 2, solution[:rotation_quarters], 'the floor never reorients'
    refute solution[:constrains_rotation]
    assert_equal 'Piso', solution[:label]
  end

  # A raised horizontal face (table/riser) is a base plane too.
  def test_raised_horizontal_face_is_a_base_plane_reference
    solution = solve(cursor_mm: [1000.0, 1000.0, 300.0],
                     faces: [{ point_mm: [0.0, 0.0, 300.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal 300.0, solution[:anchor_mm][2]
  end

  # A downward-facing horizontal face is NOT a base plane.
  def test_downward_face_is_not_a_floor_candidate
    assert_nil solve(cursor_mm: [1000.0, 1000.0, 0.0],
                     faces: [{ point_mm: [0.0, 0.0, 100.0], normal_mm: [0.0, 0.0, -1.0] }])
  end

  # No face at all → free placement (increment 1 behavior preserved).
  def test_free_pick_without_faces_yields_no_solution
    assert_nil solve(cursor_mm: [1000.0, 2000.0, 30.0])
  end

  # ---- furniture side-to-side -------------------------------------------

  # Managed B03 at [0..600, 0..560, 0..720] facing +Y. Its RIGHT side
  # (x=600) receives the new furniture LEFT side at gap 0: fronts stay
  # parallel, the new box grows to +X, and the target is identified by
  # furnitureInstanceId — never by name.
  def test_furniture_side_snap_right_side_receives_new_left_side
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    solution = solve(cursor_mm: [700.0, 300.0, 0.0], managed_targets: [target])

    refute_nil solution
    side = solution[:components].find { |component| component[:kind] == :furniture_side }
    refute_nil side
    assert_equal 'fi-B03', side[:furniture_instance_id]
    assert_equal 'Encajar a B03 · lateral derecho', side[:label]
    assert_equal 600.0, solution[:anchor_mm][0], 'new left side exactly on x=600'
    assert_equal 0, solution[:rotation_quarters], 'fronts stay parallel (+Y)'
    assert solution[:constrains_rotation]
    assert_equal side, solution[:primary], 'a horizontal constraint is primary over none'
  end

  # The LEFT side of the target receives the new furniture's RIGHT side:
  # the new box grows along −X with the fronts still parallel, and the
  # grabbed front-right corner sits exactly on the plane.
  def test_furniture_side_snap_left_side_receives_new_right_side
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    solution = solve(cursor_mm: [-100.0, 300.0, 0.0], anchor: :front_right_bottom,
                     managed_targets: [target])

    refute_nil solution
    assert_equal [0.0, 300.0, 0.0], solution[:anchor_mm],
                 'the front-right anchor sits exactly on the target left side plane x=0'
    assert_equal 0, solution[:rotation_quarters], 'fronts stay parallel (+Y)'
    assert(solution[:components].any? { |component| component[:label].include?('lateral izquierdo') })
  end

  # A side is a FINITE rectangle, not an infinite plane: close along the
  # constrained axis but METERS away along the wall (tangential) or in
  # height must NOT capture the snap.
  def test_distant_tangential_target_is_not_a_candidate
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    # x is 100mm off the right side, but y=5000 is 4440mm past the side's
    # 560mm span — meters away along the wall.
    assert_nil solve(cursor_mm: [700.0, 5000.0, 0.0], managed_targets: [target])
  end

  def test_distant_vertical_target_is_not_a_candidate
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    # Hovering at z=2200 while the neighbor only reaches 720: no snap.
    assert_nil solve(cursor_mm: [700.0, 300.0, 2200.0], managed_targets: [target])
  end

  # Beyond the rectangle's end but WITHIN the same tolerance margin the
  # side is still proposed (overhang scenarios) — the rule is a margin,
  # not a hard edge.
  def test_nearby_overhang_beyond_the_side_end_still_snaps
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    # y=700 is 140mm past the 560mm side end — inside the 250mm margin.
    solution = solve(cursor_mm: [700.0, 700.0, 0.0], managed_targets: [target])
    refute_nil solution
    assert_equal 600.0, solution[:anchor_mm][0]
  end

  # A target rotated off the quarter grid has no axis-aligned sides: no
  # candidate (orientation-compatible filter).
  def test_furniture_target_off_the_quarter_grid_offers_nothing
    target = managed_target(id: 'fi-x', label: 'X',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0],
                            front: [0.7, 0.7, 0.0])
    assert_nil solve(cursor_mm: [700.0, 300.0, 0.0], managed_targets: [target])
  end

  # ---- selection policy --------------------------------------------------

  # Equal displacement on the SAME axis: the more specific intent wins
  # (furniture_side < face < floor), then the target key breaks the tie.
  def test_same_axis_ranking_prefers_type_then_key
    wall = { point_mm: [500.0, 0.0, 0.0], normal_mm: [-1.0, 0.0, 0.0] }
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [500.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    # Both constrain axis 0 at plane x=500 with displacement 100.
    solution = solve(cursor_mm: [400.0, 300.0, 0.0], faces: [wall], managed_targets: [target])

    refute_nil solution
    assert_equal :furniture_side, solution[:primary][:kind],
                 'equal displacement on one axis: the furniture side wins'
  end

  # Smaller displacement always beats type priority.
  def test_smaller_displacement_beats_type_priority
    wall = { point_mm: [500.0, 0.0, 0.0], normal_mm: [-1.0, 0.0, 0.0] }
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [520.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    # Same axis 0: wall plane x=500 (displacement 20 at cursor 480) beats
    # the furniture side plane x=520 (displacement 40) despite the side's
    # higher type priority.
    solution = solve(cursor_mm: [480.0, 300.0, 0.0], eye_mm: [0.0, 300.0, 900.0],
                     faces: [wall], managed_targets: [target])
    assert_equal :face, solution[:primary][:kind]
  end

  # Different axes compose: wall + floor form a corner, the horizontal
  # constraint stays primary (the run intent), and the label joins both.
  def test_wall_and_floor_compose_across_axes_with_horizontal_primary
    solution = solve(cursor_mm: [100.0, 2000.0, 30.0], eye_mm: [5000.0, 2000.0, 1600.0],
                     faces: [{ point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] },
                             { point_mm: [900.0, 900.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal 2, solution[:components].length
    assert_equal :face, solution[:primary][:kind]
    assert_equal [0.0, 2000.0, 0.0], solution[:anchor_mm], 'back on the wall AND base on the floor'
    assert_equal 'Encajar a pared · Piso', solution[:label]
  end

  # Orientation-conflicting constraints on different axes: the globally
  # best one wins and the conflicting one is dropped, never averaged.
  def test_orientation_conflict_drops_the_weaker_constraint
    solution = solve(cursor_mm: [100.0, 100.0, 0.0], eye_mm: [5000.0, 5000.0, 900.0],
                     faces: [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [1.0, 0.0, 0.0] },
                             { point_mm: [0.0, 0.0, 0.0], normal_mm: [0.0, -1.0, 0.0] }])

    refute_nil solution
    assert_equal 1, solution[:components].length, 'q0 conflicts with q3: one must go'
    assert_equal 3, solution[:rotation_quarters]
  end

  # ---- exact gap ---------------------------------------------------------

  def test_apply_gap_moves_the_anchor_exactly_along_the_primary_normal
    target = managed_target(id: 'fi-B03', label: 'B03',
                            min: [0.0, 0.0, 0.0], max: [600.0, 560.0, 720.0], front: [0.0, 1.0, 0.0])
    solution = solve(cursor_mm: [700.0, 300.0, 0.0], managed_targets: [target])

    gapped = Engine.apply_gap(solution, 5.0)
    assert_equal [605.0, 300.0, 0.0], gapped, 'gap 5 mm separates the sides exactly'
    negative = Engine.apply_gap(solution, -5.0)
    assert_equal [595.0, 300.0, 0.0], negative, 'a negative gap overlaps by construction'
  end

  def test_parse_gap_mm_accepts_plain_numbers_and_units_only
    assert_equal 5.0, Engine.parse_gap_mm('5')
    assert_equal 5.5, Engine.parse_gap_mm('5.5')
    assert_equal 5.0, Engine.parse_gap_mm(' 5mm ')
    assert_equal(-3.0, Engine.parse_gap_mm('-3'))
    assert_nil Engine.parse_gap_mm('cinco')
    assert_nil Engine.parse_gap_mm('')
    assert_nil Engine.parse_gap_mm('5m') # never silently reinterpret units
    assert_nil Engine.parse_gap_mm(nil)
  end

  # ---- shared anchor authority -------------------------------------------

  def test_anchor_local_point_matches_the_tool_corner_semantics
    assert_equal [0.0, 0.0, 0.0],
                 Engine.anchor_local_point(:back_left_bottom, EXTENTS, ORIGIN)
    assert_equal [800.0, 560.0, 0.0],
                 Engine.anchor_local_point(:front_right_bottom, EXTENTS, ORIGIN)
    assert_equal [100.0, 50.0, 20.0],
                 Engine.anchor_local_point(:back_left_bottom, EXTENTS, [100.0, 50.0, 20.0])
  end

  # ---- negative proof: transform-only ------------------------------------

  # The engine only ever produces anchor + quarter turn values; the box
  # extents it is given can never be altered by a snap or a gap.
  def test_solution_never_carries_or_changes_extents
    extents = { x: 800.0, y: 560.0, z: 720.0 }
    solution = solve(cursor_mm: [120.0, 2000.0, 30.0], eye_mm: [5000.0, 2000.0, 1600.0],
                     faces: [{ point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }],
                     extents: extents)
    refute_nil solution
    Engine.apply_gap(solution, 5000.0)
    assert_equal 800.0, extents[:x]
    assert_equal 560.0, extents[:y]
    assert_equal 720.0, extents[:z]
    refute solution.key?(:extents_mm), 'the solution carries no dimensions at all'
  end

  private

  def managed_target(id:, label:, min:, max:, front:)
    { 'furniture_instance_id' => id, 'label' => label,
      'min_mm' => min, 'max_mm' => max, 'front_dir' => front }
  end
end
