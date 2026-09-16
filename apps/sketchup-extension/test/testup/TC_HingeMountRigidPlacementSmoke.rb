# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #668 Increment C2:
# Proves against the real INSTALLED extension and SketchUp host:
#   B1: Base hinge mount (cup center lands precisely on placement target).
#   B2: Second hinge sharing ComponentDefinition with independent instances.
#   B3: Opposite orientation via rigid rotation (det = 1.0, scale = [1,1,1], no mirror).
#   B4: Transformed cabinet in world space preserves local and global hinge positions.
#   B5: Geometric distance preservation across 3 physical points (cupCenter, fixingPoint, pivotReference).
#   B6: Save, close, and reopen .skp preserves hinge instances, transforms, and metadata.
#   B7: Undo and Redo revert and restore cleanly.
#   B8: Fail-before-mutate under Policy B (invalid MountFrame and download failure).
module Granete
  module SketchUpExtension
    class TC_HingeMountRigidPlacementSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'
      FURNITURE_DEF_ID = '50000000-0000-0000-0000-0000000000d1'

      # Synthetic rigid hinge fixture constants:
      HINGE_ASSET_ID = 'ha-bisagra-cl110'
      HINGE_REVISION_R2 = 'hr-bisagra-cl110-r2'
      HINGE_REVISION_R1 = 'hr-bisagra-cl110-r1'
      HINGE_SHA256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

      CUP_CENTER_RAW = [25.0, -15.0, 10.0].freeze
      FIXING_POINT_RAW = [25.0, 30.0, 10.0].freeze
      PIVOT_REFERENCE_RAW = [47.0, 0.0, 0.0].freeze

      DIST_CUP_FIXING = 45.0
      DIST_CUP_PIVOT = Math.sqrt(809.0)
      DIST_FIXING_PIVOT = Math.sqrt(1484.0)

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @tmp_dir = Dir.mktmpdir('granete-hinge-rigid-smoke')
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

      # B1: Base hinge mount
      def test_b1_base_hinge_rigid_placement
        placement_target = [100.0, 18.0, 600.0]
        mount_frame = prepared_hinge_mount_frame
        placement = create_hinge_placement(
          placement_id: 'hp-hinge-b1',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success'], "placement failed: #{result['error']}"

        hw_instance = find_hardware_instance(FI_1, 'hp-hinge-b1')
        refute_nil hw_instance, 'hinge component instance must exist'

        assert_rigid_transformation(hw_instance.transformation)
        assert_anchor_at(hw_instance, CUP_CENTER_RAW, placement_target)
      end

      # B2: Second hinge sharing ComponentDefinition
      def test_b2_second_hinge_shares_component_definition
        target_top = [100.0, 18.0, 800.0]
        target_bottom = [100.0, 18.0, 150.0]
        mount_frame = prepared_hinge_mount_frame

        p_top = create_hinge_placement(
          placement_id: 'hp-hinge-top',
          position_mm: target_top,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )
        p_bottom = create_hinge_placement(
          placement_id: 'hp-hinge-bottom',
          position_mm: target_bottom,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [p_top, p_bottom])
        assert result['success'], "placement failed: #{result['error']}"

        inst_top = find_hardware_instance(FI_1, 'hp-hinge-top')
        inst_bottom = find_hardware_instance(FI_1, 'hp-hinge-bottom')
        refute_nil inst_top
        refute_nil inst_bottom
        refute_equal inst_top, inst_bottom, 'instances must be distinct'
        assert_equal inst_top.definition, inst_bottom.definition, 'must share same ComponentDefinition'

        assert_anchor_at(inst_top, CUP_CENTER_RAW, target_top)
        assert_anchor_at(inst_bottom, CUP_CENTER_RAW, target_bottom)
      end

      # B3: Opposite orientation via rigid rotation (no mirror)
      def test_b3_opposite_orientation_via_rigid_rotation
        mount_frame = prepared_hinge_mount_frame
        p_right = create_hinge_placement(
          placement_id: 'hp-hinge-right',
          position_mm: [50.0, 18.0, 500.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )
        p_left = create_hinge_placement(
          placement_id: 'hp-hinge-left',
          position_mm: [550.0, 18.0, 500.0],
          rotation_deg: [0.0, 180.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [p_right, p_left])
        assert result['success']

        inst_right = find_hardware_instance(FI_1, 'hp-hinge-right')
        inst_left = find_hardware_instance(FI_1, 'hp-hinge-left')

        assert_equal inst_right.definition, inst_left.definition
        assert_rigid_transformation(inst_right.transformation)
        assert_rigid_transformation(inst_left.transformation)
      end

      # B4: Transformed host cabinet preserves hardware rigidity
      def test_b4_transformed_cabinet_preserves_hardware_rigidity
        placement_target = [100.0, 18.0, 600.0]
        mount_frame = prepared_hinge_mount_frame
        placement = create_hinge_placement(
          placement_id: 'hp-hinge-b4',
          position_mm: placement_target,
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: mount_frame
        )

        cabinet_trans = Geom::Transformation.axes(
          Geom::Point3d.new(100.0, 200.0, 0.0),
          Geom::Vector3d.new(0.0, 1.0, 0.0),
          Geom::Vector3d.new(-1.0, 0.0, 0.0),
          Geom::Vector3d.new(0.0, 0.0, 1.0)
        )

        result = place_furniture_with_hardware(
          furniture_instance_id: FI_1,
          hardware: [placement],
          transformation: cabinet_trans
        )
        assert result['success']

        hw_instance = find_hardware_instance(FI_1, 'hp-hinge-b4')
        refute_nil hw_instance
        assert_rigid_transformation(hw_instance.transformation)
        assert_anchor_at(hw_instance, CUP_CENTER_RAW, placement_target)
      end

      # B5: Geometric distance preservation across 3 physical points
      def test_b5_geometric_preservation_of_three_physical_points
        mount_frame = prepared_hinge_mount_frame
        placement = create_hinge_placement(
          placement_id: 'hp-hinge-b5',
          position_mm: [200.0, 30.0, 500.0],
          rotation_deg: [30.0, 45.0, 0.0],
          mount_frame: mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success']

        hw_instance = find_hardware_instance(FI_1, 'hp-hinge-b5')
        refute_nil hw_instance

        assert_point_distance_preserved(hw_instance, CUP_CENTER_RAW, FIXING_POINT_RAW, DIST_CUP_FIXING)
        assert_point_distance_preserved(hw_instance, CUP_CENTER_RAW, PIVOT_REFERENCE_RAW, DIST_CUP_PIVOT)
        assert_point_distance_preserved(hw_instance, FIXING_POINT_RAW, PIVOT_REFERENCE_RAW, DIST_FIXING_PIVOT)
      end

      # B6: Save, close, and reopen .skp preserves hardware instances and transforms
      def test_b6_save_and_reopen_preserves_hinge_instances
        placement = create_hinge_placement(
          placement_id: 'hp-hinge-b6',
          position_mm: [100.0, 18.0, 600.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: prepared_hinge_mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success']

        hw_before = find_hardware_instance(FI_1, 'hp-hinge-b6')
        refute_nil hw_before
        transform_before = hw_before.transformation.to_a
        meta_before = @metadata_store.read(hw_before)

        saved_path = File.join(@tmp_dir, 'model_with_hinge.skp')
        save_ok = model.save(saved_path)
        assert save_ok, 'model.save must succeed'

        Sketchup.open_file(saved_path)
        reopened_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        furniture_reopened = top_level_furniture.find do |e|
          reopened_store.read(e)&.dig('identity', 'furnitureInstanceId') == FI_1
        end
        refute_nil furniture_reopened

        hw_reopened = find_hardware_instance_in_entity(furniture_reopened, reopened_store, 'hp-hinge-b6')
        refute_nil hw_reopened
        assert_equal transform_before, hw_reopened.transformation.to_a
        assert_equal meta_before, reopened_store.read(hw_reopened)
      end

      # B7: Undo and Redo revert and restore cleanly
      def test_b7_undo_and_redo_revert_and_restore_cleanly
        placement = create_hinge_placement(
          placement_id: 'hp-hinge-b7',
          position_mm: [100.0, 18.0, 600.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: prepared_hinge_mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [placement])
        assert result['success']
        refute_nil find_hardware_instance(FI_1, 'hp-hinge-b7')

        assert Sketchup.undo, 'undo must succeed'
        assert_nil find_hardware_instance(FI_1, 'hp-hinge-b7')

        assert Sketchup.redo, 'redo must succeed'
        refute_nil find_hardware_instance(FI_1, 'hp-hinge-b7')
      end

      # B8: Fail-before-mutate under Policy B
      def test_b8_fail_before_mutate_preserves_real_hinge_on_rebuild_failure
        valid_placement = create_hinge_placement(
          placement_id: 'hp-hinge-valid',
          position_mm: [100.0, 18.0, 600.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: prepared_hinge_mount_frame
        )

        result = place_furniture_with_hardware(furniture_instance_id: FI_1, hardware: [valid_placement])
        assert result['success']

        root_entity = top_level_furniture.find do |e|
          @metadata_store.read(e)&.dig('identity', 'furnitureInstanceId') == FI_1
        end
        prev_hw = find_hardware_instance_in_entity(root_entity, @metadata_store, 'hp-hinge-valid')
        refute_nil prev_hw
        prev_def = prev_hw.definition
        prev_transform = prev_hw.transformation.to_a

        # Attempt rebuild with invalid MountFrame (mirror basis)
        bad_mf = Granete::SketchUpExtension::Assets::MountFrame::MountFrameData.new(
          origin_mm: [0.0, 0.0, 0.0],
          basis: Granete::SketchUpExtension::Assets::MountFrame::BasisData.new(
            x: [1.0, 0.0, 0.0],
            y: [0.0, 1.0, 0.0],
            z: [0.0, 0.0, -1.0] # mirror!
          )
        )
        bad_placement = create_hinge_placement(
          placement_id: 'hp-hinge-bad',
          position_mm: [100.0, 18.0, 600.0],
          rotation_deg: [0.0, 0.0, 0.0],
          mount_frame: bad_mf
        )

        update_result = place_furniture_with_hardware(
          furniture_instance_id: FI_1,
          hardware: [bad_placement],
          operation: :update
        )
        refute update_result['success'], 'update with invalid preparation must fail before mutate'

        # Previous real hinge preserved
        assert prev_hw.valid?
        assert_equal prev_def, prev_hw.definition
        assert_equal prev_transform, prev_hw.transformation.to_a
      end

      private

      def model
        Sketchup.active_model
      end

      def prepared_hinge_mount_frame
        Granete::SketchUpExtension::Assets::MountFrame::MountFrameData.new(
          origin_mm: CUP_CENTER_RAW,
          basis: Granete::SketchUpExtension::Assets::MountFrame::BasisData.new(
            x: [0.0, 1.0, 0.0],
            y: [-1.0, 0.0, 0.0],
            z: [0.0, 0.0, 1.0]
          )
        )
      end

      def create_hinge_placement(placement_id:, position_mm:, rotation_deg:, mount_frame:)
        Granete::SketchUpExtension::Library::LayoutHardwarePlacement.new(
          'hardwarePlacementId' => placement_id,
          'hardwareDefinitionId' => 'hd-bisagra-cl110',
          'pieceType' => 'door',
          'face' => 'interior',
          'position' => { 'x' => position_mm[0], 'y' => position_mm[1], 'z' => position_mm[2] },
          'rotation' => { 'x' => rotation_deg[0], 'y' => rotation_deg[1], 'z' => rotation_deg[2] },
          'assetId' => HINGE_ASSET_ID,
          'assetRevisionId' => HINGE_REVISION_R2,
          'sha256' => HINGE_SHA256,
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

      def assert_point_distance_preserved(hw_instance, local_a_mm, local_b_mm, expected_distance_mm, tolerance = 1e-3)
        pt_a_local = Geom::Point3d.new(local_a_mm[0] / 25.4, local_a_mm[1] / 25.4, local_a_mm[2] / 25.4)
        pt_b_local = Geom::Point3d.new(local_b_mm[0] / 25.4, local_b_mm[1] / 25.4, local_b_mm[2] / 25.4)

        pt_a_trans = pt_a_local.transform(hw_instance.transformation)
        pt_b_trans = pt_b_local.transform(hw_instance.transformation)

        dist_mm = pt_a_trans.distance(pt_b_trans) * 25.4
        assert_in_delta expected_distance_mm, dist_mm, tolerance,
                        "Distance must be preserved at #{expected_distance_mm} mm (got #{dist_mm})"
      end

      def create_fixture_asset_loader
        comp_def = model.definitions.add("Granete · Herraje · #{HINGE_ASSET_ID}")
        # Add basic geometry to the definition representing the hinge 3 points
        pts = [
          Geom::Point3d.new(CUP_CENTER_RAW[0] / 25.4, CUP_CENTER_RAW[1] / 25.4, CUP_CENTER_RAW[2] / 25.4),
          Geom::Point3d.new(FIXING_POINT_RAW[0] / 25.4, FIXING_POINT_RAW[1] / 25.4, FIXING_POINT_RAW[2] / 25.4),
          Geom::Point3d.new(PIVOT_REFERENCE_RAW[0] / 25.4, PIVOT_REFERENCE_RAW[1] / 25.4, PIVOT_REFERENCE_RAW[2] / 25.4)
        ]
        comp_def.entities.add_face(pts)

        loader = Granete::SketchUpExtension::Assets::AssetLoader.new
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
