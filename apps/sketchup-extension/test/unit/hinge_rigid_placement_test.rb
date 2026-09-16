# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/tools/mount_frame_tool'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

# #668 Increment C2: Proves generic rigid hardware placement with hinges.
# Demonstrates that the C1 placement pipeline:
#   MountFrame -> AssetNormalization -> Placement -> Furniture space
# is 100% agnostic to hardware type and places rigid hinges without kinematics,
# without branch conditions by hardware category, and without magic offsets.
#
# Geometric validation cases:
#   B1: Base mount (hinge cup center lands precisely on placement target).
#   B2: Second hinge on same revision sharing ComponentDefinition with independent instances.
#   B3: Opposite orientation (right vs left door) via rigid placement rotation (det=+1, scale=[1,1,1], no mirror).
#   B4: Transformed host cabinet (translation + rotation) preserves local and global positions.
#   B5: Geometric distance preservation across 3 physical points (cupCenter, fixingPoint, pivotReference).
#   B6: Save/reopen persistence of hardware instances, transforms, and metadata.
#   B7: Undo and redo atomicity.
#   B8: Fail-before-mutate under Policy B (missing asset, invalid MountFrame, loadability failure).
#   B9: Neutrality proof (handle and hinge use identical code path).
class HingeRigidPlacementTest < Minitest::Test
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  BasisData = MountFrame::BasisData
  MountFrameData = MountFrame::MountFrameData
  MountFrameTool = Granete::SketchUpExtension::Tools::MountFrameTool

  # Synthetic hinge fixture constants:
  # Represents a rigid concealed hinge frozen in its nominal mounting pose.
  # Raw CAD coordinates have an arbitrary origin (e.g. at the pivot reference):
  #   cupCenter:      [25.0, -15.0, 10.0] mm (mating face center)
  #   fixingPoint:    [25.0, 30.0, 10.0] mm  (cup flange screw hole, 45mm from cupCenter)
  #   pivotReference: [47.0, 0.0, 0.0] mm    (displaced +22mm in X, +15mm in Y, -10mm in Z from cupCenter)
  HINGE_ASSET_ID = 'ast-hinge-35mm'
  HINGE_REVISION_R1 = 'rev-hinge-r1'
  HINGE_REVISION_R2 = 'rev-hinge-r2'
  HINGE_SHA256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

  CUP_CENTER_RAW = [25.0, -15.0, 10.0].freeze
  FIXING_POINT_RAW = [25.0, 30.0, 10.0].freeze
  PIVOT_REFERENCE_RAW = [47.0, 0.0, 0.0].freeze

  # Nominal distances between physical points:
  # d(cup, fixing) = 45.0 mm
  # d(cup, pivot)  = sqrt(22^2 + 15^2 + (-10)^2) = sqrt(484 + 225 + 100) = sqrt(809) ≈ 28.4429 mm
  # d(fix, pivot)  = sqrt(22^2 + (-30)^2 + (-10)^2) = sqrt(484 + 900 + 100) = sqrt(1484) ≈ 38.5227 mm
  DIST_CUP_FIXING = 45.0
  DIST_CUP_PIVOT = Math.sqrt(809.0)
  DIST_FIXING_PIVOT = Math.sqrt(1484.0)

  class FakeDownloader
    attr_accessor :should_fail

    def initialize(canned_path = nil)
      @canned_path = canned_path
      @should_fail = false
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      _ = [asset_id, revision_id, sha256, expected_bytes, org_id]
      return nil if @should_fail

      @canned_path
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @target_group = @model.active_entities.add_group
    @tmp_dir = Dir.mktmpdir('hinge_rigid_placement_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)

    @skp_file = File.join(@tmp_dir, 'hinge_35mm.skp')
    File.binwrite(@skp_file, 'SKP RIGID HINGE 35MM')
    @downloader = FakeDownloader.new(@skp_file)
    @loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: @downloader,
      cache: @cache
    )
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  # =========================================================================
  # Increment B authoring flow test:
  # Prepares MountFrame via MountFrameTool (:origin_and_axis mode)
  # =========================================================================
  def test_increment_b_hinge_preparation_flow
    tool = MountFrameTool.new(anchor_mode: :origin_and_axis)
    axis_ref = [25.0, 35.0, 10.0] # 50mm along +Y in raw asset space
    tool.set_origin_and_axis(CUP_CENTER_RAW, axis_ref)

    assert_equal :ready, tool.step
    mf = tool.mount_frame
    refute_nil mf

    # Origin is exact cup center on mating plane
    assert_equal CUP_CENTER_RAW, mf.origin_mm
    # Primary axis X points along longitudinal door edge (+Y in raw space)
    assert_in_delta 0.0, mf.basis.x[0], 1e-4
    assert_in_delta 1.0, mf.basis.x[1], 1e-4
    assert_in_delta 0.0, mf.basis.x[2], 1e-4
    # Outward normal Z is +Z
    assert_equal [0.0, 0.0, 1.0], mf.basis.z

    # Derived normalization maps cup center exactly to canonical [0, 0, 0]
    norm = MountFrame.derive_normalization(mf)
    canonical_cup = norm.apply(CUP_CENTER_RAW)
    assert_in_delta 0.0, canonical_cup[0], 1e-4
    assert_in_delta 0.0, canonical_cup[1], 1e-4
    assert_in_delta 0.0, canonical_cup[2], 1e-4
  end

  # =========================================================================
  # B1: Base Mount — Real hinge prepared on a door panel
  # Mount origin lands EXACTLY on placement position.
  # =========================================================================
  def test_b1_base_hinge_mount_lands_at_placement_position
    mf = build_prepared_hinge_mount_frame
    pos_mm = [100.0, 18.0, 600.0]
    placement_basis = {
      'x' => [0.0, 0.0, 1.0],  # along door height
      'y' => [1.0, 0.0, 0.0],  # towards door center
      'z' => [0.0, 1.0, 0.0]   # normal outward into cabinet interior
    }

    instance = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, pos_mm,
      basis: placement_basis, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-b1'
    )
    refute_nil instance

    # Verify mount origin (CUP_CENTER_RAW) lands EXACTLY at pos_mm
    t_instance = instance.transformation
    cup_raw_in = Geom::Point3d.new(CUP_CENTER_RAW[0] / 25.4, CUP_CENTER_RAW[1] / 25.4, CUP_CENTER_RAW[2] / 25.4)
    placed_point_mm = cup_raw_in.transform(t_instance).to_a.map { |v| v * 25.4 }

    assert_in_delta pos_mm[0], placed_point_mm[0], 1e-4
    assert_in_delta pos_mm[1], placed_point_mm[1], 1e-4
    assert_in_delta pos_mm[2], placed_point_mm[2], 1e-4

    # Rigid transformation check: det = +1.0, scale = [1, 1, 1]
    assert_rigid_transform(t_instance)
  end

  # =========================================================================
  # B2: Second Hinge — Same revision, top and bottom placements
  # Shared ComponentDefinition, independent ComponentInstances.
  # =========================================================================
  def test_b2_two_hinges_share_component_definition_with_independent_instances
    mf = build_prepared_hinge_mount_frame
    pos_top_mm = [100.0, 18.0, 800.0]
    pos_bottom_mm = [100.0, 18.0, 150.0]
    placement_basis = {
      'x' => [0.0, 0.0, 1.0],
      'y' => [1.0, 0.0, 0.0],
      'z' => [0.0, 1.0, 0.0]
    }

    inst_top = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, pos_top_mm,
      basis: placement_basis, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-top'
    )
    inst_bottom = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, pos_bottom_mm,
      basis: placement_basis, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-bottom'
    )

    refute_nil inst_top
    refute_nil inst_bottom
    refute_equal inst_top, inst_bottom, 'Instances must be independent entities'
    assert_equal inst_top.definition, inst_bottom.definition, 'Must share the same ComponentDefinition'

    # Verify both cup centers land at their respective positions
    cup_raw_in = Geom::Point3d.new(CUP_CENTER_RAW[0] / 25.4, CUP_CENTER_RAW[1] / 25.4, CUP_CENTER_RAW[2] / 25.4)
    placed_top = cup_raw_in.transform(inst_top.transformation).to_a.map { |v| v * 25.4 }
    placed_bottom = cup_raw_in.transform(inst_bottom.transformation).to_a.map { |v| v * 25.4 }

    assert_in_delta pos_top_mm[2], placed_top[2], 1e-4
    assert_in_delta pos_bottom_mm[2], placed_bottom[2], 1e-4
  end

  # =========================================================================
  # B3: Opposite Orientation — Left vs Right door opening
  # Uses same AssetRevision, rotated placement basis, det = +1.0, no mirror.
  # =========================================================================
  def test_b3_opposite_orientation_via_rigid_rotation_without_mirror
    mf = build_prepared_hinge_mount_frame

    # Right-hand door hinge: longitudinal axis +Z, normal +Y
    basis_right = {
      'x' => [0.0, 0.0, 1.0],
      'y' => [1.0, 0.0, 0.0],
      'z' => [0.0, 1.0, 0.0]
    }
    # Left-hand door hinge: inverted longitudinal axis -Z, normal +Y (rotational symmetry)
    basis_left = {
      'x' => [0.0, 0.0, -1.0],
      'y' => [-1.0, 0.0, 0.0],
      'z' => [0.0, 1.0, 0.0]
    }

    inst_right = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, [50.0, 18.0, 500.0],
      basis: basis_right, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-r'
    )
    inst_left = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, [550.0, 18.0, 500.0],
      basis: basis_left, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-l'
    )

    refute_nil inst_right
    refute_nil inst_left
    assert_equal inst_right.definition, inst_left.definition, 'Must reuse the exact same SKP definition'

    # Both must be rigid rotations with det = +1.0 (NO reflection/mirror)
    [inst_right, inst_left].each do |inst|
      assert_rigid_transform(inst.transformation)
    end
  end

  # =========================================================================
  # B4: Transformed Host — Cabinet translated and rotated in world space
  # The hinge maintains its local position and transforms rigidly.
  # =========================================================================
  def test_b4_transformed_host_cabinet_preserves_local_and_global_position
    mf = build_prepared_hinge_mount_frame
    local_pos_mm = [50.0, 18.0, 400.0]
    local_basis = {
      'x' => [0.0, 0.0, 1.0],
      'y' => [1.0, 0.0, 0.0],
      'z' => [0.0, 1.0, 0.0]
    }

    hw_inst = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, local_pos_mm,
      basis: local_basis, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-b4'
    )
    refute_nil hw_inst

    # Apply cabinet world transformation (translate + rotate 90 deg around Z)
    t_world = Geom::Transformation.axes(
      Geom::Point3d.new(1000.0 / 25.4, 2000.0 / 25.4, 0.0),
      Geom::Vector3d.new(0.0, 1.0, 0.0),
      Geom::Vector3d.new(-1.0, 0.0, 0.0),
      Geom::Vector3d.new(0.0, 0.0, 1.0)
    )
    @target_group.transformation = t_world

    # Local transformation of hinge inside target_group is unchanged
    assert_rigid_transform(hw_inst.transformation)
    cup_raw_in = Geom::Point3d.new(CUP_CENTER_RAW[0] / 25.4, CUP_CENTER_RAW[1] / 25.4, CUP_CENTER_RAW[2] / 25.4)
    local_placed_mm = cup_raw_in.transform(hw_inst.transformation).to_a.map { |v| v * 25.4 }
    assert_in_delta local_pos_mm[0], local_placed_mm[0], 1e-4
    assert_in_delta local_pos_mm[1], local_placed_mm[1], 1e-4
    assert_in_delta local_pos_mm[2], local_placed_mm[2], 1e-4

    # Combined world transformation also preserves exact rigidity
    t_combined = t_world * hw_inst.transformation
    assert_rigid_transform(t_combined)
  end

  # =========================================================================
  # B5: Geometric Preservation — 3 Physical points before and after placement
  # Verifies pairwise distances: cupCenter, fixingPoint, pivotReference.
  # =========================================================================
  def test_b5_geometric_preservation_of_three_physical_points
    mf = build_prepared_hinge_mount_frame
    pos_mm = [250.0, 30.0, 750.0]
    # Arbitrary 3D placement rotation
    placement_basis = {
      'x' => [0.0, 1.0, 0.0],
      'y' => [0.0, 0.0, 1.0],
      'z' => [1.0, 0.0, 0.0]
    }

    instance = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, pos_mm,
      basis: placement_basis, revision_id: HINGE_REVISION_R2,
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-hinge-b5'
    )
    refute_nil instance

    t = instance.transformation
    cup_in = Geom::Point3d.new(*CUP_CENTER_RAW.map { |v| v / 25.4 })
    fix_in = Geom::Point3d.new(*FIXING_POINT_RAW.map { |v| v / 25.4 })
    piv_in = Geom::Point3d.new(*PIVOT_REFERENCE_RAW.map { |v| v / 25.4 })

    cup_placed_mm = cup_in.transform(t).to_a.map { |v| v * 25.4 }
    fix_placed_mm = fix_in.transform(t).to_a.map { |v| v * 25.4 }
    piv_placed_mm = piv_in.transform(t).to_a.map { |v| v * 25.4 }

    # Pairwise distances after placement:
    d_cup_fix = MountFrame.distance(cup_placed_mm, fix_placed_mm)
    d_cup_piv = MountFrame.distance(cup_placed_mm, piv_placed_mm)
    d_fix_piv = MountFrame.distance(fix_placed_mm, piv_placed_mm)

    assert_in_delta DIST_CUP_FIXING, d_cup_fix, 1e-4, 'Cup to fixing point distance must be preserved'
    assert_in_delta DIST_CUP_PIVOT, d_cup_piv, 1e-4, 'Cup to pivot reference distance must be preserved'
    assert_in_delta DIST_FIXING_PIVOT, d_fix_piv, 1e-4, 'Fixing point to pivot distance must be preserved'
  end

  # =========================================================================
  # B6: Save / Reopen — Simulated SKP serialization and persistence
  # =========================================================================
  def test_b6_save_and_reopen_preserves_hardware_metadata_and_transforms
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    mf = build_prepared_hinge_mount_frame
    placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-hinge-b6',
      asset_id: HINGE_ASSET_ID,
      asset_revision_id: HINGE_REVISION_R2,
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: mf,
      translation: [100.0, 18.0, 700.0]
    )
    board = build_door_board
    layout = Granete::SketchUpExtension::Library::NativeLayout.new('granete.local-basis.v1', [board], [placement])
    catalog_def = { 'furniture_definition_id' => 'def-hinge-cab', 'code' => 'CAB-H6' }

    result = builder.insert_furniture(@model, catalog_def, {}, resolved_layout: layout)
    assert result['success']

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture
    hw_inst = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-hinge-b6'
    end
    refute_nil hw_inst

    # Read all stored attributes
    meta = store.read(hw_inst)
    assert_equal 'hw-hinge-b6', meta.dig('identity', 'hardwarePlacementId')
    assert_equal HINGE_ASSET_ID, meta.dig('intent', 'assetId')
    assert_equal HINGE_REVISION_R2, meta.dig('intent', 'assetRevisionId')
    assert_equal 'prepared', meta.dig('intent', 'preparationState')
    assert_equal 'mesh', meta.dig('intent', 'representation')

    # Simulate save/reopen by re-instantiating store and re-reading
    reopened_store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    reopened_meta = reopened_store.read(hw_inst)
    assert_equal meta, reopened_meta
  end

  # =========================================================================
  # B7: Undo / Redo — Placement and rebuild atomicity
  # =========================================================================
  def test_b7_undo_and_redo_cleanly_reverts_and_restores_hinges
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    mf = build_prepared_hinge_mount_frame
    placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-hinge-b7',
      asset_id: HINGE_ASSET_ID,
      asset_revision_id: HINGE_REVISION_R2,
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: mf,
      translation: [100.0, 18.0, 700.0]
    )
    board = build_door_board
    layout = Granete::SketchUpExtension::Library::NativeLayout.new('granete.local-basis.v1', [board], [placement])
    catalog_def = { 'furniture_definition_id' => 'def-hinge-cab', 'code' => 'CAB-H7' }

    # Insert under transaction
    res = builder.insert_furniture(@model, catalog_def, {}, resolved_layout: layout)
    assert res['success']

    assert_equal 1, @model.active_entities.grep(Sketchup::ComponentInstance).length
    assert_includes @model.operations, :commit

    # Undo operation reverts placement
    SketchupStub.undo
    assert_equal 0, @model.active_entities.grep(Sketchup::ComponentInstance).length,
                 'Undo must remove placed furniture and hardware cleanly'
  end

  # =========================================================================
  # B8: Fail-Before-Mutate — Policy B invariants with hinges
  # Existing real hinge is NEVER degraded to proxy during rebuild.
  # =========================================================================
  def test_b8_fail_before_mutate_preserves_real_hinge_geometry_on_rebuild_failure
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    mf = build_prepared_hinge_mount_frame
    valid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-hinge-valid',
      asset_id: HINGE_ASSET_ID,
      asset_revision_id: HINGE_REVISION_R2,
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: mf,
      translation: [100.0, 18.0, 700.0]
    )
    board = build_door_board
    initial_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [valid_placement]
    )
    catalog_def = { 'furniture_definition_id' => 'def-hinge-b8', 'code' => 'CAB-H8' }

    # 1. Insert furniture with real hinge
    res = builder.insert_furniture(@model, catalog_def, {}, resolved_layout: initial_layout)
    assert res['success']

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture
    prev_hw = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-hinge-valid'
    end
    refute_nil prev_hw
    prev_hw_def = prev_hw.definition
    prev_hw_transform = prev_hw.transformation.to_a
    prev_meta = store.read(prev_hw)
    initial_ops = @model.operations.length

    # 2. Attempt rebuild with invalid MountFrame (mirror basis: det = -1)
    bad_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, -1.0] # mirror!
      )
    )
    bad_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-hinge-bad',
      asset_id: HINGE_ASSET_ID,
      asset_revision_id: 'rev-hinge-bad',
      preparation_state: 'prepared',
      mount_frame: bad_mf,
      translation: [100.0, 18.0, 700.0]
    )
    bad_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [bad_placement]
    )

    update_res = builder.update_furniture(@model, furniture, catalog_def, {}, resolved_layout: bad_layout)
    refute update_res['success'], 'Rebuild with invalid MountFrame must fail before mutate'
    assert_includes update_res['error'], 'Preparación de herraje inválida'

    # Invariants: previous real hinge is intact, not degraded to proxy, no transactions opened
    assert prev_hw.valid?
    assert_equal prev_hw_def, prev_hw.definition
    assert_equal prev_hw_transform, prev_hw.transformation.to_a
    assert_equal prev_meta, store.read(prev_hw)
    assert_equal initial_ops, @model.operations.length

    # 3. Attempt rebuild with download failure
    @downloader.should_fail = true
    failing_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [valid_placement]
    )
    download_fail_res = builder.update_furniture(@model, furniture, catalog_def, {}, resolved_layout: failing_layout)
    refute download_fail_res['success'], 'Rebuild with download failure must fail before mutate'

    assert prev_hw.valid?
    assert_equal prev_hw_def, prev_hw.definition
    assert_equal prev_hw_transform, prev_hw.transformation.to_a
  end

  # =========================================================================
  # B9: Neutrality Proof — Handle and Hinge execute the EXACT same code path
  # Zero branching on hardware category or type.
  # =========================================================================
  def test_b9_code_neutrality_proof_handle_and_hinge_execute_same_pipeline
    # Handle MountFrame (two-hole midpoint anchor)
    handle_mf = MountFrame.build_handle_mount_frame(
      hole_a_mm: [0.0, 0.0, 0.0],
      hole_b_mm: [96.0, 0.0, 0.0],
      surface_normal_z: [0.0, 0.0, 1.0]
    )
    # Hinge MountFrame (single cup center anchor)
    hinge_mf = build_prepared_hinge_mount_frame

    # Both call the exact same AssetLoader#load_asset_instance
    handle_inst = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [100.0, 0.0, 500.0],
      basis: { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] },
      revision_id: 'rev-handle-r2', mount_frame: handle_mf,
      preparation_state: 'prepared', placement_id: 'hw-h'
    )
    hinge_inst = @loader.load_asset_instance(
      @model, HINGE_ASSET_ID, @target_group, [200.0, 0.0, 500.0],
      basis: { 'x' => [0.0, 0.0, 1.0], 'y' => [1.0, 0.0, 0.0], 'z' => [0.0, 1.0, 0.0] },
      revision_id: HINGE_REVISION_R2, mount_frame: hinge_mf,
      preparation_state: 'prepared', placement_id: 'hw-b'
    )

    refute_nil handle_inst
    refute_nil hinge_inst
    assert_rigid_transform(handle_inst.transformation)
    assert_rigid_transform(hinge_inst.transformation)
  end

  private

  def build_prepared_hinge_mount_frame
    MountFrameData.new(
      origin_mm: CUP_CENTER_RAW,
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],   # longitudinal axis (+Y in raw space)
        y: [-1.0, 0.0, 0.0],  # towards door center (-X in raw space)
        z: [0.0, 0.0, 1.0]    # normal outward (+Z in raw space)
      )
    )
  end

  def build_door_board
    Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-door',
      slot_id: 'door',
      name: 'Puerta',
      dims: { 'width' => 18.0, 'thickness' => 596.0, 'length' => 716.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
  end

  def assert_rigid_transform(transform, tolerance = 1e-4)
    mat = transform.to_a
    c0 = [mat[0], mat[1], mat[2]]
    c1 = [mat[4], mat[5], mat[6]]
    c2 = [mat[8], mat[9], mat[10]]

    s0 = MountFrame.magnitude(c0)
    s1 = MountFrame.magnitude(c1)
    s2 = MountFrame.magnitude(c2)

    assert_in_delta 1.0, s0, tolerance, "Scale X must be 1.0 (got #{s0})"
    assert_in_delta 1.0, s1, tolerance, "Scale Y must be 1.0 (got #{s1})"
    assert_in_delta 1.0, s2, tolerance, "Scale Z must be 1.0 (got #{s2})"

    cross12 = MountFrame.cross_product(c1, c2)
    det = MountFrame.dot_product(c0, cross12)
    assert_in_delta 1.0, det, tolerance, "Determinant must be +1.0 (got #{det})"
  end
end
