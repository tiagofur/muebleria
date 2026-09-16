# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #668 Increment C1:
# Production consumption of 3D prepared rigid hardware assets (2-hole handle fixture)
# in SketchUp using MountFrame and derived AssetNormalization.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   H1: Horizontal handle placement (A-B = 96.0 mm, det = 1.0, scale = [1,1,1]).
#   H2: Vertical handle placement on same revision (rotated 90 deg, rigid, A-B = 96.0 mm).
#   H3: Non-identity MountFrame gate (displaced origin [25,-10,8], anchor reaches placement).
#   H4: Cabinet world transform preserves hardware rigidity.
#   H5: Two independent furniture instances sharing the same SKP asset definition.
#   H6: Save, close, and reopen .skp preserves hardware instances and transforms.
#   H7: Undo and Redo revert and restore state cleanly.
#   H8: Controlled failure during rebuild (fail-before-mutate preserves existing geometry).
module Granete
  module SketchUpExtension
    class TC_HardwareMountRigidPlacementSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'
      FURNITURE_DEF_ID = '50000000-0000-0000-0000-0000000000d1'

      HANDLE_ASSET_ID = 'ha-tirador-bar-96'
      HANDLE_REVISION_R2 = 'hr-tirador-bar-96-r2'
      HANDLE_REVISION_R1 = 'hr-tirador-bar-96-r1'
      HANDLE_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @tmp_dir = Dir.mktmpdir('granete-rigid-placement-smoke')
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

      # H1: Horizontal handle placement
      def test_h1_horizontal_handle_rigid_placement
        placement_target = [100.0, 20.0, 300.0]
        mount_frame = identity_mount_frame
        placement = create_hardware_placement(
          placement_id: 'hp-handle-h1',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success'], "placement failed: #{result['error']}"

        hw_instance = find_hardware_instance(FI_1, 'hp-handle-h1')
        refute_nil hw_instance, 'hardware component instance must exist'

        assert_rigid_transformation(hw_instance.transformation)
        assert_anchor_at(hw_instance, [0.0, 0.0, 0.0], placement_target)
        assert_hole_distance_preserved(hw_instance, [0.0, 0.0, 0.0], [96.0, 0.0, 0.0], 96.0)
      end

      # H2: Vertical handle placement on same revision (rotated 90 deg)
      def test_h2_vertical_handle_rigid_placement
        placement_target = [100.0, 20.0, 300.0]
        mount_frame = identity_mount_frame
        placement = create_hardware_placement(
          placement_id: 'hp-handle-h2',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 90.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success'], "placement failed: #{result['error']}"

        hw_instance = find_hardware_instance(FI_1, 'hp-handle-h2')
        refute_nil hw_instance, 'hardware component instance must exist'

        assert_rigid_transformation(hw_instance.transformation)
        assert_anchor_at(hw_instance, [0.0, 0.0, 0.0], placement_target)
        assert_hole_distance_preserved(hw_instance, [0.0, 0.0, 0.0], [96.0, 0.0, 0.0], 96.0)
      end

      # H3: Non-identity MountFrame gate (displaced origin [25,-10,8], anchor reaches placement)
      def test_h3_displaced_origin_mount_frame_reaches_placement_gate
        displaced_origin = [25.0, -10.0, 8.0]
        hole_a_asset = [25.0, -10.0, 8.0]
        hole_b_asset = [121.0, -10.0, 8.0] # 96 mm spacing in asset space
        placement_target = [150.0, 50.0, 400.0]

        mount_frame = Granete::SketchUpExtension::Assets::MountFrame::MountFrameData.new(
          origin_mm: displaced_origin,
          basis: Granete::SketchUpExtension::Assets::MountFrame::BasisData.new(
            x: [1.0, 0.0, 0.0],
            y: [0.0, 1.0, 0.0],
            z: [0.0, 0.0, 1.0]
          )
        )

        placement = create_hardware_placement(
          placement_id: 'hp-handle-h3',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success'], "placement failed: #{result['error']}"

        hw_instance = find_hardware_instance(FI_1, 'hp-handle-h3')
        refute_nil hw_instance, 'hardware component instance must exist'

        assert_rigid_transformation(hw_instance.transformation)
        # In asset space, hole A is at displaced_origin. It MUST transform to placement_target.
        assert_anchor_at(hw_instance, hole_a_asset, placement_target)
        # Hole B must transform preserving exactly 96.0 mm distance
        assert_hole_distance_preserved(hw_instance, hole_a_asset, hole_b_asset, 96.0)
      end

      # H4: Cabinet world transform preserves hardware rigidity
      def test_h4_cabinet_world_transform_preserves_hardware_rigidity
        placement_target = [100.0, 20.0, 300.0]
        mount_frame = identity_mount_frame
        placement = create_hardware_placement(
          placement_id: 'hp-handle-h4',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        cabinet_contract = {
          'translation_mm' => [1200.0, -300.0, 50.0],
          'rotation_deg' => [0.0, 0.0, 45.0]
        }
        cabinet_transform = Granete::SketchUpExtension::ProjectFurniture::TransformContract.to_host(cabinet_contract)

        result = place_furniture_with_hardware(
          furniture_instance_id: FI_1,
          hardware: [placement],
          transformation: cabinet_transform
        )
        assert result['success'], "placement failed: #{result['error']}"

        hw_instance = find_hardware_instance(FI_1, 'hp-handle-h4')
        refute_nil hw_instance

        # Local transform inside cabinet definition
        assert_rigid_transformation(hw_instance.transformation)

        # World transform (cabinet * local)
        furniture_root = result['entity']
        world_hw_transform = furniture_root.transformation * hw_instance.transformation
        assert_rigid_transformation(world_hw_transform)
      end

      # H5: Two independent furniture instances sharing definition
      def test_h5_two_independent_furniture_instances_share_definition
        mount_frame = identity_mount_frame
        hw1 = create_hardware_placement(
          placement_id: 'hp-handle-fi1',
          position_mm: [100.0, 20.0, 300.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )
        hw2 = create_hardware_placement(
          placement_id: 'hp-handle-fi2',
          position_mm: [200.0, 20.0, 500.0],
          rotation_deg: [0.0, 0.0, 90.0],
          mount_frame: mount_frame
        )

        res1 = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [hw1])
        res2 = place_furniture_with_hardware(furniture_instance_id: FI_2, hardware: [hw2])
        assert res1['success'] && res2['success']

        inst1 = find_hardware_instance(FI_1, 'hp-handle-fi1')
        inst2 = find_hardware_instance(FI_2, 'hp-handle-fi2')
        refute_nil inst1
        refute_nil inst2

        # Both instances must share the same ComponentDefinition
        assert_equal inst1.definition, inst2.definition, 'both cabinets must reuse the same hardware definition'
        # But their transformations are independent
        refute_equal inst1.transformation.to_a, inst2.transformation.to_a
      end

      # H6: Save, close, and reopen .skp preserves hardware instances and transforms
      def test_h6_placed_hardware_survives_save_close_and_reopen
        path = File.join(@tmp_dir, 'cabinet_with_hardware.skp')
        mount_frame = identity_mount_frame
        placement = create_hardware_placement(
          placement_id: 'hp-handle-h6',
          position_mm: [100.0, 20.0, 300.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success']

        original_transform = find_hardware_instance(FI_1, 'hp-handle-h6').transformation.to_a

        assert model.save(path), 'host must save model'
        Sketchup.file_new
        assert Sketchup.open_file(path), 'host must reopen model'

        reopened_metadata_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        located = Granete::SketchUpExtension::ProjectFurniture::ManagedFurniture.locate(
          model, reopened_metadata_store, FI_1
        )
        refute_nil located['entity']

        reopened_hw = find_hardware_instance_in_entity(located['entity'], reopened_metadata_store, 'hp-handle-h6')
        refute_nil reopened_hw, 'hardware instance must persist across reopen'
        assert_equal original_transform, reopened_hw.transformation.to_a
      end

      # H7: Undo and Redo
      def test_h7_undo_and_redo_rebuild
        mount_frame = identity_mount_frame
        placement = create_hardware_placement(
          placement_id: 'hp-handle-h7',
          position_mm: [100.0, 20.0, 300.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success']
        refute_nil find_hardware_instance(FI_1, 'hp-handle-h7')

        # Undo placement
        assert Sketchup.undo, 'undo must succeed'
        assert_nil find_hardware_instance(FI_1, 'hp-handle-h7'), 'hardware must be removed on undo'

        # Redo placement
        assert Sketchup.redo, 'redo must succeed'
        refute_nil find_hardware_instance(FI_1, 'hp-handle-h7'), 'hardware must be restored on redo'
      end

      # H8: Controlled failure during rebuild (fail-before-mutate preserves existing geometry)
      def test_h8_fail_before_mutate_on_invalid_preparation
        valid_placement = create_hardware_placement(
          placement_id: 'hp-handle-valid',
          position_mm: [100.0, 20.0, 300.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: identity_mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [valid_placement])
        assert result['success']

        root_entity = result['entity']
        prev_hw = find_hardware_instance(FI_1, 'hp-handle-valid')
        refute_nil prev_hw, 'previous hardware instance must exist'
        assert prev_hw.valid?, 'previous hardware instance must be valid'

        # Capture geometry, definition, metadata, and entity hierarchy before failed rebuild
        prev_hw_def = prev_hw.definition
        prev_hw_transform = prev_hw.transformation.to_a
        initial_entity_ids = root_entity.definition.entities.map(&:persistent_id)
        refute_empty initial_entity_ids

        # Attempt rebuild with invalid MountFrame basis (non-orthogonal)
        invalid_mount_frame = Granete::SketchUpExtension::Assets::MountFrame::MountFrameData.new(
          origin_mm: [0.0, 0.0, 0.0],
          basis: Granete::SketchUpExtension::Assets::MountFrame::BasisData.new(
            x: [1.0, 0.0, 0.0],
            y: [1.0, 0.0, 0.0], # parallel to x! Non-orthogonal and det = 0
            z: [0.0, 0.0, 1.0]
          )
        )
        invalid_placement = create_hardware_placement(
          placement_id: 'hp-handle-invalid',
          position_mm: [100.0, 20.0, 300.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: invalid_mount_frame
        )

        update_result = place_furniture_with_hardware(
          furniture_instance_id: FI_1,
          hardware: [invalid_placement],
          operation: :update
        )

        refute update_result['success'], 'update with invalid preparation must fail'
        assert_equal 'asset_preparation_invalid', update_result['error']

        # Precision 2 Invariants after failed rebuild:
        # 1. Previous handle is still the real one and still valid
        assert prev_hw.valid?, 'previous handle ComponentInstance must still be valid'
        assert_equal prev_hw_def, prev_hw.definition, 'handle definition must still be the real handle'
        assert_equal prev_hw_transform, prev_hw.transformation.to_a, 'handle transform must remain unchanged'

        # 2. assetId/revisionId/placementId did not change
        post_meta = @metadata_store.read(prev_hw)
        assert_equal HANDLE_ASSET_ID, post_meta.dig('intent', 'assetId')
        assert_equal HANDLE_REVISION_R2, post_meta.dig('intent', 'assetRevisionId')
        assert_equal 'hp-handle-valid', post_meta.dig('identity', 'hardwarePlacementId')
        assert_equal 'mesh', post_meta.dig('intent', 'representation')
        assert_equal 'prepared', post_meta.dig('intent', 'preparationState')

        # 3. No proxy/cube appeared
        proxies = root_entity.definition.entities.grep(Sketchup::ComponentInstance).select do |ci|
          @metadata_store.read(ci)&.dig('intent', 'representation') == 'proxy' || ci.definition.name.include?('Proxy')
        end
        assert_empty proxies, 'no proxy or placeholder cube must appear'

        # 4. No partial children left behind
        current_entity_ids = root_entity.definition.entities.map(&:persistent_id)
        assert_equal initial_entity_ids, current_entity_ids,
                     'existing entities must survive intact without partial children'

        # 5. Undo stack remains coherent
        assert Sketchup.undo, 'undo must succeed and revert initial placement cleanly'
      end

      private

      def model
        Sketchup.active_model
      end

      def identity_mount_frame
        Granete::SketchUpExtension::Assets::MountFrame::MountFrameData.new(
          origin_mm: [0.0, 0.0, 0.0],
          basis: Granete::SketchUpExtension::Assets::MountFrame::BasisData.new(
            x: [1.0, 0.0, 0.0],
            y: [0.0, 1.0, 0.0],
            z: [0.0, 0.0, 1.0]
          )
        )
      end

      def create_hardware_placement(placement_id:, position_mm:, rotation_deg:, mount_frame:)
        Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
          'hardwarePlacementId' => placement_id,
          'hardwareDefinitionId' => 'hd-tirador-bar-96',
          'pieceType' => 'door',
          'face' => 'exterior',
          'position' => { 'x' => position_mm[0], 'y' => position_mm[1], 'z' => position_mm[2] },
          'rotation' => { 'x' => rotation_deg[0], 'y' => rotation_deg[1], 'z' => rotation_deg[2] },
          'assetId' => HANDLE_ASSET_ID,
          'assetRevisionId' => HANDLE_REVISION_R2,
          'sha256' => HANDLE_SHA256,
          'preparationState' => 'prepared',
          'mountFrame' => mount_frame.to_h
        )
      end

      def place_furniture_with_hardware(furniture_instance_id:, hardware:, transformation: nil, operation: :place)
        resolved_data = {
          'panels' => [
            {
              'partId' => 'p-door',
              'name' => 'Puerta',
              'pieceType' => 'door',
              'dimensions' => { 'widthMm' => 596.0, 'heightMm' => 716.0, 'thicknessMm' => 18.0 },
              'transform' => {
                'x' => [1.0, 0.0, 0.0],
                'y' => [0.0, 1.0, 0.0],
                'z' => [0.0, 0.0, 1.0],
                'origin' => [0.0, 0.0, 0.0]
              }
            }
          ],
          'hardware' => hardware
        }

        if operation == :update
          @builder.update_furniture(
            model,
            furniture_instance_id: furniture_instance_id,
            definition: catalog_definition,
            resolved: resolved_data
          )
        else
          @builder.place_existing_furniture(
            model,
            furniture_instance_id: furniture_instance_id,
            definition: catalog_definition,
            resolved: resolved_data,
            project_id: PROJECT_ID,
            design_id: DESIGN_ID,
            transformation: transformation
          )
        end
      end

      def find_hardware_instance(furniture_instance_id, placement_id)
        furniture = top_level_furniture.find do |entity|
          @metadata_store.read(entity)&.dig('identity', 'furnitureInstanceId') == furniture_instance_id
        end
        return nil unless furniture

        find_hardware_instance_in_entity(furniture, @metadata_store, placement_id)
      end

      def find_hardware_instance_in_entity(furniture_entity, metadata_store, placement_id)
        furniture_entity.definition.entities.grep(Sketchup::ComponentInstance).find do |ci|
          meta = metadata_store.read(ci)
          meta.is_a?(Hash) && meta.dig('identity', 'hardwarePlacementId') == placement_id
        end
      end

      def top_level_furniture
        store = @metadata_store
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          metadata = store.read(entity)
          metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'
        end
      end

      def catalog_definition
        {
          'furniture_definition_id' => FURNITURE_DEF_ID,
          'code' => 'BASE-600',
          'name' => 'Gabinete Base 600',
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

      def assert_anchor_at(hw_instance, local_point_mm, expected_target_mm, tolerance = 1e-3)
        pt_local_inches = Geom::Point3d.new(
          local_point_mm[0] / 25.4,
          local_point_mm[1] / 25.4,
          local_point_mm[2] / 25.4
        )
        pt_transformed = pt_local_inches.transform(hw_instance.transformation)
        actual_mm = [
          pt_transformed.x * 25.4,
          pt_transformed.y * 25.4,
          pt_transformed.z * 25.4
        ]

        assert_in_delta expected_target_mm[0], actual_mm[0], tolerance, 'X coord mismatch'
        assert_in_delta expected_target_mm[1], actual_mm[1], tolerance, 'Y coord mismatch'
        assert_in_delta expected_target_mm[2], actual_mm[2], tolerance, 'Z coord mismatch'
      end

      def assert_hole_distance_preserved(hw_instance, local_a_mm, local_b_mm, expected_distance_mm, tolerance = 1e-3)
        pt_a_local = Geom::Point3d.new(local_a_mm[0] / 25.4, local_a_mm[1] / 25.4, local_a_mm[2] / 25.4)
        pt_b_local = Geom::Point3d.new(local_b_mm[0] / 25.4, local_b_mm[1] / 25.4, local_b_mm[2] / 25.4)

        pt_a_trans = pt_a_local.transform(hw_instance.transformation)
        pt_b_trans = pt_b_local.transform(hw_instance.transformation)

        dist_mm = pt_a_trans.distance(pt_b_trans) * 25.4
        assert_in_delta expected_distance_mm, dist_mm, tolerance,
                        "Hole distance must be preserved at #{expected_distance_mm} mm (got #{dist_mm})"
      end

      def create_fixture_asset_loader
        # Creates a mock or local asset loader that generates a real test ComponentDefinition
        # in model.definitions so SketchUp has real geometry to place.
        comp_def = model.definitions.add("Granete · Herraje · #{HANDLE_ASSET_ID}")
        # Add basic geometry to the definition
        pts = [
          Geom::Point3d.new(0, 0, 0),
          Geom::Point3d.new(96.0 / 25.4, 0, 0),
          Geom::Point3d.new(96.0 / 25.4, 10.0 / 25.4, 0),
          Geom::Point3d.new(0, 10.0 / 25.4, 0)
        ]
        comp_def.entities.add_face(pts)

        loader = Granete::SketchUpExtension::Assets::AssetLoader.new
        # Stub ensure_definition to return the real component definition
        loader.define_singleton_method(:ensure_definition) do |_model, _binding|
          comp_def
        end
        loader
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
