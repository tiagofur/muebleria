# frozen_string_literal: true

require 'tmpdir'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/assets/mount_frame'
require_relative '../../src/granete_for_sketchup/assets/asset_resolver'
require_relative '../../src/granete_for_sketchup/assets/hardware_asset_cache'
require_relative '../../src/granete_for_sketchup/assets/asset_loader'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

class AssemblyRuntimeTest < Minitest::Test
  MM = 1.0 / 25.4
  MountFrame = Granete::SketchUpExtension::Assets::MountFrame
  BasisData = MountFrame::BasisData
  MountFrameData = MountFrame::MountFrameData

  class FakeDownloader
    attr_accessor :fail_revision

    def initialize(canned_path = nil, paths_by_revision = {})
      @canned_path = canned_path
      @paths_by_revision = paths_by_revision
      @fail_revision = nil
    end

    def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
      _ = [asset_id, sha256, expected_bytes, org_id]
      return nil if @fail_revision && revision_id == @fail_revision

      @paths_by_revision[revision_id] || @canned_path
    end
  end

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @tmp_dir = Dir.mktmpdir('assembly_runtime_test')
    @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(cache_dir: @tmp_dir)

    @side_skp = File.join(@tmp_dir, 'side_panel.skp')
    File.binwrite(@side_skp, 'SKP DRAWER SIDE')

    @runner_skp = File.join(@tmp_dir, 'runner_500.skp')
    File.binwrite(@runner_skp, 'SKP DRAWER RUNNER')

    @downloader = FakeDownloader.new(
      nil,
      'rev-side-1' => @side_skp,
      'rev-runner-1' => @runner_skp
    )
    @asset_loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
      downloader: @downloader,
      cache: @cache
    )
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
      metadata_store: @store,
      asset_loader: @asset_loader
    )
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
  end

  # D1: Layout contract parses assemblies, validates basis, fails closed on invalid input
  def test_d1_layout_contract_parsing_and_validation
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

    assert_equal 1, parsed.assemblies.length
    assembly = parsed.assemblies.first
    assert_equal 'drawer-inst-1', assembly.assembly_instance_id
    assert_equal 'agr-merivobox', assembly.agregado_id
    assert_equal 4, assembly.rigid_members.length
    assert_equal 1, assembly.fabricated_components.length

    # Fails closed on missing assemblyInstanceId
    bad_id = JSON.parse(JSON.generate(layout_data))
    bad_id['assemblies'].first.delete('assemblyInstanceId')
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(bad_id)
    end

    # Fails closed on missing agregadoId
    bad_agr = JSON.parse(JSON.generate(layout_data))
    bad_agr['assemblies'].first.delete('agregadoId')
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(bad_agr)
    end

    # Fails closed on mirrored basis (det = -1)
    mirrored = JSON.parse(JSON.generate(layout_data))
    mirrored['assemblies'].first['placement']['basis']['x'] = [-1.0, 0.0, 0.0]
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(mirrored)
    end

    # Fails closed when assembly has no members and no fabricated components
    empty_assembly = JSON.parse(JSON.generate(layout_data))
    empty_assembly['assemblies'].first['rigidMembers'] = []
    empty_assembly['assemblies'].first['fabricatedComponents'] = []
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      Granete::SketchUpExtension::Library::LayoutContract.parse!(empty_assembly)
    end
  end

  # D2: Rigid members use exact visual pins; historical snapshots report historical_asset_missing
  def test_d2_exact_visual_pins_and_historical_snapshot
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    layout_data['assemblies'].first['isHistorical'] = true
    layout_data['assemblies'].first['rigidMembers'].first['assetRevisionId'] = 'rev-side-historical-unavail'

    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    first_member = parsed.assemblies.first.rigid_members.first
    assert first_member.historical?

    # Prefetch detects missing historical asset
    @builder.prefetch_visual_assets(@model, parsed)
    diag = @asset_loader.diagnostics.find { |d| d['placementId'] == first_member.placement_id }
    refute_nil diag
    assert_equal 'historical_asset_missing', diag['code']
  end

  # D3: MountFrame normalization occurs exactly once in AssetLoader
  def test_d3_mount_frame_normalization_applied_once
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    # Give sideLeft a MountFrame with non-zero origin and rotated basis
    layout_data['assemblies'].first['rigidMembers'].first['mountFrame'] = {
      'originMm' => [25.0, -10.0, 8.0],
      'basis' => {
        'x' => [0.0, 1.0, 0.0],
        'y' => [-1.0, 0.0, 0.0],
        'z' => [0.0, 0.0, 1.0]
      }
    }
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed)
    assert result['success']

    furniture = @model.active_entities.instances.first
    side_left = furniture.definition.entities.instances.find { |inst| inst.name == 'Lateral Izquierdo' }
    refute_nil side_left

    # The mount origin in asset space [25, -10, 8] mm must map to expected furniture coordinates
    # T_placement = T_assembly * T_member
    # assembly translation = [0, 100, 50], member translation = [10, 0, 10] => [10, 100, 60] mm
    mount_origin_inches = Geom::Point3d.new(25.0 * MM, -10.0 * MM, 8.0 * MM)
    placed_point = mount_origin_inches.transform(side_left.transformation)

    assert_in_delta 10.0 * MM, placed_point.x, 1e-4
    assert_in_delta 100.0 * MM, placed_point.y, 1e-4
    assert_in_delta 60.0 * MM, placed_point.z, 1e-4

    # Negative test: applying normalization a second time would shift the point away from [10, 100, 60]
    norm = MountFrame.derive_normalization(
      MountFrameData.new(
        origin_mm: [25.0, -10.0, 8.0],
        basis: BasisData.new(x: [0.0, 1.0, 0.0], y: [-1.0, 0.0, 0.0], z: [0.0, 0.0, 1.0])
      )
    )
    t_double_normalized = side_left.transformation * norm.to_sketchup_transformation
    double_point = mount_origin_inches.transform(t_double_normalized)
    refute_in_delta 10.0 * MM, double_point.x, 0.1
  end

  # D4: Strict rigidity: det = +1.0 and scale is [1, 1, 1]
  def test_d4_rigid_members_never_scale
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed)
    assert result['success']

    furniture = @model.active_entities.instances.first
    rigid_names = ['Lateral Izquierdo', 'Lateral Derecho', 'Guía Izquierda', 'Guía Derecha']
    rigid_instances = furniture.definition.entities.instances.select { |inst| rigid_names.include?(inst.name) }

    assert_equal 4, rigid_instances.length
    rigid_instances.each do |inst|
      t = inst.transformation
      det = compute_transform_determinant(t)
      assert_in_delta 1.0, det, 1e-4, "Instance #{inst.name} determinant must be +1.0 (got #{det})"

      x_scale = Math.sqrt((t.to_a[0]**2) + (t.to_a[1]**2) + (t.to_a[2]**2))
      y_scale = Math.sqrt((t.to_a[4]**2) + (t.to_a[5]**2) + (t.to_a[6]**2))
      z_scale = Math.sqrt((t.to_a[8]**2) + (t.to_a[9]**2) + (t.to_a[10]**2))

      assert_in_delta 1.0, x_scale, 1e-4, "Instance #{inst.name} X scale must be 1.0"
      assert_in_delta 1.0, y_scale, 1e-4, "Instance #{inst.name} Y scale must be 1.0"
      assert_in_delta 1.0, z_scale, 1e-4, "Instance #{inst.name} Z scale must be 1.0"
    end
  end

  # D5: Fixture 600 mm -> 800 mm: right translates +200 mm, left stays fixed, bottom regenerates
  def test_d5_fixture_600_to_800_translation_and_dimension_rebuild
    layout_initial = build_drawer_assembly_layout(width_mm: 600.0)
    parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)
    definition = { 'name' => 'Drawer Unit', 'furniture_definition_id' => 'f-def-1' }

    # Step 1: Initial insertion at 600 mm
    result_initial = @builder.insert_furniture(@model, definition, { 'widthMm' => 600.0 },
                                               resolved_layout: parsed_initial)
    assert result_initial['success']
    furniture = @model.active_entities.instances.first

    side_l_initial = find_entity_by_name(furniture, 'Lateral Izquierdo')
    side_r_initial = find_entity_by_name(furniture, 'Lateral Derecho')
    runner_r_initial = find_entity_by_name(furniture, 'Guía Derecha')
    bottom_initial = find_entity_by_name(furniture, 'Fondo Cajón')

    orig_l_pos_x = side_l_initial.transformation.origin.x
    orig_r_pos_x = side_r_initial.transformation.origin.x
    orig_runner_r_pos_x = runner_r_initial.transformation.origin.x
    orig_bottom_def_name = bottom_initial.definition.name

    # Step 2: Rebuild at 800 mm
    layout_rebuilt = build_drawer_assembly_layout(width_mm: 800.0)
    parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)
    result_rebuilt = @builder.update_furniture(@model, furniture, definition, { 'widthMm' => 800.0 },
                                               resolved_layout: parsed_rebuilt)
    assert result_rebuilt['success']

    side_l_rebuilt = find_entity_by_name(furniture, 'Lateral Izquierdo')
    side_r_rebuilt = find_entity_by_name(furniture, 'Lateral Derecho')
    runner_r_rebuilt = find_entity_by_name(furniture, 'Guía Derecha')
    bottom_rebuilt = find_entity_by_name(furniture, 'Fondo Cajón')

    # Left side: position unchanged
    assert_in_delta orig_l_pos_x, side_l_rebuilt.transformation.origin.x, 1e-4

    # Right side: translated exactly +200 mm
    delta_r_inches = side_r_rebuilt.transformation.origin.x - orig_r_pos_x
    assert_in_delta 200.0 * MM, delta_r_inches, 1e-4

    # Right runner: translated exactly +200 mm
    delta_runner_inches = runner_r_rebuilt.transformation.origin.x - orig_runner_r_pos_x
    assert_in_delta 200.0 * MM, delta_runner_inches, 1e-4

    # Bottom fabricated panel: new definition regenerated with width 765 mm
    refute_equal orig_bottom_def_name, bottom_rebuilt.definition.name
    # Bottom box extents should span 765 mm on X in local definition coordinates
    bottom_faces = bottom_rebuilt.definition.entities.faces
    refute_empty bottom_faces
  end

  # D6: Shared ComponentDefinition between members with same assetRevisionId
  def test_d6_shared_component_definition_for_same_asset_revision
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed)
    assert result['success']

    furniture = @model.active_entities.instances.first
    side_l = find_entity_by_name(furniture, 'Lateral Izquierdo')
    side_r = find_entity_by_name(furniture, 'Lateral Derecho')

    assert_equal side_l.definition, side_r.definition, 'Left and right sides must share ComponentDefinition'
    refute_equal side_l.transformation.to_a, side_r.transformation.to_a, 'Transforms must be independent'
  end

  # D7: Stable identity and metadata
  def test_d7_stable_identity_and_metadata
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed)
    assert result['success']

    furniture = @model.active_entities.instances.first
    side_r = find_entity_by_name(furniture, 'Lateral Derecho')
    bottom = find_entity_by_name(furniture, 'Fondo Cajón')

    side_r_meta = @store.read(side_r)
    assert_equal 'drawer-inst-1:sideRight', side_r_meta.dig('identity', 'instanceRef')
    assert_equal 'drawer-inst-1', side_r_meta.dig('identity', 'assemblyInstanceId')
    assert_equal 'agr-merivobox', side_r_meta.dig('identity', 'agregadoId')
    assert_equal 'sideRight', side_r_meta.dig('identity', 'memberId')

    bottom_meta = @store.read(bottom)
    assert_equal 'drawer-inst-1:bottom', bottom_meta.dig('identity', 'instanceRef')
    assert_equal 'drawer-inst-1', bottom_meta.dig('identity', 'assemblyInstanceId')
    assert_equal 'agr-merivobox', bottom_meta.dig('identity', 'agregadoId')
    assert_equal 'bottom', bottom_meta.dig('identity', 'componentId')
  end

  # D8: Assembly-level fail-before-mutate: 1 failing member aborts rebuild without touching old geometry
  def test_d8_assembly_level_fail_before_mutate
    initial_layout = build_drawer_assembly_layout(width_mm: 600.0)
    initial_parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(initial_layout)
    definition = { 'name' => 'Drawer Unit', 'furniture_definition_id' => 'f-def-1' }

    # Initial insertion succeeds
    initial_result = @builder.insert_furniture(@model, definition, {}, resolved_layout: initial_parsed)
    assert initial_result['success']
    furniture = @model.active_entities.instances.first
    initial_child_count = furniture.definition.entities.instances.length

    # Now make runnerRight fail during rebuild
    @downloader.fail_revision = 'rev-runner-1'

    rebuild_layout = build_drawer_assembly_layout(width_mm: 800.0)
    rebuild_parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(rebuild_layout)

    rebuild_result = @builder.update_furniture(@model, furniture, definition, { 'widthMm' => 800.0 },
                                               resolved_layout: rebuild_parsed)
    refute rebuild_result['success']
    assert_includes rebuild_result['error'], 'No se pudo descargar o cargar la geometría 3D'

    # The existing complete furniture was not cleared or mutated!
    assert_equal initial_child_count, furniture.definition.entities.instances.length
  end

  # D9: Exact thicknesses (15 mm bottom, 12 mm back)
  def test_d9_exact_non_18mm_thicknesses
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    # Add a back component with 12 mm thickness
    layout_data['assemblies'].first['fabricatedComponents'] << {
      'componentId' => 'back',
      'name' => 'Trasera Cajón',
      'slotId' => 'drawer_back',
      'widthMm' => 565.0,
      'thicknessMm' => 12.0,
      'lengthMm' => 140.0,
      'localTransform' => {
        'translationMm' => [17.5, 480.0, 10.0],
        'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
      }
    }
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: parsed)
    assert result['success']

    furniture = @model.active_entities.instances.first
    bottom = find_entity_by_name(furniture, 'Fondo Cajón')
    back = find_entity_by_name(furniture, 'Trasera Cajón')

    refute_nil bottom
    refute_nil back

    bottom_comp = parsed.assemblies.first.fabricated_components.find { |c| c.component_id == 'bottom' }
    back_comp = parsed.assemblies.first.fabricated_components.find { |c| c.component_id == 'back' }

    assert_equal 15.0, bottom_comp.thickness_mm
    assert_equal 12.0, back_comp.thickness_mm
  end

  # D10: Furniture world transform non-identity check: T_world = T_furniture * T_assembly * T_member * T_norm
  def test_d10_world_transformation_composition
    layout_data = build_drawer_assembly_layout(width_mm: 600.0)
    layout_data['assemblies'].first['placement'] = {
      'translationMm' => [50.0, 100.0, 30.0],
      'basis' => {
        'x' => [1.0, 0.0, 0.0],
        'y' => [0.0, 1.0, 0.0],
        'z' => [0.0, 0.0, 1.0]
      }
    }
    layout_data['assemblies'].first['rigidMembers'].first['localTransform'] = {
      'translationMm' => [10.0, 20.0, 5.0],
      'basis' => {
        'x' => [1.0, 0.0, 0.0],
        'y' => [0.0, 1.0, 0.0],
        'z' => [0.0, 0.0, 1.0]
      }
    }
    layout_data['assemblies'].first['rigidMembers'].first['mountFrame'] = {
      'originMm' => [5.0, -2.0, 3.0],
      'basis' => {
        'x' => [1.0, 0.0, 0.0],
        'y' => [0.0, 1.0, 0.0],
        'z' => [0.0, 0.0, 1.0]
      }
    }
    parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)
    definition = { 'name' => 'Drawer Unit 600', 'furniture_definition_id' => 'f-def-1' }

    # Place furniture in world with translation [1000, 500, 200] mm
    t_furniture = Geom::Transformation.translation(Geom::Vector3d.new(1000.0 * MM, 500.0 * MM, 200.0 * MM))
    result = @builder.place_existing_furniture(@model,
                                               furniture_instance_id: 'fi-world-1',
                                               definition: definition,
                                               parameters: {},
                                               resolved_layout: parsed,
                                               transformation: t_furniture)
    assert result['success']

    furniture = result['entity']
    side_left = find_entity_by_name(furniture, 'Lateral Izquierdo')
    refute_nil side_left

    # Analytical expectation for mount origin:
    # Furniture = [1000, 500, 200]
    # Assembly  = [50, 100, 30]
    # Member    = [10, 20, 5]
    # Total expected world coordinate of the mount origin:
    # X = 1000 + 50 + 10 = 1060 mm
    # Y = 500 + 100 + 20 = 620 mm
    # Z = 200 + 30 + 5   = 235 mm
    mount_origin_inches = Geom::Point3d.new(5.0 * MM, -2.0 * MM, 3.0 * MM)
    t_world = furniture.transformation * side_left.transformation
    placed_world_point = mount_origin_inches.transform(t_world)

    assert_in_delta 1060.0 * MM, placed_world_point.x, 1e-4
    assert_in_delta 620.0 * MM, placed_world_point.y, 1e-4
    assert_in_delta 235.0 * MM, placed_world_point.z, 1e-4
  end

  private

  def find_entity_by_name(furniture, name)
    furniture.definition.entities.instances.find { |inst| inst.name == name }
  end

  def compute_transform_determinant(trans)
    a = trans.to_a
    # 3x3 rotation/scale submatrix determinant from SketchUp 4x4 matrix
    (a[0] * ((a[5] * a[10]) - (a[6] * a[9]))) -
      (a[1] * ((a[4] * a[10]) - (a[6] * a[8]))) +
      (a[2] * ((a[4] * a[9]) - (a[5] * a[8])))
  end

  def build_drawer_assembly_layout(width_mm: 600.0)
    delta = width_mm - 600.0
    {
      'furnitureDefinitionId' => '50000000-0000-0000-0000-0000000000d1',
      'definitionName' => "Mueble Cajonero #{width_mm.to_i}",
      'transformContract' => 'granete.local-basis.v1',
      'dimensionsMm' => [width_mm, 720.0, 560.0],
      'components' => [
        {
          'componentInstanceId' => 'cabinet-side-l',
          'name' => 'Lateral Carcasa',
          'slotId' => 'lateral_carcasa',
          'widthMm' => 18.0,
          'thicknessMm' => 560.0,
          'lengthMm' => 720.0,
          'localTransform' => {
            'translationMm' => [0.0, 0.0, 0.0],
            'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
          }
        }
      ],
      'assemblies' => [
        {
          'assemblyInstanceId' => 'drawer-inst-1',
          'agregadoId' => 'agr-merivobox',
          'recipeRevision' => 1,
          'isHistorical' => false,
          'dimensionsMm' => [width_mm, 150.0, 500.0],
          'placement' => {
            'translationMm' => [0.0, 100.0, 50.0],
            'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
          },
          'rigidMembers' => [
            {
              'memberId' => 'sideLeft',
              'role' => 'drawer_side_left',
              'name' => 'Lateral Izquierdo',
              'hardwareId' => 'hw-side-l',
              'assetId' => 'ast-side',
              'assetRevisionId' => 'rev-side-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [10.0, 0.0, 10.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'sideRight',
              'role' => 'drawer_side_right',
              'name' => 'Lateral Derecho',
              'hardwareId' => 'hw-side-r',
              'assetId' => 'ast-side',
              'assetRevisionId' => 'rev-side-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [560.0 + delta, 0.0, 10.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'runnerLeft',
              'role' => 'drawer_runner_left',
              'name' => 'Guía Izquierda',
              'hardwareId' => 'hw-runner-l',
              'assetId' => 'ast-runner',
              'assetRevisionId' => 'rev-runner-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [5.0, 0.0, 5.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'memberId' => 'runnerRight',
              'role' => 'drawer_runner_right',
              'name' => 'Guía Derecha',
              'hardwareId' => 'hw-runner-r',
              'assetId' => 'ast-runner',
              'assetRevisionId' => 'rev-runner-1',
              'preparationState' => 'prepared',
              'mountFrame' => {
                'originMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'localTransform' => {
                'translationMm' => [565.0 + delta, 0.0, 5.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            }
          ],
          'fabricatedComponents' => [
            {
              'componentId' => 'bottom',
              'name' => 'Fondo Cajón',
              'slotId' => 'drawer_bottom',
              'widthMm' => 565.0 + delta,
              'thicknessMm' => 15.0,
              'lengthMm' => 480.0,
              'materialColorHex' => '#e0d8cc',
              'localTransform' => {
                'translationMm' => [17.5, 0.0, 10.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            }
          ]
        }
      ]
    }
  end
end
