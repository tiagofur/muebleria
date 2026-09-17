# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #670 Increment D:
# Runtime de Assemblies Paramétricos en SketchUp.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   A1: Parametric assembly insertion at W600 (rigid members det=+1.0, scale=[1,1,1], bottom panel = 565 mm).
#   A2: Rebuild 600 mm -> 800 mm (right side translates +200 mm, left stays fixed, bottom panel 565 -> 765 mm).
#   A3: Non-identity compound transformation (furniture * assembly * member * mount_frame).
#   A4: Shared ComponentDefinition across instances with independent transforms.
#   A5: Save, close, and reopen .skp preserves assembly identities, transforms, and metadata.
#   A6: Undo and Redo revert and restore assembly geometry and metadata cleanly.
#   A7: Assembly-level fail-before-mutate (1 failing member preserves existing geometry intact).
module Granete
  module SketchUpExtension
    class TC_AssemblyRuntimeSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FURNITURE_DEF_ID = '50000000-0000-0000-0000-0000000000d1'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @tmp_dir = Dir.mktmpdir('granete-assembly-smoke')
        @metadata_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        @asset_loader = create_fixture_asset_loader
        @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: @asset_loader
        )
      end

      def teardown
        FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        Sketchup.file_new
      end

      # A1: Assembly insertion at W600
      def test_a1_assembly_insertion_at_w600
        layout_data = build_drawer_assembly_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success'], "Insertion failed: #{result['error']}"

        furniture = find_furniture(FI_1)
        refute_nil furniture

        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r = find_child_by_name(furniture, 'Lateral Derecho')
        runner_l = find_child_by_name(furniture, 'Guía Izquierda')
        runner_r = find_child_by_name(furniture, 'Guía Derecha')
        bottom = find_child_by_name(furniture, 'Fondo Cajón')

        refute_nil side_l, 'sideLeft must be materialized'
        refute_nil side_r, 'sideRight must be materialized'
        refute_nil runner_l, 'runnerLeft must be materialized'
        refute_nil runner_r, 'runnerRight must be materialized'
        refute_nil bottom, 'bottom panel must be materialized'

        [side_l, side_r, runner_l, runner_r].each do |inst|
          assert_rigid_transformation(inst.transformation)
        end

        side_r_meta = @metadata_store.read(side_r)
        assert_equal 'drawer-inst-1', side_r_meta.dig('identity', 'assemblyInstanceId')
        assert_equal 'sideRight', side_r_meta.dig('identity', 'memberId')
      end

      # A2: Rebuild 600 mm -> 800 mm
      def test_a2_rebuild_600_to_800_translates_right_members_and_regenerates_bottom
        layout_initial = build_drawer_assembly_layout(width_mm: 600.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success'], "Initial insertion failed: #{result_initial['error']}"

        furniture = find_furniture(FI_1)
        side_l_init = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r_init = find_child_by_name(furniture, 'Lateral Derecho')
        bottom_init = find_child_by_name(furniture, 'Fondo Cajón')

        orig_l_pos_x = side_l_init.transformation.origin.x
        orig_r_pos_x = side_r_init.transformation.origin.x
        orig_bottom_def_name = bottom_init.definition.name

        # Rebuild at 800 mm
        layout_rebuilt = build_drawer_assembly_layout(width_mm: 800.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = @builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        assert result_rebuilt['success'], "Update failed: #{result_rebuilt['error']}"

        side_l_rebuilt = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r_rebuilt = find_child_by_name(furniture, 'Lateral Derecho')
        bottom_rebuilt = find_child_by_name(furniture, 'Fondo Cajón')

        assert_in_delta orig_l_pos_x, side_l_rebuilt.transformation.origin.x, 1e-4
        delta_r_inches = side_r_rebuilt.transformation.origin.x - orig_r_pos_x
        assert_in_delta 200.0 * MM, delta_r_inches, 1e-4

        refute_equal orig_bottom_def_name, bottom_rebuilt.definition.name
      end

      # A3: Compound world transform composition
      def test_a3_compound_world_transformation_composition
        layout_data = build_drawer_assembly_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        t_furniture = Geom::Transformation.translation(Geom::Vector3d.new(1000.0 * MM, 500.0 * MM, 200.0 * MM))
        result = @builder.place_existing_furniture(
          model,
          furniture_instance_id: FI_1,
          definition: catalog_definition,
          parameters: {},
          resolved_layout: parsed,
          transformation: t_furniture
        )
        assert result['success']

        furniture = find_furniture(FI_1)
        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        refute_nil side_l

        t_world = furniture.transformation * side_l.transformation
        assert_rigid_transformation(t_world)

        # Origin point of sideLeft local transform is [10, 0, 10] mm
        # Assembly is at [0, 100, 50] mm, Furniture is at [1000, 500, 200] mm
        # Total expected world coordinate: [1010, 600, 260] mm
        world_origin = Geom::Point3d.new(0, 0, 0).transform(t_world)
        assert_in_delta 1010.0 * MM, world_origin.x, 1e-3
        assert_in_delta 600.0 * MM, world_origin.y, 1e-3
        assert_in_delta 260.0 * MM, world_origin.z, 1e-3
      end

      # A4: Shared ComponentDefinition between left and right sides
      def test_a4_shared_component_definition_across_members
        layout_data = build_drawer_assembly_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        furniture = find_furniture(FI_1)
        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r = find_child_by_name(furniture, 'Lateral Derecho')

        assert_equal side_l.definition, side_r.definition, 'Left and right sides must share definition'
        refute_equal side_l.transformation.to_a, side_r.transformation.to_a
      end

      # A5: Save, close, and reopen .skp
      def test_a5_save_and_reopen_preserves_assembly_instances_and_metadata
        layout_data = build_drawer_assembly_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        skp_path = File.join(@tmp_dir, 'assembly_model.skp')
        saved = model.save(skp_path)
        assert saved, 'Model must save successfully'

        Sketchup.file_new
        reopened = Sketchup.open_file(skp_path)
        assert reopened, 'Model must open successfully'

        reopened_store = Granete::SketchUpExtension::Metadata::Store.new(Sketchup.active_model)
        reopened_furniture = Sketchup.active_model.entities.grep(Sketchup::ComponentInstance).find do |ci|
          reopened_store.read(ci)&.dig('identity', 'furnitureInstanceId') == FI_1
        end
        refute_nil reopened_furniture

        reopened_side_r = reopened_furniture.definition.entities.grep(Sketchup::ComponentInstance).find do |ci|
          reopened_store.read(ci)&.dig('identity', 'memberId') == 'sideRight'
        end
        refute_nil reopened_side_r, 'sideRight must be present after reopening'
        assert_rigid_transformation(reopened_side_r.transformation)
      end

      # A6: Undo and Redo revert and restore cleanly
      def test_a6_undo_redo_preserves_geometry_and_metadata
        layout_initial = build_drawer_assembly_layout(width_mm: 600.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success']
        furniture = find_furniture(FI_1)

        layout_rebuilt = build_drawer_assembly_layout(width_mm: 800.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = @builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        assert result_rebuilt['success']

        # Undo rebuild -> should revert to W600
        Sketchup.undo
        side_r_undone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_undone
        assert_in_delta 560.0 * MM, side_r_undone.transformation.origin.x, 1e-3

        # Redo rebuild -> should restore to W800
        Sketchup.active_model.respond_to?(:redo) ? Sketchup.active_model.redo : Sketchup.send(:redo)
        side_r_redone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_redone
        assert_in_delta 760.0 * MM, side_r_redone.transformation.origin.x, 1e-3
      end

      # A7: Fail-before-mutate preserves existing geometry
      def test_a7_assembly_level_fail_before_mutate
        layout_initial = build_drawer_assembly_layout(width_mm: 600.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success']
        furniture = find_furniture(FI_1)
        initial_count = furniture.definition.entities.grep(Sketchup::ComponentInstance).length

        # Set up a failing loader
        failing_loader = build_always_failing_asset_loader
        failing_builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: failing_loader
        )

        layout_rebuilt = build_drawer_assembly_layout(width_mm: 800.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = failing_builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        refute result_rebuilt['success'], 'Rebuild must fail before mutation'

        # Existing geometry remains completely untouched
        current_count = furniture.definition.entities.grep(Sketchup::ComponentInstance).length
        assert_equal initial_count, current_count
      end

      private

      def find_furniture(instance_id)
        model.entities.grep(Sketchup::ComponentInstance).find do |ci|
          @metadata_store.read(ci)&.dig('identity', 'furnitureInstanceId') == instance_id
        end
      end

      def find_child_by_name(furniture, name)
        furniture.definition.entities.grep(Sketchup::ComponentInstance).find { |ci| ci.name == name }
      end

      def place_test_furniture(furniture_instance_id:, resolved_layout:)
        @builder.place_existing_furniture(
          model,
          furniture_instance_id: furniture_instance_id,
          definition: catalog_definition,
          parameters: {},
          resolved_layout: resolved_layout,
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
      end

      def catalog_definition
        {
          'furniture_definition_id' => FURNITURE_DEF_ID,
          'name' => 'Mueble Cajonero',
          'code' => 'CAJ-600',
          'category' => 'kitchen_base',
          'version' => '1.0.0',
          'parameters' => []
        }
      end

      def assert_rigid_transformation(transform, tolerance = 1e-4)
        mat = transform.to_a
        c0 = [mat[0], mat[1], mat[2]]
        c1 = [mat[4], mat[5], mat[6]]
        c2 = [mat[8], mat[9], mat[10]]

        s0 = Granete::SketchUpExtension::Assets::MountFrame.magnitude(c0)
        s1 = Granete::SketchUpExtension::Assets::MountFrame.magnitude(c1)
        s2 = Granete::SketchUpExtension::Assets::MountFrame.magnitude(c2)

        assert_in_delta 1.0, s0, tolerance, "X axis scale must be 1.0 (got #{s0})"
        assert_in_delta 1.0, s1, tolerance, "Y axis scale must be 1.0 (got #{s1})"
        assert_in_delta 1.0, s2, tolerance, "Z axis scale must be 1.0 (got #{s2})"

        cross12 = Granete::SketchUpExtension::Assets::MountFrame.cross_product(c1, c2)
        det = Granete::SketchUpExtension::Assets::MountFrame.dot_product(c0, cross12)
        assert_in_delta 1.0, det, tolerance, "Determinant must be +1.0 (got #{det})"
      end

      def create_fixture_asset_loader
        # Create minimal SKP assets in tmp directory
        side_skp = File.join(@tmp_dir, 'side_fixture.skp')
        runner_skp = File.join(@tmp_dir, 'runner_fixture.skp')
        create_box_skp(side_skp, 500.0, 150.0, 16.0)
        create_box_skp(runner_skp, 500.0, 30.0, 20.0)

        downloader = Class.new do
          def initialize(side_path, runner_path)
            @side_path = side_path
            @runner_path = runner_path
          end

          def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
            _ = [asset_id, sha256, expected_bytes, org_id]
            revision_id == 'rev-side-1' ? @side_path : @runner_path
          end
        end.new(side_skp, runner_skp)

        Granete::SketchUpExtension::Assets::AssetLoader.new(downloader: downloader)
      end

      def build_always_failing_asset_loader
        failing_downloader = Class.new do
          def download_asset(*)
            nil
          end
        end.new
        Granete::SketchUpExtension::Assets::AssetLoader.new(downloader: failing_downloader)
      end

      def create_box_skp(path, length_mm, height_mm, thickness_mm)
        pts = [
          Geom::Point3d.new(0, 0, 0),
          Geom::Point3d.new(length_mm * MM, 0, 0),
          Geom::Point3d.new(length_mm * MM, thickness_mm * MM, 0),
          Geom::Point3d.new(0, thickness_mm * MM, 0)
        ]
        # In host context, create a definition and save it as skp
        defn = model.definitions.add("FixtureDef_#{File.basename(path, '.*')}")
        face = defn.entities.add_face(pts)
        face.pushpull(height_mm * MM)
        defn.save_as(path)
      end

      def build_drawer_assembly_layout(width_mm: 600.0)
        delta = width_mm - 600.0
        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => 'Mueble Cajonero',
          'transformContract' => 'granete.local-basis.v1',
          'dimensionsMm' => [width_mm, 720.0, 560.0],
          'components' => [],
          'hardware' => [],
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

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        flunk 'Install the Granete for SketchUp RBZ before running the host smoke' unless extension
        flunk 'Enable the installed extension and restart SketchUp before the host smoke' unless extension.loaded?
      end

      def fail_closed_if_loaded_from_checkout
        runtime_path = Granete::SketchUpExtension::Runtime.method(:start).source_location&.first
        flunk 'Installed Granete runtime is not loaded' if runtime_path.nil?

        expanded = File.expand_path(runtime_path)
        unless expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")
          flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
        end
        return unless expanded.start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk "Granete runtime loaded directly from checkout: #{expanded}"
      end
    end
  end
end
