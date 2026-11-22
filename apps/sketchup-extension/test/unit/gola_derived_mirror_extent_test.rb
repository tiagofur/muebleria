# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

# #1693 — the width reflection (#1575) must FOLD a derived box's local X
# extent, exactly like a board: a derived gola run spans [0,dims] on local X
# (#1689 corner convention), and mirroring it as a POINT (extent 0) anchored
# the box at the mirrored point and spanned x∈[600,1200] of a 600-wide
# cabinet — the run floating outside, one side over, that the owner's vivo
# caught. Mounted hardware keeps the point mirror (extent 0). Numbers are the
# owner's furniture (600-wide, L 8006 run [600×27.2×56.5] at its min corner;
# right support basis x=[-1,0,0]).
class GolaDerivedMirrorExtentTest < Minitest::Test
  MIRROR = Granete::SketchUpExtension::Model::LocalGeometry.method(:mirror_placement)

  def derived_placement(kind: 'derived', dims: [600.0, 27.2, 56.5],
                        translation: [0.0, 532.8, 663.5],
                        basis: { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] })
    Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'opening-profile-run', hardware_id: 'hw-run', name: 'Perfil GOLA L',
      placement_kind: kind, dimensions: dims,
      translation: translation, local_transform: { 'translation' => translation, 'basis' => basis }
    )
  end

  def mirrored_span(placement)
    mirrored = placement.with_mirrored_frame(MIRROR, 600.0)
    t = mirrored.local_translation
    box_end_x = t[0] + (mirrored_basis_x(mirrored)[0] * placement.dimensions[0])
    [t[0], box_end_x].minmax
  end

  def mirrored_basis_x(placement)
    frame = placement.instance_variable_get(:@local_transform)
    frame['basis']['x']
  end

  def test_derived_run_folds_its_extent_and_stays_inside_the_furniture
    x0, x1 = mirrored_span(derived_placement)

    assert_in_delta 0.0, x0, 1.0e-6, 'mirrored run starts at x=0 (folded extent)'
    assert_in_delta 600.0, x1, 1.0e-6, 'mirrored run ends at x=600 — inside the cabinet'
  end

  def test_derived_support_with_negative_basis_stays_inside
    support = derived_placement(dims: [17.0, 19.5, 39.5], translation: [585.0, 513.3, 672.0],
                                basis: { 'x' => [-1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] })
    x0, x1 = mirrored_span(support)

    assert_in_delta 15.0, x0, 1.0e-6, 'mirrored right support lands on the left region'
    assert_in_delta 32.0, x1, 1.0e-6, 'support box stays inside [0,600]'
  end

  def test_mounted_hardware_keeps_the_point_mirror
    mounted = derived_placement(kind: nil, dims: [160.0, 32.0, 12.0], translation: [40.0, 560.0, 360.0])
    mirrored = mounted.with_mirrored_frame(MIRROR, 600.0)

    assert_in_delta 560.0, mirrored.local_translation[0], 1.0e-6,
                    'a mount POINT mirrors as a point (600 − 40), extent stays 0'
  end

  # Review r1 P1: kit parts are 'derived' with dimensions TOO, but their
  # local frame is a FACE MOUNT POINT (localTransform ≠ the AABB transform).
  # Folding their extent would displace every kit piece of every mirrored
  # furniture — they mirror as points.
  def test_kit_part_derived_face_point_mirrors_as_a_point
    face_point = [300.0, 560.0, 400.0]
    box_min = [280.0, 555.0, 385.0] # the AABB rides separately
    kit_part = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'kit-hw-part', placement_kind: 'derived',
      dimensions: [40.0, 10.0, 30.0],
      translation: box_min,
      local_transform: { 'translation' => face_point,
                         'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } }
    )
    mirrored = kit_part.with_mirrored_frame(MIRROR, 600.0)

    assert_in_delta 300.0, mirrored.local_translation[0], 1.0e-6,
                    'the face mount point mirrors as a point (600 − 300), never folded'
  end

  def test_derived_without_dimensions_keeps_the_point_mirror
    no_dims = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'opening-x', placement_kind: 'derived',
      translation: [100.0, 0.0, 0.0],
      local_transform: { 'translation' => [100.0, 0.0, 0.0],
                         'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] } }
    )
    mirrored = no_dims.with_mirrored_frame(MIRROR, 600.0)

    assert_in_delta 500.0, mirrored.local_translation[0], 1.0e-6,
                    'no declared box → no extent to fold'
  end
end
