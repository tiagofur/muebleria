# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/tools/placement_snap_engine'

# #469 increments 2+3 — the deterministic semantic snap engine. Pure unit
# tests over mm numerics: the three candidate families (walls and managed
# sides at ANY horizontal yaw since increment 3), the selection policy
# (orientation-relative slot ranking → type → key, cross-slot composition
# with orientation consistency), exact gap offsets along the snap NORMAL
# and the fail-safe filters (tilted faces/frames, tolerance, free picks).
class PlacementSnapEngineTest < Minitest::Test
  Engine = Granete::SketchUpExtension::Tools::PlacementSnapEngine

  EXTENTS = { x: 800.0, y: 560.0, z: 720.0 }.freeze # w × d × h (asymmetric)
  ORIGIN = [0.0, 0.0, 0.0].freeze

  def solve(cursor_mm:, anchor: :back_left_bottom,
            faces: [], managed_targets: [], extents: EXTENTS, origin: ORIGIN, eye_mm: nil)
    Engine.solve(cursor_mm: cursor_mm, extents_mm: extents, origin_mm: origin,
                 anchor: anchor, faces: faces, managed_targets: managed_targets, eye_mm: eye_mm)
  end

  def deg(value)
    value * Math::PI / 180.0
  end

  # Unit horizontal direction at a yaw measured from +Y (the engine's
  # front at quarter 0): yaw 0 → +Y, 90 → +X.
  def dir_at_yaw(yaw_degrees)
    [Math.sin(deg(yaw_degrees)), Math.cos(deg(yaw_degrees)), 0.0]
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
    assert_in_epsilon 1.0, solution[:front_dir_mm][0], 1e-9, 'front (+Y local) maps to +X'
    assert_in_delta 0.0, solution[:front_dir_mm][1], 1e-9
    assert solution[:constrains_rotation]
    assert_equal 'Encajar a pared', face[:label]
    assert_equal 120.0, face[:displacement_mm], 'displacement is the anchor jump'
  end

  # The front derives from the EYE side of the plane — the same physical
  # wall reversed (±normal) must yield the SAME orientation: a reversed
  # face can never leave the furniture front facing the wall.
  def test_wall_orientation_comes_from_the_eye_side_not_the_face_normal
    walls = [
      { plane: [500.0, 500.0, 0.0], normals: [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]],
        eye_here: [600.0, 500.0, 0.0], front_here: [1.0, 0.0, 0.0],
        eye_there: [400.0, 500.0, 0.0], front_there: [-1.0, 0.0, 0.0] },
      { plane: [500.0, 500.0, 0.0], normals: [[0.0, 1.0, 0.0], [0.0, -1.0, 0.0]],
        eye_here: [500.0, 600.0, 0.0], front_here: [0.0, 1.0, 0.0],
        eye_there: [500.0, 400.0, 0.0], front_there: [0.0, -1.0, 0.0] }
    ]
    walls.each do |wall|
      { wall[:eye_here] => wall[:front_here], wall[:eye_there] => wall[:front_there] }.each do |eye, front|
        wall[:normals].each do |normal|
          solution = solve(cursor_mm: [600.0, 600.0, 0.0], eye_mm: eye,
                           faces: [{ point_mm: wall[:plane], normal_mm: normal }])
          refute_nil solution, "eye #{eye} normal #{normal} must produce a wall candidate"
          assert_in_epsilon front[0], solution[:front_dir_mm][0], 1e-9,
                            "eye #{eye}: front faces the eye side regardless of the normal sign #{normal}"
          assert_in_epsilon front[1], solution[:front_dir_mm][1], 1e-9
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

  # Tilted faces are orientation-incompatible: nothing is proposed.
  def test_tilted_face_offers_no_candidate
    assert_nil solve(cursor_mm: [100.0, 100.0, 100.0],
                     faces: [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [0.7, 0.0, 0.7] }])
  end

  # Beyond the tolerance there is no snap — the preview keeps the pick.
  def test_face_candidate_outside_tolerance_is_dropped
    assert_nil solve(cursor_mm: [Engine::TOLERANCE_MM + 1.0, 100.0, 0.0],
                     eye_mm: [5000.0, 100.0, 900.0],
                     faces: [{ point_mm: [0.0, 100.0, 0.0], normal_mm: [1.0, 0.0, 0.0] }])
  end

  # ---- wall at arbitrary yaw (increment 3) ------------------------------

  # A wall at 30°: the back face lands exactly on the 30° plane, the front
  # is the eye-side unit normal, and the anchor sits ON the plane — the
  # direction is NEVER rounded to its nearest world axis.
  def test_wall_at_30_degrees_aligns_back_face_on_the_rotated_plane
    normal = dir_at_yaw(-60.0) # wall line at 30°: normal perpendicular to it
    plane_point = [1000.0, 500.0, 0.0]
    cursor = add(plane_point, scale(normal, 80.0)) # hovering 80mm off the wall
    solution = solve(cursor_mm: cursor, eye_mm: add(cursor, scale(normal, 4000.0)),
                     faces: [{ point_mm: plane_point, normal_mm: normal }])

    refute_nil solution, 'a 30° wall must offer a candidate'
    assert_in_delta 0.0, Engine.dot3(sub3(solution[:anchor_mm], plane_point), normal), 1e-9,
                    'the anchor sits exactly ON the rotated plane (zero signed distance)'
    [normal[0], normal[1]].each_with_index do |component, index|
      assert_in_epsilon component, solution[:front_dir_mm][index], 1e-9,
                        'the proposed front keeps the REAL angle (no axis rounding)'
    end
    assert_in_epsilon 80.0, solution[:components].first[:displacement_mm], 1e-9
  end

  # The same physical wall at ANY yaw must be invariant to Face#reverse!:
  # ±normal with the same eye produce the identical placement.
  def test_reversed_wall_at_37_and_a_half_degrees_yields_the_identical_placement
    normal = dir_at_yaw(37.5 + 90.0)
    plane_point = [300.0, 700.0, 0.0]
    cursor = add(plane_point, scale(normal, 50.0))
    eye = add(cursor, scale(normal, 5000.0))

    unreversed = solve(cursor_mm: cursor, eye_mm: eye,
                       faces: [{ point_mm: plane_point, normal_mm: normal }])
    reversed_face = solve(cursor_mm: cursor, eye_mm: eye,
                          faces: [{ point_mm: plane_point, normal_mm: scale(normal, -1.0) }])

    refute_nil unreversed
    refute_nil reversed_face
    assert_equal unreversed[:anchor_mm].map { |v| v.round(9) }, reversed_face[:anchor_mm].map { |v| v.round(9) },
                 'a reversed 37.5° wall places the furniture identically'
    assert_equal(unreversed[:front_dir_mm].map { |v| v.round(9) },
                 reversed_face[:front_dir_mm].map { |v| v.round(9) })
  end

  # Exact gap along the normal of a 30° wall: 40mm measured PERPENDICULAR
  # to the wall, not along any world axis.
  def test_wall_gap_at_30_degrees_travels_the_normal_vector
    normal = dir_at_yaw(30.0)
    plane_point = [0.0, 0.0, 0.0]
    cursor = add(plane_point, scale(normal, 30.0))
    solution = solve(cursor_mm: cursor, eye_mm: add(cursor, scale(normal, 8000.0)),
                     faces: [{ point_mm: plane_point, normal_mm: normal }])
    refute_nil solution

    gapped = Engine.apply_gap(solution, 40.0)
    assert_in_epsilon 40.0, Engine.dot3(sub3(gapped, plane_point), normal), 1e-9,
                      'the anchor rests exactly 40mm off the wall along the normal'
    # Perpendicular distance is the gap — not a world-axis coordinate:
    # neither |Δx| nor |Δy| alone equals 40 at a 30° wall.
    delta = sub3(gapped, solution[:anchor_mm])
    refute_in_delta 40.0, delta[0].abs, 0.5
    refute_in_delta 40.0, delta[1].abs, 0.5
    assert_in_epsilon 40.0, Math.sqrt((delta[0]**2) + (delta[1]**2)), 1e-9
  end

  # Wall + floor composition at an arbitrary angle: the wall owns the XY
  # orientation + normal constraint, the floor owns Z, one solution.
  def test_wall_at_45_degrees_composes_with_the_floor
    normal = dir_at_yaw(45.0)
    wall_point = [0.0, 0.0, 0.0]
    cursor = add(add(wall_point, scale(normal, 60.0)), [0.0, 0.0, 25.0])
    solution = solve(cursor_mm: cursor, eye_mm: add(cursor, scale(normal, 6000.0)),
                     faces: [{ point_mm: wall_point, normal_mm: normal },
                             { point_mm: [0.0, 0.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal 2, solution[:components].length, 'wall + floor compose at any angle'
    assert_equal :face, solution[:primary][:kind], 'the wall stays primary (run intent)'
    assert_in_delta 0.0, Engine.dot3(solution[:anchor_mm], normal), 1e-9, 'back on the 45° wall'
    assert_in_delta 0.0, solution[:anchor_mm][2], 1e-9, 'base on the floor'
  end

  # ---- floor / base plane ----------------------------------------------

  def test_floor_snap_pins_base_to_horizontal_face_and_keeps_rotation_free
    solution = solve(cursor_mm: [1000.0, 2000.0, 0.0],
                     faces: [{ point_mm: [900.0, 900.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal [1000.0, 2000.0, 0.0], solution[:anchor_mm]
    assert_nil solution[:front_dir_mm], 'the floor never reorients'
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

  # A REVERSED floor face (−Z normal) is the SAME base plane as the
  # unreversed one: the snap cannot depend on how the face was wound
  # (the wall fix already established Face#normal sign is not authority).
  def test_floor_snap_is_invariant_to_face_winding
    unreversed = solve(cursor_mm: [1000.0, 1000.0, 950.0],
                       faces: [{ point_mm: [0.0, 0.0, 1000.0], normal_mm: [0.0, 0.0, 1.0] }])
    reversed_face = solve(cursor_mm: [1000.0, 1000.0, 950.0],
                          faces: [{ point_mm: [0.0, 0.0, 1000.0], normal_mm: [0.0, 0.0, -1.0] }])
    both = solve(cursor_mm: [1000.0, 1000.0, 950.0],
                 faces: [{ point_mm: [0.0, 0.0, 1000.0], normal_mm: [0.0, 0.0, 1.0] },
                         { point_mm: [0.0, 0.0, 1000.0], normal_mm: [0.0, 0.0, -1.0] }])

    refute_nil unreversed, '+Z face is a base plane'
    refute_nil reversed_face, 'the same floor reversed must offer the SAME snap'
    assert_equal unreversed[:anchor_mm], reversed_face[:anchor_mm]
    assert_equal 'Piso', reversed_face[:label]
    assert_equal 1, both[:components].length,
                 'both windings dedup to ONE base-plane candidate (same key)'
    assert_equal 1000.0, both[:anchor_mm][2]
  end

  # No face at all → free placement (increment 1 behavior preserved).
  def test_free_pick_without_faces_yields_no_solution
    assert_nil solve(cursor_mm: [1000.0, 2000.0, 30.0])
  end

  # Review r2 A: a footprint-bearing base plane is spatially FINITE — a
  # platform whose Z is close but whose XY footprint is METERS away is
  # NOT a candidate, while the same plane whose footprint covers the
  # cursor snaps (B).
  def test_base_plane_footprint_bounds_spatial_relevance
    distant = { point_mm: [5000.0, 5000.0, 100.0], normal_mm: [0.0, 0.0, 1.0],
                'footprint_min_mm' => [4800.0, 4800.0, 100.0],
                'footprint_max_mm' => [6200.0, 6200.0, 100.0] }
    assert_nil solve(cursor_mm: [100.0, 100.0, 30.0], faces: [distant]),
               'close in Z (70mm) but meters away in XY: no snap'

    near = distant.merge('point_mm' => [0.0, 0.0, 100.0],
                         'footprint_min_mm' => [-1000.0, -1000.0, 100.0],
                         'footprint_max_mm' => [1000.0, 1000.0, 100.0])
    solution = solve(cursor_mm: [100.0, 100.0, 30.0], faces: [near])
    refute_nil solution, 'the footprint covers the cursor: the floor snaps'
    assert_in_delta 100.0, solution[:anchor_mm][2], 1e-9
  end

  # ---- furniture side-to-side -------------------------------------------

  # Managed B03 at [0..600, 0..560, 0..720] facing +Y. Its RIGHT side
  # (x=600) receives the new furniture LEFT side at gap 0: fronts stay
  # parallel, the new box grows to +X, and the target is identified by
  # furnitureInstanceId — never by name.
  def test_furniture_side_snap_right_side_receives_new_left_side
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
    solution = solve(cursor_mm: [700.0, 300.0, 0.0], managed_targets: [target])

    refute_nil solution
    side = solution[:components].find { |component| component[:kind] == :furniture_side }
    refute_nil side
    assert_equal 'fi-B03', side[:furniture_instance_id]
    assert_equal 'Encajar a B03 · lateral derecho', side[:label]
    assert_equal 600.0, solution[:anchor_mm][0], 'new left side exactly on x=600'
    assert_equal [0.0, 1.0, 0.0], solution[:front_dir_mm], 'fronts stay parallel (+Y)'
    assert solution[:constrains_rotation]
    assert_equal side, solution[:primary], 'a horizontal constraint is primary over none'
  end

  # The LEFT side of the target receives the new furniture's RIGHT side:
  # the new box grows along −X with the fronts still parallel, and the
  # grabbed front-right corner sits exactly on the plane.
  def test_furniture_side_snap_left_side_receives_new_right_side
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
    solution = solve(cursor_mm: [-100.0, 300.0, 0.0], anchor: :front_right_bottom,
                     managed_targets: [target])

    refute_nil solution
    assert_equal [0.0, 300.0, 0.0], solution[:anchor_mm],
                 'the front-right anchor sits exactly on the target left side plane x=0'
    assert_equal [0.0, 1.0, 0.0], solution[:front_dir_mm], 'fronts stay parallel (+Y)'
    assert(solution[:components].any? { |component| component[:label].include?('lateral izquierdo') })
  end

  # A side is a FINITE rectangle, not an infinite plane: close along the
  # constraint axis but METERS away along the run (tangential) or in
  # height must NOT capture the snap.
  def test_distant_tangential_target_is_not_a_candidate
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
    # x is 100mm off the right side, but y=5000 is 4440mm past the side's
    # 560mm span — meters away along the run.
    assert_nil solve(cursor_mm: [700.0, 5000.0, 0.0], managed_targets: [target])
  end

  def test_distant_vertical_target_is_not_a_candidate
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
    # Hovering at z=2200 while the neighbor only reaches 720: no snap.
    assert_nil solve(cursor_mm: [700.0, 300.0, 2200.0], managed_targets: [target])
  end

  # Beyond the rectangle's end but WITHIN the same tolerance margin the
  # side is still proposed (overhang scenarios) — the rule is a margin,
  # not a hard edge.
  def test_nearby_overhang_beyond_the_side_end_still_snaps
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
    # y=700 is 140mm past the 560mm side end — inside the 250mm margin.
    solution = solve(cursor_mm: [700.0, 700.0, 0.0], managed_targets: [target])
    refute_nil solution
    assert_equal 600.0, solution[:anchor_mm][0]
  end

  # ---- furniture side at arbitrary yaw (increment 3) ---------------------

  # A managed neighbor rotated to ANY yaw keeps working: target right side
  # → new left side, fronts PARALLEL (never coerced to the quarter grid),
  # and the snap plane is the target's ORIENTED side — verified at 17°,
  # 30°, 37.5°, 45° and 123°.
  def test_rotated_neighbor_side_snap_keeps_fronts_parallel_and_exact_normal_distance
    [17.0, 30.0, 37.5, 45.0, 123.0].each do |yaw|
      target = rotated_target(id: 'fi-R', label: 'R', yaw_degrees: yaw,
                              size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
      front = dir_at_yaw(yaw)
      right = [front[1], -front[0], 0.0]
      # 40mm off the oriented right-side plane, mid-run (cursor expressed
      # IN the target frame — a world offset would change the distance at
      # every yaw).
      cursor = add(scale(right, 640.0), scale(front, 280.0))
      solution = solve(cursor_mm: cursor, managed_targets: [target])

      refute_nil solution, "neighbor at #{yaw}° must offer a side candidate"
      side = solution[:components].find { |component| component[:kind] == :furniture_side }
      refute_nil side
      assert_in_epsilon front[0], solution[:front_dir_mm][0], 1e-9,
                        "#{yaw}°: the new furniture front stays PARALLEL to the target"
      assert_in_epsilon front[1], solution[:front_dir_mm][1], 1e-9
      # The new left side lands exactly on the oriented plane x·right = 600.
      assert_in_epsilon 600.0, Engine.dot3(solution[:anchor_mm], right), 1e-9,
                        "#{yaw}°: the anchor sits on the ORIENTED side plane"
    end
  end

  # Exact gap along the oriented normal: neighbor at 37°, gap 5mm → the
  # side-to-side separation measured PERPENDICULAR to the run is exactly
  # 5mm; fronts parallel; no overlap; nothing coerced to a world axis.
  def test_rotated_neighbor_gap_5mm_measures_perpendicular_to_the_run
    yaw = 37.0
    target = rotated_target(id: 'fi-R', label: 'R', yaw_degrees: yaw,
                            size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    front = dir_at_yaw(yaw)
    right = [front[1], -front[0], 0.0]
    cursor = add(scale(right, 620.0), scale(front, 280.0))
    solution = solve(cursor_mm: cursor, managed_targets: [target])
    refute_nil solution

    gapped = Engine.apply_gap(solution, 5.0)
    # Signed distance from the oriented side plane along its normal.
    assert_in_epsilon 5.0, Engine.dot3(gapped, right) - 600.0, 1e-9,
                      'the sides separate by exactly 5mm along the oriented normal'
    assert_in_epsilon 5.0, Engine.dot3(sub3(gapped, solution[:anchor_mm]), right), 1e-9,
                      'the gap travels the NORMAL vector, not a world axis'
    # No overlap: the new box starts at the plane + 5mm outward.
    assert Engine.dot3(gapped, right) > 600.0
  end

  # NEGATIVE PROOF against the world-AABB regression: for a neighbor at
  # 45°, the ORIENTED right side plane and the world AABB face are
  # genuinely DIFFERENT planes — and the snap must use the oriented one.
  def test_rotated_side_uses_the_oriented_plane_not_the_world_aabb
    size = [600.0, 560.0, 720.0]
    target = rotated_target(id: 'fi-AABB', label: 'AABB', yaw_degrees: 45.0,
                            size: size, at: [0.0, 0.0, 0.0])
    front = dir_at_yaw(45.0)
    right = [front[1], -front[0], 0.0]
    # World AABB of the rotated box along X: max_x = √2/2·(600+560).
    aabb_max_x = (Math.sqrt(2.0) / 2.0) * (size[0] + size[1])
    refute_in_epsilon 600.0, Engine.dot3([aabb_max_x, 0.0, 0.0], right), 1e-6,
                      'fixture sanity: the AABB face is NOT the oriented side plane'

    cursor = add(add(scale(right, 650.0), scale(front, 100.0)), [0.0, 0.0, 100.0])
    solution = solve(cursor_mm: cursor, managed_targets: [target])

    refute_nil solution
    side = solution[:components].find { |component| component[:kind] == :furniture_side }
    refute_nil side
    anchor = solution[:anchor_mm]
    assert_in_epsilon 600.0, Engine.dot3(anchor, right), 1e-9,
                      'the anchor lies exactly on the ORIENTED side plane'
    refute_in_epsilon 600.0, Engine.dot3([anchor[0], 0.0, 0.0], right), 1e-3,
                      'a world-AABB-derived plane cannot explain this placement'
    assert_in_epsilon right[0], side[:normal_mm][0], 1e-9, 'the constraint normal is the oriented outward'
    assert_in_epsilon right[1], side[:normal_mm][1], 1e-9
  end

  # The finite rectangle is measured in the ORIENTED frame: a cursor close
  # along the normal but meters away along the target's RUN axis (not
  # world X/Y) is not a candidate even for rotated neighbors.
  def test_rotated_side_rectangle_spans_follow_the_oriented_run_axis
    target = rotated_target(id: 'fi-R2', label: 'R2', yaw_degrees: 30.0,
                            size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    front = dir_at_yaw(30.0)
    right = [front[1], -front[0], 0.0]
    # Near the oriented plane, but 4000mm past the end of the 560mm run.
    cursor = add(add(scale(right, 640.0), scale(front, 4500.0)), [0.0, 0.0, 0.0])
    assert_nil solve(cursor_mm: cursor, managed_targets: [target]),
               'meters past the rotated side end along the RUN axis: no candidate'
  end

  # A target frame that is tilted/mirrored/non-rigid offers nothing —
  # replaces the quarter-grid rejection with a true geometric fail-closed.
  def test_tilted_or_mirrored_target_frames_offer_nothing
    tilted = rotated_target(id: 'fi-T', label: 'T', yaw_degrees: 30.0,
                            size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    tilted['front_dir_mm'] = [tilted['front_dir_mm'][0], tilted['front_dir_mm'][1], 0.3]
    mirrored = rotated_target(id: 'fi-M', label: 'M', yaw_degrees: 30.0,
                              size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    mirrored['right_dir_mm'] = scale3_of(mirrored['right_dir_mm'], -1.0)

    cursor = [700.0, 300.0, 0.0]
    assert_nil solve(cursor_mm: cursor, managed_targets: [tilted]), 'tilted frame fails closed'
    assert_nil solve(cursor_mm: cursor, managed_targets: [mirrored]), 'mirrored frame fails closed'
  end

  # ---- selection policy --------------------------------------------------

  # Equal displacement on the SAME constraint line: the more specific
  # intent wins (furniture_side < face < floor), then the target key
  # breaks the tie. The eye is required so the wall candidate really
  # exists — and both candidates' displacements are verified BEFORE
  # composing, so the tie itself is pinned, not just the winner.
  def test_same_line_ranking_prefers_type_then_key
    wall = { point_mm: [500.0, 0.0, 0.0], normal_mm: [-1.0, 0.0, 0.0] }
    target = axis_aligned_target(id: 'fi-B03', label: 'B03').merge('local_max_mm' => [500.0, 560.0, 720.0])
    eye = [0.0, 300.0, 900.0] # resolvable: the wall's room side is −X
    full_context = { cursor_mm: [400.0, 300.0, 0.0], extents_mm: EXTENTS, origin_mm: ORIGIN,
                     anchor: :back_left_bottom, eye_mm: eye }

    face_candidates = Engine.face_candidates([wall], full_context)
    side_candidates = Engine.furniture_side_candidates([target], full_context)
    refute_empty face_candidates, 'the wall candidate must exist (eye provided)'
    refute_empty side_candidates, 'the managed side candidate must exist'
    assert_in_epsilon 100.0, face_candidates.first[:displacement_mm], 1e-9,
                      'wall anchor lands on the plane x=500 (cursor at 400)'
    assert_in_epsilon 100.0, side_candidates.first[:displacement_mm], 1e-9,
                      'side anchor lands on the plane x=500 (cursor at 400)'

    solution = solve(cursor_mm: [400.0, 300.0, 0.0], eye_mm: eye,
                     faces: [wall], managed_targets: [target])

    refute_nil solution
    assert_equal :furniture_side, solution[:primary][:kind],
                 'equal displacement on one line: the furniture side wins'
  end

  # Smaller displacement always beats type priority.
  def test_smaller_displacement_beats_type_priority
    wall = { point_mm: [500.0, 0.0, 0.0], normal_mm: [-1.0, 0.0, 0.0] }
    target = axis_aligned_target(id: 'fi-B03', label: 'B03').merge('local_max_mm' => [520.0, 560.0, 720.0])
    # Same line: wall plane x=500 (displacement 20 at cursor 480) beats
    # the furniture side plane x=520 (displacement 40) despite the side's
    # higher type priority.
    solution = solve(cursor_mm: [480.0, 300.0, 0.0], eye_mm: [0.0, 300.0, 900.0],
                     faces: [wall], managed_targets: [target])
    assert_equal :face, solution[:primary][:kind]
  end

  # Different orientation slots compose: wall + floor form a corner, the
  # horizontal constraint stays primary (the run intent), and the label
  # joins both.
  def test_wall_and_floor_compose_with_horizontal_primary
    solution = solve(cursor_mm: [100.0, 2000.0, 30.0], eye_mm: [5000.0, 2000.0, 1600.0],
                     faces: [{ point_mm: [0.0, 1500.0, 0.0], normal_mm: [1.0, 0.0, 0.0] },
                             { point_mm: [900.0, 900.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])

    refute_nil solution
    assert_equal 2, solution[:components].length
    assert_equal :face, solution[:primary][:kind]
    assert_equal [0.0, 2000.0, 0.0], solution[:anchor_mm], 'back on the wall AND base on the floor'
    assert_equal 'Encajar a pared · Piso', solution[:label]
  end

  # A wall and a rotated neighbor's side at the SAME yaw compose into a
  # corner at an arbitrary angle (back to the wall, side to the neighbor).
  def test_wall_and_rotated_side_compose_at_the_same_arbitrary_yaw
    yaw = 30.0
    front = dir_at_yaw(yaw)
    right = [front[1], -front[0], 0.0]
    target = rotated_target(id: 'fi-R', label: 'R', yaw_degrees: yaw,
                            size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    # Hover near the corner: 40mm off the target's right side plane AND
    # 100mm off a wall parallel to the run (both constraints in frame).
    cursor = add(scale(right, 640.0), scale(front, 100.0))
    wall_point = scale(front, -100.0) # wall behind the new furniture's back
    solution = solve(cursor_mm: cursor, eye_mm: add(cursor, scale(front, 8000.0)),
                     faces: [{ point_mm: wall_point, normal_mm: front }],
                     managed_targets: [target])

    refute_nil solution
    kinds = solution[:components].map { |component| component[:kind] }.sort
    assert_equal %i[face furniture_side], kinds, 'wall + rotated side compose at 30°'
    assert_in_epsilon 600.0, Engine.dot3(solution[:anchor_mm], right), 1e-9, 'side constraint held'
    assert_in_epsilon(-100.0, Engine.dot3(solution[:anchor_mm], front), 1e-9,
                      'back face lands exactly on the rotated wall plane')
  end

  # Orientation-conflicting constraints on different slots: the globally
  # best one wins and the conflicting one is dropped, never averaged. The
  # winner here is fixed by the stable total order (equal displacement and
  # type → key), which puts the +Y-room wall first.
  def test_orientation_conflict_drops_the_weaker_constraint
    solution = solve(cursor_mm: [100.0, 100.0, 0.0], eye_mm: [5000.0, 5000.0, 900.0],
                     faces: [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [1.0, 0.0, 0.0] },
                             { point_mm: [0.0, 0.0, 0.0], normal_mm: [0.0, -1.0, 0.0] }])

    refute_nil solution
    assert_equal 1, solution[:components].length, 'front +X conflicts with front +Y: one must go'
    assert_in_delta 0.0, solution[:front_dir_mm][0], 1e-9
    assert_in_epsilon 1.0, solution[:front_dir_mm][1], 1e-9
  end

  # ---- exact gap ---------------------------------------------------------

  def test_apply_gap_moves_the_anchor_exactly_along_the_primary_normal
    target = axis_aligned_target(id: 'fi-B03', label: 'B03')
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

  # The engine only ever produces anchor + orientation vectors; the box
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

  # The proposed front is always a HORIZONTAL UNIT vector (the tool builds
  # a rigid orthonormal basis from it): pinned at a non-quarter angle.
  def test_proposed_front_is_always_a_horizontal_unit_vector
    normal = dir_at_yaw(23.0)
    plane_point = [400.0, 200.0, 0.0]
    cursor = add(plane_point, scale(normal, 40.0))
    solution = solve(cursor_mm: cursor, eye_mm: add(cursor, scale(normal, 2000.0)),
                     faces: [{ point_mm: plane_point, normal_mm: normal }])
    refute_nil solution

    front = solution[:front_dir_mm]
    assert_in_delta 0.0, front[2], 1e-9, 'horizontal'
    assert_in_epsilon 1.0, Math.sqrt((front[0]**2) + (front[1]**2)), 1e-9, 'unit'
  end

  # P2 (review): the candidate tangent is REALLY tangent to the constraint
  # plane — for walls dot(normal, tangent) = 0 (never the front/normal
  # itself); for furniture sides it is parallel to the target front (the
  # run direction); floors carry no tangent.
  def test_candidate_tangent_is_tangent_to_the_constraint_plane
    wall_normal = dir_at_yaw(30.0)
    plane_point = [0.0, 0.0, 0.0]
    wall_cursor = add(plane_point, scale(wall_normal, 40.0))
    wall_solution = solve(cursor_mm: wall_cursor,
                          eye_mm: add(wall_cursor, scale(wall_normal, 9000.0)),
                          faces: [{ point_mm: plane_point, normal_mm: wall_normal }])
    refute_nil wall_solution
    wall = wall_solution[:components].find { |component| component[:kind] == :face }
    refute_nil wall
    assert_in_delta 0.0, Engine.dot3(wall[:normal_mm], wall[:tangent_mm]), 1e-9,
                    'wall tangent ⟂ wall normal'
    assert_in_delta 0.0, wall[:tangent_mm][2], 1e-9, 'wall tangent is horizontal'

    target = rotated_target(id: 'fi-T30', label: 'T30', yaw_degrees: 30.0,
                            size: [600.0, 560.0, 720.0], at: [0.0, 0.0, 0.0])
    front = dir_at_yaw(30.0)
    right = [front[1], -front[0], 0.0]
    side_cursor = add(scale(right, 640.0), scale(front, 280.0))
    side_solution = solve(cursor_mm: side_cursor, managed_targets: [target])
    refute_nil side_solution
    side = side_solution[:components].find { |component| component[:kind] == :furniture_side }
    refute_nil side
    assert_in_delta 0.0, Engine.dot3(side[:normal_mm], side[:tangent_mm]), 1e-9,
                    'side tangent ⟂ side normal'
    assert Engine.parallel?(side[:tangent_mm], front), 'side tangent runs along the target front'

    floor_solution = solve(cursor_mm: [100.0, 100.0, 30.0],
                           faces: [{ point_mm: [0.0, 0.0, 0.0], normal_mm: [0.0, 0.0, 1.0] }])
    refute_nil floor_solution
    floor = floor_solution[:components].find { |component| component[:kind] == :floor }
    assert_nil floor[:tangent_mm], 'a vertical constraint has no run direction'
  end

  private

  def add(vec_a, vec_b)
    [vec_a[0] + vec_b[0], vec_a[1] + vec_b[1], vec_a[2] + vec_b[2]]
  end

  def sub3(vec_a, vec_b)
    [vec_a[0] - vec_b[0], vec_a[1] - vec_b[1], vec_a[2] - vec_b[2]]
  end

  def scale(vector, factor)
    [vector[0] * factor, vector[1] * factor, vector[2] * factor]
  end

  def scale3_of(vector, factor)
    scale(vector, factor)
  end

  # Axis-aligned managed target facing +Y at the origin (quarter grid).
  def axis_aligned_target(id:, label:)
    { 'furniture_instance_id' => id, 'label' => label,
      'origin_world_mm' => [0.0, 0.0, 0.0], 'front_dir_mm' => [0.0, 1.0, 0.0],
      'right_dir_mm' => [1.0, 0.0, 0.0],
      'local_min_mm' => [0.0, 0.0, 0.0], 'local_max_mm' => [600.0, 560.0, 720.0] }
  end

  # Managed target rotated by yaw around Z at a world position: an
  # ORIENTED frame — origin + unit right/front + LOCAL extents (the
  # shape the controller provider derives from the real rigid
  # transform + local definition bounds, never the world AABB).
  def rotated_target(id:, label:, yaw_degrees:, size:, at:)
    front = dir_at_yaw(yaw_degrees)
    right = [front[1], -front[0], 0.0]
    { 'furniture_instance_id' => id, 'label' => label,
      'origin_world_mm' => at, 'front_dir_mm' => front, 'right_dir_mm' => right,
      'local_min_mm' => [0.0, 0.0, 0.0], 'local_max_mm' => size }
  end
end
