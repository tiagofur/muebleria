# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'

class MountFrameTest < Minitest::Test
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  BasisData = MountFrame::BasisData
  MountFrameData = MountFrame::MountFrameData
  AssetNormalizationData = MountFrame::AssetNormalizationData

  def test_basis_validation_accepts_valid_orthonormal_right_handed_basis
    basis = BasisData.new(
      x: [1.0, 0.0, 0.0],
      y: [0.0, 1.0, 0.0],
      z: [0.0, 0.0, 1.0]
    )
    assert MountFrame.validate_basis!(basis)
  end

  def test_basis_validation_rejects_non_unit_vector
    basis = BasisData.new(
      x: [2.0, 0.0, 0.0],
      y: [0.0, 1.0, 0.0],
      z: [0.0, 0.0, 1.0]
    )
    err = assert_raises(ArgumentError) { MountFrame.validate_basis!(basis) }
    assert_includes err.message, 'must be a unit vector'
  end

  def test_basis_validation_rejects_non_orthogonal_vectors
    basis = BasisData.new(
      x: [1.0, 0.0, 0.0],
      y: [0.707106, 0.707106, 0.0],
      z: [0.0, 0.0, 1.0]
    )
    err = assert_raises(ArgumentError) { MountFrame.validate_basis!(basis) }
    assert_includes err.message, 'mutually orthogonal'
  end

  def test_basis_validation_rejects_mirror_reflection_det_minus_one
    # Left-handed coordinate system (reflected Z): det = -1
    basis = BasisData.new(
      x: [1.0, 0.0, 0.0],
      y: [0.0, 1.0, 0.0],
      z: [0.0, 0.0, -1.0]
    )
    err = assert_raises(ArgumentError) { MountFrame.validate_basis!(basis) }
    assert_includes err.message, 'mirror is rejected'
  end

  def test_basis_validation_rejects_nan_and_infinite_coordinates
    basis = BasisData.new(
      x: [Float::NAN, 0.0, 0.0],
      y: [0.0, 1.0, 0.0],
      z: [0.0, 0.0, 1.0]
    )
    err = assert_raises(ArgumentError) { MountFrame.validate_basis!(basis) }
    assert_includes err.message, 'finite and bounded'
  end

  def test_derive_normalization_rigid_transform_and_anchor_mapping
    # MountFrame located at [100, 50, 20] with 90-degree rotated axes
    # X_mount = [0, 1, 0]
    # Y_mount = [-1, 0, 0]
    # Z_mount = [0, 0, 1]
    mf = MountFrameData.new(
      origin_mm: [100.0, 50.0, 20.0],
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],
        y: [-1.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    norm = MountFrame.derive_normalization(mf)
    assert_instance_of AssetNormalizationData, norm

    # Verify origin maps to canonical (0, 0, 0)
    p_canon = norm.apply(mf.origin_mm)
    assert_in_delta 0.0, p_canon[0], 1e-4
    assert_in_delta 0.0, p_canon[1], 1e-4
    assert_in_delta 0.0, p_canon[2], 1e-4

    # Verify X_mount maps to canonical +X [1, 0, 0]
    v_x = norm.apply_vector(mf.basis.x)
    assert_in_delta 1.0, v_x[0], 1e-4
    assert_in_delta 0.0, v_x[1], 1e-4
    assert_in_delta 0.0, v_x[2], 1e-4

    # Verify Y_mount maps to canonical +Y [0, 1, 0]
    v_y = norm.apply_vector(mf.basis.y)
    assert_in_delta 0.0, v_y[0], 1e-4
    assert_in_delta 1.0, v_y[1], 1e-4
    assert_in_delta 0.0, v_y[2], 1e-4

    # Verify Z_mount maps to canonical +Z [0, 0, 1]
    v_z = norm.apply_vector(mf.basis.z)
    assert_in_delta 0.0, v_z[0], 1e-4
    assert_in_delta 0.0, v_z[1], 1e-4
    assert_in_delta 1.0, v_z[2], 1e-4
  end

  def test_normalization_preserves_distances
    mf = MountFrameData.new(
      origin_mm: [15.2, -43.8, 12.0],
      basis: BasisData.new(
        x: [0.6, 0.8, 0.0],
        y: [-0.8, 0.6, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )
    norm = MountFrame.derive_normalization(mf)

    pt_a = [10.0, 20.0, 30.0]
    pt_b = [70.0, -15.0, 45.0]

    assert norm.distance_preserved?(pt_a, pt_b)

    dist_orig = MountFrame.distance(pt_a, pt_b)
    dist_norm = MountFrame.distance(norm.apply(pt_a), norm.apply(pt_b))
    assert_in_delta dist_orig, dist_norm, 1e-4
  end

  def test_sketchup_transformation_scales_translation_to_inches_without_scaling_axes
    mf = MountFrameData.new(
      origin_mm: [25.4, 50.8, 76.2], # 1 inch, 2 inches, 3 inches
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )
    norm = MountFrame.derive_normalization(mf)
    t = norm.to_sketchup_transformation
    refute_nil t

    # In SketchUp, translation is in inches:
    # Origin in canonical frame was -Origin_mm = [-25.4, -50.8, -76.2]
    # In inches: [-1.0, -2.0, -3.0]
    orig = t.origin
    assert_in_delta(-1.0, orig.x, 1e-4)
    assert_in_delta(-2.0, orig.y, 1e-4)
    assert_in_delta(-3.0, orig.z, 1e-4)

    # Axes remain pure unit vectors (no scale)
    assert_in_delta 1.0, t.xaxis.x, 1e-4
    assert_in_delta 0.0, t.xaxis.y, 1e-4
    assert_in_delta 0.0, t.xaxis.z, 1e-4
  end

  def test_build_handle_mount_frame_from_explicit_mounting_points
    # 96mm handle fixture with explicit hole coordinates
    hole_a = [-48.0, 15.0, 0.0]
    hole_b = [48.0, 15.0, 0.0]

    mf = MountFrame.build_handle_mount_frame(
      hole_a_mm: hole_a,
      hole_b_mm: hole_b,
      surface_normal_z: [0.0, 0.0, 1.0],
      expected_hole_spacing_mm: 96.0,
      tolerance_mm: 1.0
    )

    # Origin is exact midpoint between holes: [0, 15, 0]
    assert_in_delta 0.0, mf.origin_mm[0], 1e-4
    assert_in_delta 15.0, mf.origin_mm[1], 1e-4
    assert_in_delta 0.0, mf.origin_mm[2], 1e-4

    # X axis points from A to B: [1, 0, 0]
    assert_in_delta 1.0, mf.basis.x[0], 1e-4
    assert_in_delta 0.0, mf.basis.x[1], 1e-4
    assert_in_delta 0.0, mf.basis.x[2], 1e-4

    # Z axis is normal [0, 0, 1]
    assert_in_delta 0.0, mf.basis.z[0], 1e-4
    assert_in_delta 0.0, mf.basis.z[1], 1e-4
    assert_in_delta 1.0, mf.basis.z[2], 1e-4

    # Y axis is Z x X = [0, 1, 0]
    assert_in_delta 0.0, mf.basis.y[0], 1e-4
    assert_in_delta 1.0, mf.basis.y[1], 1e-4
    assert_in_delta 0.0, mf.basis.y[2], 1e-4
  end

  def test_build_handle_mount_frame_rejects_spacing_discrepancy_beyond_tolerance
    hole_a = [-48.0, 0.0, 0.0]
    hole_b = [48.0, 0.0, 0.0] # actual 96mm

    err = assert_raises(ArgumentError) do
      MountFrame.build_handle_mount_frame(
        hole_a_mm: hole_a,
        hole_b_mm: hole_b,
        expected_hole_spacing_mm: 128.0, # expected 128mm
        tolerance_mm: 2.0
      )
    end
    assert_includes err.message, 'differs from nominal 128.0mm'
  end

  def test_compare_nominal_vs_measured_with_configurable_tolerance
    # Within tolerance: returns nil
    assert_nil MountFrame.compare_nominal_vs_measured(
      nominal: 96.0, measured: 96.8, tolerance_mm: 1.0, dimension_name: 'holeSpacing'
    )

    # Exceeds tolerance: returns discrepancy
    disc = MountFrame.compare_nominal_vs_measured(
      nominal: 96.0, measured: 98.5, tolerance_mm: 1.0, dimension_name: 'holeSpacing'
    )
    refute_nil disc
    assert_equal 'holeSpacing', disc['dimension']
    assert_in_delta 96.0, disc['nominal_mm'], 1e-4
    assert_in_delta 98.5, disc['measured_mm'], 1e-4
    assert_in_delta 2.5, disc['delta_mm'], 1e-4
  end

  def test_source_units_does_not_rescale_component_definition_geometry
    # SKP files loaded into SketchUp are already interpreted in host units.
    # sourceUnits describes file authoring metadata, but normalization and placement
    # must NEVER apply a scale transform to the loaded ComponentDefinition.
    mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )
    norm = MountFrame.derive_normalization(mf)
    t = norm.to_sketchup_transformation

    # Scaling along each axis must be exactly 1.0 (pure rigid rotation + translation)
    scale_x = Math.sqrt((t.xaxis.x**2) + (t.xaxis.y**2) + (t.xaxis.z**2))
    scale_y = Math.sqrt((t.yaxis.x**2) + (t.yaxis.y**2) + (t.yaxis.z**2))
    scale_z = Math.sqrt((t.zaxis.x**2) + (t.zaxis.y**2) + (t.zaxis.z**2))

    assert_in_delta 1.0, scale_x, 1e-6
    assert_in_delta 1.0, scale_y, 1e-6
    assert_in_delta 1.0, scale_z, 1e-6
  end
end
