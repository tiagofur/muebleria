# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_downloader'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

class AssetLoaderRigidPlacementTest < Minitest::Test
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  BasisData = MountFrame::BasisData
  MountFrameData = MountFrame::MountFrameData

  class FakeDownloader
    def initialize(canned_path = nil)
      @canned_path = canned_path
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      _ = [asset_id, revision_id, sha256, expected_bytes, org_id]
      @canned_path
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @target_group = @model.active_entities.add_group
    @tmp_dir = Dir.mktmpdir('rigid_placement_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)

    @skp_file = File.join(@tmp_dir, 'handle_96mm.skp')
    File.binwrite(@skp_file, 'SKP RIGID 96MM')
    @downloader = FakeDownloader.new(@skp_file)
    @loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: @downloader,
      cache: @cache
    )
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  def test_composition_order_t_placement_times_t_norm
    # MountFrame with displaced origin AND 90-degree rotated basis in asset space
    mf = MountFrameData.new(
      origin_mm: [25.0, -10.0, 8.0],
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],
        y: [-1.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    pos_mm = [300.0, 400.0, 500.0]
    basis = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-1'
    )
    refute_nil instance

    # In SketchUp, instance.transformation is in inches.
    # The mount origin [25, -10, 8] mm in asset space must map EXACTLY to pos_mm [300, 400, 500] mm
    t_instance = instance.transformation
    mount_origin_inches = Geom::Point3d.new(25.0 / 25.4, -10.0 / 25.4, 8.0 / 25.4)
    placed_point = mount_origin_inches.transform(t_instance)

    assert_in_delta 300.0 / 25.4, placed_point.x, 1e-4
    assert_in_delta 400.0 / 25.4, placed_point.y, 1e-4
    assert_in_delta 500.0 / 25.4, placed_point.z, 1e-4

    # Negative test: inverted order T_norm * T_placement maps to the WRONG position
    norm = MountFrame.derive_normalization(mf)
    t_norm = norm.to_sketchup_transformation
    t_placement = Geom::Transformation.translation(
      Geom::Vector3d.new(pos_mm[0] / 25.4, pos_mm[1] / 25.4, pos_mm[2] / 25.4)
    )
    t_inverted = t_norm * t_placement
    inverted_point = mount_origin_inches.transform(t_inverted)

    refute_in_delta 300.0 / 25.4, inverted_point.x, 1.0
  end

  def test_distance_preservation_between_mounting_holes
    # Two mounting holes 96 mm apart in asset space
    hole_a_mm = [-23.0, -10.0, 8.0]
    hole_b_mm = [73.0, -10.0, 8.0]
    origin_mm = [25.0, -10.0, 8.0]
    dist_initial = MountFrame.distance(hole_a_mm, hole_b_mm)
    assert_in_delta 96.0, dist_initial, 1e-4

    mf = MountFrameData.new(
      origin_mm: origin_mm,
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    pos_mm = [120.0, 350.0, 700.0]
    # Rotate placement 90 degrees around Z
    basis = { 'x' => [0.0, 1.0, 0.0], 'y' => [-1.0, 0.0, 0.0], 'z' => [0.0, 0.0, 1.0] }

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-dist'
    )
    refute_nil instance

    t_instance = instance.transformation
    pt_a_in = Geom::Point3d.new(hole_a_mm[0] / 25.4, hole_a_mm[1] / 25.4, hole_a_mm[2] / 25.4)
    pt_b_in = Geom::Point3d.new(hole_b_mm[0] / 25.4, hole_b_mm[1] / 25.4, hole_b_mm[2] / 25.4)

    trans_a_mm = pt_a_in.transform(t_instance).to_a.map { |v| v * 25.4 }
    trans_b_mm = pt_b_in.transform(t_instance).to_a.map { |v| v * 25.4 }

    dist_mounted = MountFrame.distance(trans_a_mm, trans_b_mm)
    assert_in_delta 96.0, dist_mounted, 1e-4
  end

  def test_rigidity_invariants_det_plus_one_and_unit_scale
    mf = MountFrameData.new(
      origin_mm: [15.0, 20.0, -5.0],
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],
        y: [-1.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    basis = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 0.0, 1.0], 'z' => [0.0, -1.0, 0.0] }
    pos_mm = [200.0, 300.0, 400.0]

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-rigid'
    )
    refute_nil instance

    t = instance.transformation
    # Scale check: length of xaxis, yaxis, zaxis must be 1.0 (no scaling/shear)
    assert_in_delta 1.0, vector_mag(t.xaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t.yaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t.zaxis), 1e-4

    # Determinant check: det = X . (Y x Z) == +1.0 (no mirror/reflection)
    det = compute_det(t)
    assert_in_delta 1.0, det, 1e-4
  end

  def test_horizontal_and_vertical_placement_same_definition
    mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    # Horizontal: handle longitudinal axis (+X) points along cabinet X
    basis_h = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
    # Vertical: handle longitudinal axis (+X) points along cabinet Z
    basis_v = { 'x' => [0.0, 0.0, 1.0], 'y' => [0.0, 1.0, 0.0], 'z' => [-1.0, 0.0, 0.0] }

    inst_h = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [100.0, 0.0, 500.0],
      basis: basis_h, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-h'
    )
    inst_v = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [200.0, 0.0, 500.0],
      basis: basis_v, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-v'
    )

    refute_nil inst_h
    refute_nil inst_v
    assert_equal inst_h.definition, inst_v.definition

    # Horizontal xaxis points along [1, 0, 0]
    assert_equal [1.0, 0.0, 0.0], inst_h.transformation.xaxis.to_a
    # Vertical xaxis points along [0, 0, 1]
    assert_equal [0.0, 0.0, 1.0], inst_v.transformation.xaxis.to_a

    # Both are rigid right-handed unit transforms
    [inst_h, inst_v].each do |inst|
      det = compute_det(inst.transformation)
      assert_in_delta 1.0, det, 1e-4
      assert_in_delta 1.0, vector_mag(inst.transformation.xaxis), 1e-4
    end
  end

  def test_gate_h3_non_identity_mount_frame_with_displaced_origin_and_rotation
    # Gate H3: Non-identity MountFrame is mandatory proof of AssetNormalization
    # Origin displaced: [25.0, -10.0, 8.0] mm
    # 90-degree rotated basis around Z in asset space
    mf = MountFrameData.new(
      origin_mm: [25.0, -10.0, 8.0],
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],
        y: [-1.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    # In asset space, mounting holes are at:
    # hole_a: origin - 48*X_mount = [25 - 0, -10 - 48, 8] = [25.0, -58.0, 8.0]
    # hole_b: origin + 48*X_mount = [25 + 0, -10 + 48, 8] = [25.0, 38.0, 8.0]
    hole_a = [25.0, -58.0, 8.0]
    hole_b = [25.0, 38.0, 8.0]
    assert_in_delta 96.0, MountFrame.distance(hole_a, hole_b), 1e-4

    pos_mm = [450.0, 18.0, 800.0]
    placement_basis = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: placement_basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-h3'
    )
    refute_nil instance

    t = instance.transformation
    # 1. Mount anchor [25, -10, 8] mm maps EXACTLY to placement pos [450, 18, 800] mm
    anchor_in = Geom::Point3d.new(25.0 / 25.4, -10.0 / 25.4, 8.0 / 25.4)
    anchor_placed = anchor_in.transform(t)
    assert_in_delta 450.0 / 25.4, anchor_placed.x, 1e-4
    assert_in_delta 18.0 / 25.4, anchor_placed.y, 1e-4
    assert_in_delta 800.0 / 25.4, anchor_placed.z, 1e-4

    # 2. A-B distance after transform remains exactly 96.0 mm
    ha_in = Geom::Point3d.new(hole_a[0] / 25.4, hole_a[1] / 25.4, hole_a[2] / 25.4)
    hb_in = Geom::Point3d.new(hole_b[0] / 25.4, hole_b[1] / 25.4, hole_b[2] / 25.4)
    trans_a = ha_in.transform(t).to_a.map { |v| v * 25.4 }
    trans_b = hb_in.transform(t).to_a.map { |v| v * 25.4 }
    assert_in_delta 96.0, MountFrame.distance(trans_a, trans_b), 1e-4

    # 3. Determinant is +1 and scale is [1, 1, 1]
    det = compute_det(t)
    assert_in_delta 1.0, det, 1e-4
    assert_in_delta 1.0, vector_mag(t.xaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t.yaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t.zaxis), 1e-4
  end

  def test_resolved_rotated_placement_composes_after_prepared_mount_frame
    # Basis is the resolver-published 90° front-face placement basis. This
    # regression must not recalculate rotationDeg in Ruby; the host consumes the
    # resolved axes and composes them with the prepared MountFrame.
    resolved_basis = { 'x' => [0.0, -1.0, 0.0], 'y' => [1.0, 0.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
    pos_mm = [320.0, 18.0, 640.0]
    mf = MountFrameData.new(
      origin_mm: [25.0, -10.0, 8.0],
      basis: BasisData.new(
        x: [0.0, 1.0, 0.0],
        y: [-1.0, 0.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: resolved_basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-resolved-rot90'
    )
    refute_nil instance

    t_instance = instance.transformation
    t_placement = Geom::Transformation.axes(
      Geom::Point3d.new(pos_mm[0] / 25.4, pos_mm[1] / 25.4, pos_mm[2] / 25.4),
      Geom::Vector3d.new(*resolved_basis['x']),
      Geom::Vector3d.new(*resolved_basis['y']),
      Geom::Vector3d.new(*resolved_basis['z'])
    )
    t_mount_inverse = MountFrame.derive_normalization(mf).to_sketchup_transformation
    assert_equal t_placement * t_mount_inverse, t_instance,
                 'prepared instance must be T_placement * inverse(T_mountFrame)'

    assert_equal [-1.0, 0.0, 0.0], t_instance.xaxis.to_a
    assert_equal [0.0, -1.0, 0.0], t_instance.yaxis.to_a
    assert_equal [0.0, 0.0, 1.0], t_instance.zaxis.to_a

    mount_origin = Geom::Point3d.new(25.0 / 25.4, -10.0 / 25.4, 8.0 / 25.4)
    placed_origin = mount_origin.transform(t_instance)
    assert_in_delta pos_mm[0] / 25.4, placed_origin.x, 1e-4
    assert_in_delta pos_mm[1] / 25.4, placed_origin.y, 1e-4
    assert_in_delta pos_mm[2] / 25.4, placed_origin.z, 1e-4

    assert_in_delta 1.0, compute_det(t_instance), 1e-4
    assert_in_delta 1.0, vector_mag(t_instance.xaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t_instance.yaxis), 1e-4
    assert_in_delta 1.0, vector_mag(t_instance.zaxis), 1e-4
    assert_in_delta 0.0, MountFrame.dot_product(t_instance.xaxis.to_a, t_instance.yaxis.to_a), 1e-4
    assert_in_delta 0.0, MountFrame.dot_product(t_instance.xaxis.to_a, t_instance.zaxis.to_a), 1e-4
    assert_in_delta 0.0, MountFrame.dot_product(t_instance.yaxis.to_a, t_instance.zaxis.to_a), 1e-4
  end

  def test_cabinet_world_transform_preserves_local_placement_and_rigidity
    mf = MountFrameData.new(
      origin_mm: [25.0, -10.0, 8.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    pos_mm = [200.0, 18.0, 600.0]
    basis = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis, revision_id: 'rev-2',
      mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-cab'
    )
    refute_nil instance

    # Cabinet world transform: rotated 90 deg and translated to (1000, 2000, 0) mm
    t_cab_world = Geom::Transformation.axes(
      Geom::Point3d.new(1000.0 / 25.4, 2000.0 / 25.4, 0.0),
      Geom::Vector3d.new(0.0, 1.0, 0.0),
      Geom::Vector3d.new(-1.0, 0.0, 0.0),
      Geom::Vector3d.new(0.0, 0.0, 1.0)
    )

    t_hw_world = t_cab_world * instance.transformation

    # Rigidity preserved in world
    det = compute_det(t_hw_world)
    assert_in_delta 1.0, det, 1e-4
    assert_in_delta 1.0, vector_mag(t_hw_world.xaxis), 1e-4
  end

  def test_two_independent_instances_on_different_doors
    mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )

    inst1 = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [100.0, 0.0, 600.0],
      revision_id: 'rev-2', mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-d1'
    )
    inst2 = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [500.0, 0.0, 600.0],
      revision_id: 'rev-2', mount_frame: mf, preparation_state: 'prepared', placement_id: 'hw-d2'
    )

    refute_nil inst1
    refute_nil inst2
    assert_equal inst1.definition, inst2.definition
    refute_equal inst1.transformation.origin.x, inst2.transformation.origin.x
  end

  def test_unprepared_asset_records_diagnostic_and_uses_legacy_transform
    pos_mm = [150.0, 250.0, 350.0]
    basis = { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, pos_mm,
      basis: basis, revision_id: 'rev-unprepared',
      preparation_state: 'unprepared', placement_id: 'hw-legacy'
    )
    refute_nil instance

    # Diagnostic recorded
    assert_equal 1, @loader.diagnostics.length
    diag = @loader.diagnostics.first
    assert_equal 'hardware_asset_unprepared', diag['code']
    assert_equal 'hw-legacy', diag['placementId']

    # Transform applied directly without normalization
    assert_in_delta 150.0 / 25.4, instance.transformation.origin.x, 1e-4
    assert_in_delta 250.0 / 25.4, instance.transformation.origin.y, 1e-4
    assert_in_delta 350.0 / 25.4, instance.transformation.origin.z, 1e-4
  end

  def test_invalid_mount_frame_basis_records_diagnostic_and_returns_nil
    # Left-handed basis (mirror, det = -1)
    invalid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, -1.0]
      )
    )

    instance = @loader.load_asset_instance(
      @model, 'ast-handle', @target_group, [0.0, 0.0, 0.0],
      revision_id: 'rev-bad',
      mount_frame: invalid_mf, preparation_state: 'prepared', placement_id: 'hw-invalid'
    )
    assert_nil instance

    assert_equal 1, @loader.diagnostics.length
    diag = @loader.diagnostics.first
    assert_equal 'asset_preparation_invalid', diag['code']
    assert_includes diag['reason'], 'mirror is rejected'
  end

  def test_rebuild_fail_before_mutate_preserves_existing_geometry
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    definition = {
      'id' => '11111111-1111-1111-1111-111111111111',
      'furniture_definition_id' => '11111111-1111-1111-1111-111111111111',
      'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
      'name' => 'Bajo Mesada',
      'parameters' => [{ 'name' => 'widthMm', 'defaultValue' => 600.0 }]
    }

    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-1',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )

    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, 1.0]
      )
    )
    valid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-handle-valid',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-handle-r2',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [100.0, 20.0, 300.0]
    )

    initial_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1',
      [board],
      [valid_placement]
    )

    # 1. Insert initial furniture WITH real valid hardware handle
    result = builder.insert_furniture(@model, definition, { 'widthMm' => 600.0 }, resolved_layout: initial_layout)
    assert result['success'], "Insert failed: #{result['error']}"

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture

    # Find the real valid handle instance inside the furniture
    prev_hw = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-handle-valid'
    end
    refute_nil prev_hw, 'Expected real hardware handle to exist in initial furniture'
    assert prev_hw.valid?, 'Expected initial hardware handle to be valid'

    # Capture geometry and metadata before rebuild attempt
    prev_hw_def = prev_hw.definition
    prev_hw_transform = prev_hw.transformation.to_a
    prev_meta = store.read(prev_hw)
    prev_entities_count = furniture.definition.entities.instances.length
    initial_op_count = @model.operations.length

    # 2. Attempt update with a layout containing an invalidly prepared hardware asset (mirror basis)
    invalid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(
        x: [1.0, 0.0, 0.0],
        y: [0.0, 1.0, 0.0],
        z: [0.0, 0.0, -1.0] # mirror: det = -1!
      )
    )
    invalid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-handle-invalid',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-handle-bad',
      preparation_state: 'prepared',
      mount_frame: invalid_mf,
      translation: [100.0, 20.0, 300.0]
    )

    bad_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1',
      [board],
      [invalid_placement]
    )

    # 3. Execute the exact same production rebuild call path
    update_result = builder.update_furniture(
      @model, furniture, definition, { 'widthMm' => 600.0 }, resolved_layout: bad_layout
    )

    # 4. Assert failure before mutate
    refute update_result['success'], 'Rebuild with invalid preparation must fail'
    assert_includes update_result['error'], 'Preparación de herraje inválida'

    # 5. Invariants after failed rebuild:
    # - The previous handle is still valid
    assert prev_hw.valid?, 'Previous handle ComponentInstance must still be valid'
    # - It is still the real handle geometry (definition + transform unchanged)
    assert_equal prev_hw_def, prev_hw.definition, 'Previous handle definition must remain unchanged'
    assert_equal prev_hw_transform, prev_hw.transformation.to_a, 'Previous handle transform must remain unchanged'
    # - assetId/revisionId/placementId did not change
    post_meta = store.read(prev_hw)
    assert_equal prev_meta, post_meta, 'Metadata must remain identical to captured prev_meta'
    assert_equal 'ast-handle', post_meta.dig('intent', 'assetId')
    assert_equal 'rev-handle-r2', post_meta.dig('intent', 'assetRevisionId')
    assert_equal 'prepared', post_meta.dig('intent', 'preparationState')
    assert_equal 'hw-handle-valid', post_meta.dig('identity', 'hardwarePlacementId')
    assert_equal 'mesh', post_meta.dig('intent', 'representation')
    # - No proxy/cube appeared
    proxies = furniture.definition.entities.instances.select do |ci|
      store.read(ci)&.dig('intent', 'representation') == 'proxy' || ci.definition.name.include?('Proxy')
    end
    assert_empty proxies, 'No proxy or bounding box must appear'
    # - No partial children left behind
    assert_equal prev_entities_count, furniture.definition.entities.instances.length,
                 'No partial entities must be left behind'
    # - Undo stack remains coherent: no operation was opened/committed during preflight fail
    assert_equal initial_op_count, @model.operations.length,
                 'Undo stack must remain coherent (zero transactions started)'
  end

  # H8b: download/prefetch failure — rebuild must not initiate destructive mutation.
  # Proves that a :missing prefetch result (nil from downloader) blocks update_furniture
  # before start_operation, leaving the existing geometry 100% intact.
  def test_rebuild_h8b_download_failure_preserves_existing_geometry
    # Phase 1: insert furniture with a real valid hardware handle using @loader (working downloader)
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder_ok = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    definition = {
      'id' => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'furniture_definition_id' => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'furnitureDefinitionId' => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'name' => 'Bajo Mesada H8b',
      'parameters' => []
    }
    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    valid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-h8b-valid',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-2',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [100.0, 20.0, 300.0]
    )
    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-h8b',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
    initial_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [valid_placement]
    )
    result = builder_ok.insert_furniture(@model, definition, {}, resolved_layout: initial_layout)
    assert result['success'], "Initial insert failed: #{result['error']}"

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture

    prev_hw = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-h8b-valid'
    end
    refute_nil prev_hw, 'Real hardware handle must exist after initial insert'
    assert prev_hw.valid?

    prev_hw_def       = prev_hw.definition
    prev_hw_transform = prev_hw.transformation.to_a
    prev_meta         = store.read(prev_hw)
    prev_entity_count = furniture.definition.entities.instances.length
    initial_op_count  = @model.operations.length

    # Phase 2: rebuild attempt using a downloader that always fails (returns nil)
    failing_loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: FakeDownloader.new(nil)
    )
    builder_fail = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: failing_loader
    )
    # Use the same layout (valid MountFrame) — only the download fails
    update_result = builder_fail.update_furniture(
      @model, furniture, definition, {}, resolved_layout: initial_layout
    )

    # Must fail with a typed error before opening any operation
    refute update_result['success'], 'Rebuild with download failure must fail'
    assert_includes update_result['error'], 'geometría 3D del herraje'

    # Invariants: existing geometry is fully preserved
    assert prev_hw.valid?, 'Previous handle must still be valid'
    assert_equal prev_hw_def, prev_hw.definition, 'Handle definition must be unchanged'
    assert_equal prev_hw_transform, prev_hw.transformation.to_a, 'Handle transform must be unchanged'
    post_meta = store.read(prev_hw)
    assert_equal prev_meta, post_meta, 'Hardware metadata must be identical'
    assert_equal 'ast-handle', post_meta.dig('intent', 'assetId')
    assert_equal 'rev-2', post_meta.dig('intent', 'assetRevisionId')
    assert_equal 'hw-h8b-valid', post_meta.dig('identity', 'hardwarePlacementId')

    proxies = furniture.definition.entities.instances.select do |ci|
      store.read(ci)&.dig('intent', 'representation') == 'proxy' || ci.definition.name.include?('Proxy')
    end
    assert_empty proxies, 'No proxy must appear after download failure'
    assert_equal prev_entity_count, furniture.definition.entities.instances.length,
                 'No partial entities must be left behind'
    assert_equal initial_op_count, @model.operations.length,
                 'Undo stack must be coherent: no operations started'
  end

  # H8c: SKP file is reachable but definitions.load fails — rebuild must not mutate.
  # Proves that the R2 loadability gate (probe_loadability) blocks update_furniture
  # when the downloader returns a valid path but SketchUp cannot load the file.
  def test_rebuild_h8c_loadability_failure_preserves_existing_geometry
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder_ok = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    definition = {
      'id' => 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'furniture_definition_id' => 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'furnitureDefinitionId' => 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'name' => 'Bajo Mesada H8c',
      'parameters' => []
    }
    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    valid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-h8c-valid',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-2',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [100.0, 20.0, 300.0]
    )
    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-h8c',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
    initial_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [valid_placement]
    )
    result = builder_ok.insert_furniture(@model, definition, {}, resolved_layout: initial_layout)
    assert result['success'], "Initial insert failed: #{result['error']}"

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture

    prev_hw = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-h8c-valid'
    end
    refute_nil prev_hw, 'Real hardware handle must exist after initial insert'

    prev_hw_def       = prev_hw.definition
    prev_hw_transform = prev_hw.transformation.to_a
    prev_meta         = store.read(prev_hw)
    prev_entity_count = furniture.definition.entities.instances.length
    initial_op_count  = @model.operations.length

    # Phase 2: loader that returns the real file path but probe_loadability returns false.
    # This simulates definitions.load failing (e.g. corrupt SKP, unsupported version).
    loader_c = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: FakeDownloader.new(@skp_file)
    )
    # Override probe_loadability to simulate a load failure despite file existing.
    loader_c.define_singleton_method(:probe_loadability) { |_model, _path| false }

    builder_c = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: loader_c
    )
    update_result = builder_c.update_furniture(
      @model, furniture, definition, {}, resolved_layout: initial_layout
    )

    refute update_result['success'], 'Rebuild with loadability failure must fail'
    assert_includes update_result['error'], 'geometría 3D del herraje'

    assert prev_hw.valid?, 'Previous handle must still be valid'
    assert_equal prev_hw_def, prev_hw.definition, 'Handle definition must be unchanged'
    assert_equal prev_hw_transform, prev_hw.transformation.to_a, 'Handle transform must be unchanged'
    post_meta = store.read(prev_hw)
    assert_equal prev_meta, post_meta, 'Hardware metadata must be identical'
    assert_equal 'ast-handle', post_meta.dig('intent', 'assetId')
    assert_equal 'hw-h8c-valid', post_meta.dig('identity', 'hardwarePlacementId')

    proxies = furniture.definition.entities.instances.select do |ci|
      store.read(ci)&.dig('intent', 'representation') == 'proxy' || ci.definition.name.include?('Proxy')
    end
    assert_empty proxies, 'No proxy must appear after loadability failure'
    assert_equal prev_entity_count, furniture.definition.entities.instances.length,
                 'No partial entities must be left behind'
    assert_equal initial_op_count, @model.operations.length,
                 'Undo stack must be coherent: no operations started'
  end

  # R3: Real loadability probe failure on multi-placement rebuild reverts
  # newly loaded definitions so DefinitionList is left completely clean.
  # Placement A: valid SKP and loadable in SketchUp.
  # Placement B: corrupted SKP on disk (definitions.load returns nil).
  # Uses real DefinitionListStub#load without stubbing probe_loadability.
  def test_r3_real_loadability_probe_failure_reverts_definitions_and_preserves_geometry
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder_ok = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    definition = {
      'id' => 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'furniture_definition_id' => 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'furnitureDefinitionId' => 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'name' => 'Bajo Mesada R3',
      'parameters' => []
    }
    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    initial_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-r3-init',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-2',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [100.0, 20.0, 300.0]
    )
    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-r3',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
    initial_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [initial_placement]
    )
    insert_res = builder_ok.insert_furniture(@model, definition, {}, resolved_layout: initial_layout)
    assert insert_res['success'], "Initial insert failed: #{insert_res['error']}"

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture
    prev_hw = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-r3-init'
    end
    refute_nil prev_hw
    prev_hw_def = prev_hw.definition
    prev_hw_transform = prev_hw.transformation.to_a
    prev_meta = store.read(prev_hw)
    prev_entity_count = furniture.definition.entities.instances.length
    initial_def_count = @model.definitions.to_a.length
    initial_op_count = @model.operations.length

    # Create real files on disk: A is valid, B is corrupt (causes definitions.load -> nil)
    skp_a = File.join(@tmp_dir, 'handle_r3_a.skp')
    File.binwrite(skp_a, 'SKP VALID HANDLE A')
    skp_b = File.join(@tmp_dir, 'handle_r3_b.skp')
    File.binwrite(skp_b, 'CORRUPT_SKP')

    downloader_r3 = Class.new do
      def initialize(map)
        @map = map
      end

      def download_asset(asset_id:, **)
        @map[asset_id]
      end
    end.new('ast-handle-r3-a' => skp_a, 'ast-handle-r3-b' => skp_b)

    loader_r3 = Granete::SketchUpExtension::Assets::AssetLoader.new(downloader: downloader_r3)
    builder_r3 = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: loader_r3
    )

    placement_a = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-r3-a',
      asset_id: 'ast-handle-r3-a',
      asset_revision_id: 'rev-a',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [150.0, 20.0, 300.0]
    )
    placement_b = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-r3-b',
      asset_id: 'ast-handle-r3-b',
      asset_revision_id: 'rev-b',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [250.0, 20.0, 300.0]
    )
    multi_layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [placement_a, placement_b]
    )

    # Rebuild attempt: Placement A succeeds loadability probe; Placement B fails loadability probe.
    # Entire preflight aborts BEFORE start_operation.
    update_result = builder_r3.update_furniture(
      @model, furniture, definition, {}, resolved_layout: multi_layout
    )

    refute update_result['success'], 'Rebuild must fail when any placement fails loadability probe'
    assert_includes update_result['error'], 'geometría 3D del herraje'
    assert_includes update_result['error'], 'hw-r3-b'

    # R3 Invariants verification:
    # 1. Furniture geometry and previous handle 100% intact
    assert prev_hw.valid?, 'Previous handle ComponentInstance must still be valid'
    assert_equal prev_hw_def, prev_hw.definition, 'Previous handle definition must be unchanged'
    assert_equal prev_hw_transform, prev_hw.transformation.to_a, 'Previous handle transform unchanged'
    assert_equal prev_meta, store.read(prev_hw), 'Previous handle metadata unchanged'

    # 2. Zero new instances, zero partial children
    assert_equal prev_entity_count, furniture.definition.entities.instances.length,
                 'Zero partial children: entity count unchanged'

    # 3. DefinitionList reverted: handle_r3_a was loaded during probe but reverted on failure
    assert_nil @model.definitions['handle_r3_a'],
               'DefinitionList reverted: handle_r3_a definition must be removed on preflight failure'
    assert_nil @model.definitions['handle_r3_b']
    assert_equal initial_def_count, @model.definitions.to_a.length,
                 'DefinitionList restored to exact pre-preflight definition set'

    # 4. Undo stack coherent: zero operations opened
    assert_equal initial_op_count, @model.operations.length,
                 'Undo stack coherent: no operation opened before abort'
  end

  # R3: Download -> validate MountFrame -> only then probe loadability.
  # When MountFrame validation fails in Stage 2, Stage 3 is skipped entirely
  # so no definitions are ever loaded into SketchUp.
  def test_r3_preflight_order_skips_load_probe_when_mount_frame_invalid
    skp_a = File.join(@tmp_dir, 'handle_order_a.skp')
    File.binwrite(skp_a, 'SKP VALID A')

    invalid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [1.0, 0.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )

    placement_a = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-order-a',
      asset_id: 'ast-order-a',
      asset_revision_id: 'rev-a',
      preparation_state: 'prepared',
      mount_frame: valid_mf
    )
    placement_b = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-order-b',
      asset_id: 'ast-order-b',
      asset_revision_id: 'rev-b',
      preparation_state: 'prepared',
      mount_frame: invalid_mf
    )

    downloader = Class.new do
      def initialize(path)
        @path = path
      end

      def download_asset(*)
        @path
      end
    end.new(skp_a)

    loader = Granete::SketchUpExtension::Assets::AssetLoader.new(downloader: downloader)
    loader.prefetch_hardware_assets([placement_a, placement_b], model: @model)

    ok, err = loader.rebuild_preflight_ok?
    refute ok
    assert_includes err, 'Preparación de herraje inválida'
    # handle_order_a must NEVER have been loaded into model.definitions because
    # stage 2 (MountFrame validation) aborted preflight before stage 3 (loadability probe)
    assert_nil @model.definitions['handle_order_a'],
               'Stage 3 loadability probe must not run when stage 2 validation fails'
  end

  # R4: Policy B — New furniture insertion falls back to proxy box when asset is :missing.
  def test_r4_insertion_policy_b_fallback_to_proxy_on_missing_asset
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    failing_loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: FakeDownloader.new(nil)
    )
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: failing_loader
    )

    definition = {
      'id' => 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'furniture_definition_id' => 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'furnitureDefinitionId' => 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'name' => 'Bajo Mesada R4 Fallback',
      'parameters' => []
    }
    valid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    missing_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-r4-missing',
      asset_id: 'ast-handle-missing',
      asset_revision_id: 'rev-missing',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: valid_mf,
      translation: [100.0, 20.0, 300.0]
    )
    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-r4',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
    layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [missing_placement]
    )

    # Policy B: New insertion proceeds with fallback proxy geometry instead of blocking
    result = builder.insert_furniture(@model, definition, {}, resolved_layout: layout)
    assert result['success'], "Insertion under Policy B must succeed: #{result['error']}"

    furniture = @model.active_entities.grep(Sketchup::ComponentInstance).first
    refute_nil furniture

    # The hardware instance exists as a native component instance (proxy box)
    hw_instance = furniture.definition.entities.instances.find do |ci|
      store.read(ci)&.dig('identity', 'hardwarePlacementId') == 'hw-r4-missing'
    end
    refute_nil hw_instance, 'Hardware proxy instance must be present in inserted furniture'
    assert hw_instance.definition.name.include?('Granete · Herraje ·')
    meta = store.read(hw_instance)
    assert_equal 'componentInstance', meta['kind']
    assert_equal 'hardware_hw-r4-missing', meta['intent']['semanticRole']
  end

  # R4: Policy B — New furniture insertion fails closed when MountFrame is :invalid.
  def test_r4_insertion_policy_b_fails_closed_on_invalid_mount_frame
    store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: store,
      asset_loader: @loader
    )

    definition = {
      'id' => 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'furniture_definition_id' => 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'furnitureDefinitionId' => 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'name' => 'Bajo Mesada R4 Invalid',
      'parameters' => []
    }
    invalid_mf = MountFrameData.new(
      origin_mm: [0.0, 0.0, 0.0],
      basis: BasisData.new(x: [1.0, 0.0, 0.0], y: [1.0, 0.0, 0.0], z: [0.0, 0.0, 1.0])
    )
    invalid_placement = Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
      placement_id: 'hw-r4-invalid',
      asset_id: 'ast-handle',
      asset_revision_id: 'rev-2',
      representation: 'mesh',
      preparation_state: 'prepared',
      mount_frame: invalid_mf,
      translation: [100.0, 20.0, 300.0]
    )
    board = Granete::SketchUpExtension::Library::LayoutBoardTransform.new(
      component_instance_id: 'board-r4-inv',
      slot_id: 'left_side',
      name: 'Lateral',
      dims: { 'width' => 18.0, 'thickness' => 590.0, 'length' => 720.0 },
      local_transform: {
        'translation' => [0.0, 0.0, 0.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    )
    layout = Granete::SketchUpExtension::Library::NativeLayout.new(
      'granete.local-basis.v1', [board], [invalid_placement]
    )

    initial_instances_count = @model.active_entities.grep(Sketchup::ComponentInstance).length

    # Policy B: Invalid preparation fails closed before opening operation
    result = builder.insert_furniture(@model, definition, {}, resolved_layout: layout)
    refute result['success'], 'Insertion with invalid MountFrame must fail'
    assert_includes result['error'], 'Preparación de herraje inválida'
    assert_equal initial_instances_count, @model.active_entities.grep(Sketchup::ComponentInstance).length,
                 'Zero furniture instances must be inserted on invalid preparation'
  end

  private

  def vector_mag(vec)
    MountFrame.magnitude(vec.to_a)
  end

  def compute_det(transform)
    cross_yz = MountFrame.cross_product(transform.yaxis.to_a, transform.zaxis.to_a)
    MountFrame.dot_product(transform.xaxis.to_a, cross_yz)
  end
end
