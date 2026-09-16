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

  private

  def vector_mag(vec)
    MountFrame.magnitude(vec.to_a)
  end

  def compute_det(transform)
    cross_yz = MountFrame.cross_product(transform.yaxis.to_a, transform.zaxis.to_a)
    MountFrame.dot_product(transform.xaxis.to_a, cross_yz)
  end
end
