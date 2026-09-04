# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../support/overlay_runtime'
require_relative '../support/overlay_fixture'

# #470: board-local face-referenced holes must project to world space
# through the canonical managed-hierarchy transforms. These tests pin the
# authority chain: the face table mirrors the backend anchor projection, the
# world pose is furniture·part composition, and NOTHING about names/roles
# participates.
class OverlayFeatureProjectorTest < Minitest::Test
  MM = 1.0 / 25.4
  Overlay = Granete::SketchUpExtension::Overlay

  def setup
    SketchupStub.reset!
  end

  def board_side_left
    OverlayFixture.native_layout.find_board('side-left-01')
  end

  # The same axes transform the native renderer applies (#415).
  def part_transform(board)
    t = board.translation
    basis = board.basis
    Geom::Transformation.axes(
      Geom::Point3d.new(t[0] * MM, t[1] * MM, t[2] * MM),
      Geom::Vector3d.new(basis['x'][0], basis['x'][1], basis['x'][2]),
      Geom::Vector3d.new(basis['y'][0], basis['y'][1], basis['y'][2]),
      Geom::Vector3d.new(basis['z'][0], basis['z'][1], basis['z'][2])
    )
  end

  def feature(face:, x_mm:, y_mm:, diameter_mm: 35, depth_mm: 12.5, type: 'hinge', provenance: {})
    Overlay::ManufacturingFeatureView.new(
      visual_id: 'op#h0', operation_id: 'op', kind: 'hole',
      host_component_instance_id: 'side-left-01',
      face: face, x_mm: x_mm, y_mm: y_mm, diameter_mm: diameter_mm,
      depth_mm: depth_mm, hole_type: type,
      provenance: { 'sourceKind' => 'manualHardwarePlacement',
                    'hardwarePlacementId' => 'hp-1' }.merge(provenance)
    )
  end

  def project(feature, board: board_side_left, furniture: Geom::Transformation.new)
    Overlay::FeatureProjector.project(feature, board: board,
                                      part_transform: part_transform(board),
                                      furniture_transform: furniture)
  end

  def assert_mm_point(world_point, expected_mm, delta: 1e-6)
    assert_in_delta expected_mm[0], world_point.x / MM, delta
    assert_in_delta expected_mm[1], world_point.y / MM, delta
    assert_in_delta expected_mm[2], world_point.z / MM, delta
  end

  def test_front_face_hole_projects_onto_face_at_mid_depth_axis
    marker = project(feature(face: 'front', x_mm: 50, y_mm: 150))

    # side-left-01: w=560 (local X→furniture −Y), t=18 (Y→+X), l=684 (Z→+Z),
    # translation [0,560,0]. Local center (50, 18, 150) → furniture
    # [0,560,0] + 50·[0,−1,0] + 18·[1,0,0] + 150·[0,0,1] = [18, 510, 150].
    assert_mm_point marker.center, [18, 510, 150]
    # Depth 12.5 into the material: local (50, 18−12.5, 150) → [5.5, 510, 150].
    assert_mm_point marker.depth_end, [5.5, 510, 150]
  end

  def test_ring_lies_on_the_face_plane_at_the_contract_radius
    marker = project(feature(face: 'front', x_mm: 50, y_mm: 150, diameter_mm: 35))

    assert_equal 24, marker.ring_points.length
    radius_mm = 17.5
    marker.ring_points.each do |point|
      # Distance to the center is the contract radius (35/2).
      dist = Math.sqrt(((point.x - marker.center.x)**2) +
                       ((point.y - marker.center.y)**2) +
                       ((point.z - marker.center.z)**2))
      assert_in_delta radius_mm * MM, dist, 1e-6
      # Ring points sit ON the front face plane (local Y = thickness →
      # furniture X = 18): never inside the material.
      assert_in_delta 18.0, point.x / MM, 1e-6
    end
  end

  def test_bigger_diameter_is_visually_bigger
    small = project(feature(face: 'front', x_mm: 50, y_mm: 150, diameter_mm: 8))
    big = project(feature(face: 'front', x_mm: 50, y_mm: 150, diameter_mm: 35))
    assert big.radius_in > small.radius_in * 3,
           'Ø35 must be visually larger than Ø8 without boolean geometry'
  end

  def test_every_contract_face_projects_on_its_own_plane
    # left: local (0, x, y) → furniture [0,560,0] + 9·[1,0,0] + 150·[0,0,1]
    marker = project(feature(face: 'left', x_mm: 9, y_mm: 150, diameter_mm: 15))
    assert_mm_point marker.center, [9, 560, 150]
    # right: local (560, 9, 150) → 560·[0,−1,0] + 9·[1,0,0] + 150·[0,0,1]
    marker = project(feature(face: 'right', x_mm: 9, y_mm: 150, diameter_mm: 15))
    assert_mm_point marker.center, [9, 0, 150]
    # top: local (50, 9, 684) → [0,560,0] + 50·[0,−1,0] + 9·[1,0,0] + 684·[0,0,1]
    marker = project(feature(face: 'top', x_mm: 50, y_mm: 9, diameter_mm: 15))
    assert_mm_point marker.center, [9, 510, 684]
    # bottom: local (50, 9, 0)
    marker = project(feature(face: 'bottom', x_mm: 50, y_mm: 9, diameter_mm: 15))
    assert_mm_point marker.center, [9, 510, 0]
    # back: local (50, 0, 150)
    marker = project(feature(face: 'back', x_mm: 50, y_mm: 150, diameter_mm: 15))
    assert_mm_point marker.center, [0, 510, 150]
  end

  def test_moved_furniture_overlay_follows_exactly
    furniture = Geom::Transformation.translation(
      Geom::Vector3d.new(1000 * MM, 500 * MM, 250 * MM)
    )
    marker = project(feature(face: 'front', x_mm: 50, y_mm: 150), furniture: furniture)
    assert_mm_point marker.center, [1018, 1010, 400]
  end

  def test_rotated_furniture_overlay_rotates_with_the_piece
    # 90° about world Z: local images rotate, the hole stays on its face.
    furniture = Geom::Transformation.axes(
      Geom::Point3d.new(0, 0, 0),
      Geom::Vector3d.new(0, 1, 0),   # X → +Y
      Geom::Vector3d.new(-1, 0, 0),  # Y → −X
      Geom::Vector3d.new(0, 0, 1)
    )
    marker = project(feature(face: 'front', x_mm: 50, y_mm: 150), furniture: furniture)
    # Unrotated furniture-frame center [18, 510, 150] → rotate 90° Z:
    # (x, y) → (−y, x) ⇒ [−510, 18, 150].
    assert_mm_point marker.center, [-510, 18, 150]
    # The depth axis follows the rotated face normal (was −X, now −Y).
    assert_mm_point marker.depth_end, [-510, 5.5, 150]
  end

  def test_nested_transforms_compose_as_furniture_times_part
    furniture = Geom::Transformation.translation(Geom::Vector3d.new(100 * MM, 200 * MM, 0))
    board = board_side_left
    world = furniture * part_transform(board)
    manual = world.transform(Overlay::FeatureProjector.mm_to_inches([50, 18, 150]))
    marker = project(feature(face: 'front', x_mm: 50, y_mm: 150), furniture: furniture)
    assert_in_delta manual.x, marker.center.x, 1e-9
    assert_in_delta manual.y, marker.center.y, 1e-9
    assert_in_delta manual.z, marker.center.z, 1e-9
  end

  def test_unknown_face_renders_nothing_never_a_guess
    assert_nil project(feature(face: 'diagonal', x_mm: 1, y_mm: 1))
  end

  # Negative proof (#470 §1): geometry comes from the CONTRACT fields only.
  # A hole whose type/name suggests huge hardware still draws its CONTRACT
  # diameter/position — Ruby never derives geometry from hardware identity.
  def test_projection_ignores_hole_type_semantics
    hinge_like = project(feature(face: 'front', x_mm: 50, y_mm: 150, diameter_mm: 8, type: 'hinge'))
    dowel_like = project(feature(face: 'front', x_mm: 50, y_mm: 150, diameter_mm: 8, type: 'dowel'))
    assert_in_delta hinge_like.center.x, dowel_like.center.x, 1e-12
    assert_in_delta hinge_like.radius_in, dowel_like.radius_in, 1e-12
  end
end
