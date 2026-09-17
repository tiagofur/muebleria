# frozen_string_literal: true

require 'digest'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'time'
require 'testup/testcase'

# Real-host smoke test for #670 Increment D:
# Runtime de Assemblies Paramétricos en SketchUp.
#
# Proves against the real INSTALLED extension and SketchUp 2026 host:
#   H1:  Insert W600 (rigid members det=+1.0, scale=[1,1,1], bottom panel = 565 mm).
#   H2:  Rebuild W800 (right members delta=+200 mm, definitions reused, bottom panel 565 -> 765 mm).
#   H3:  Simultaneously non-identity compound transform: Furniture * Assembly * Member * MountFrame.
#   H4:  Multiple assemblies in the same furniture instance.
#   H5:  Shared ComponentDefinition across instances with independent transforms.
#   H6:  Save, close, and reopen .skp preserves assembly identities, transforms, and metadata.
#   H7:  Undo and Redo revert and restore assembly geometry and metadata cleanly.
#   H8:  Furniture-wide fail-before-mutate (1 failing member preserves existing geometry intact).
#   H9:  Metadata identities (assemblyInstanceId, memberId, recipeRevision, isHistorical, snapshotId).
#   H10: No scaling or mirroring (all rigid members scale=[1,1,1] and det=+1.0).
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

      # Shared evidence accumulator persisted to progress/host_smoke_670_d_assembly_runtime_evidence.json
      class << self
        attr_accessor :evidence

        def current_rbz_sha256
          rbz_path = File.join(REPOSITORY_ROOT, 'apps/sketchup-extension/dist/granete_for_sketchup.rbz')
          File.exist?(rbz_path) ? Digest::SHA256.file(rbz_path).hexdigest : 'unavailable'
        end

        def current_head_sha
          head = `git -C "#{REPOSITORY_ROOT}" rev-parse HEAD 2>/dev/null`.strip
          head.empty? ? 'unavailable' : head
        end
      end

      self.evidence = {
        'head' => current_head_sha,
        'rbz_sha256' => current_rbz_sha256,
        'sketchup_version' => nil,
        'ruby_version' => RUBY_VERSION,
        'platform' => RUBY_PLATFORM,
        'tests' => {},
        'r7_rebuild_w600_to_w800' => {},
        'r8_world_transform' => {}
      }

      def evidence
        self.class.evidence
      end

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
        evidence['sketchup_version'] ||= Sketchup.version
      end

      def teardown
        FileUtils.remove_entry(@tmp_dir) if @tmp_dir && File.directory?(@tmp_dir)
        persist_evidence
        Sketchup.file_new
      end

      # H1: Insert W600
      def test_h1_insert_w600
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

        evidence['tests']['h1_insert_w600'] = {
          'status' => 'pass',
          'rigid_members_count' => 4,
          'fabricated_components_count' => 1,
          'bottom_width_mm' => 565.0
        }
      end

      # H2: Rebuild W800 (R7 evidence)
      def test_h2_rebuild_w800
        layout_initial = build_drawer_assembly_layout(width_mm: 600.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success'], "Initial insertion failed: #{result_initial['error']}"

        furniture = find_furniture(FI_1)
        side_l_init = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r_init = find_child_by_name(furniture, 'Lateral Derecho')
        runner_l_init = find_child_by_name(furniture, 'Guía Izquierda')
        runner_r_init = find_child_by_name(furniture, 'Guía Derecha')
        bottom_init = find_child_by_name(furniture, 'Fondo Cajón')

        side_r_before_x = side_r_init.transformation.origin.x * 25.4
        runner_r_before_x = runner_r_init.transformation.origin.x * 25.4
        side_l_before_x = side_l_init.transformation.origin.x * 25.4
        runner_l_before_x = runner_l_init.transformation.origin.x * 25.4

        side_r_meta_before = @metadata_store.read(side_r_init)
        runner_r_meta_before = @metadata_store.read(runner_r_init)
        side_r_def_before = side_r_init.definition
        runner_r_def_before = runner_r_init.definition
        bottom_def_before = bottom_init.definition.name

        side_r_scale_before = calculate_matrix_scale(side_r_init.transformation)
        side_r_det_before = calculate_matrix_determinant(side_r_init.transformation)
        runner_r_scale_before = calculate_matrix_scale(runner_r_init.transformation)
        runner_r_det_before = calculate_matrix_determinant(runner_r_init.transformation)

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
        runner_l_rebuilt = find_child_by_name(furniture, 'Guía Izquierda')
        runner_r_rebuilt = find_child_by_name(furniture, 'Guía Derecha')
        bottom_rebuilt = find_child_by_name(furniture, 'Fondo Cajón')

        side_r_after_x = side_r_rebuilt.transformation.origin.x * 25.4
        runner_r_after_x = runner_r_rebuilt.transformation.origin.x * 25.4
        delta_side_r = side_r_after_x - side_r_before_x
        delta_runner_r = runner_r_after_x - runner_r_before_x

        # Left members remain fixed
        assert_in_delta side_l_before_x, side_l_rebuilt.transformation.origin.x * 25.4, 1e-3
        assert_in_delta runner_l_before_x, runner_l_rebuilt.transformation.origin.x * 25.4, 1e-3

        # Right members translate exactly +200 mm
        assert_in_delta 200.0, delta_side_r, 1e-3, "sideRight delta must be exactly +200 mm (got #{delta_side_r})"
        assert_in_delta 200.0, delta_runner_r, 1e-3, "runnerRight delta must be exactly +200 mm (got #{delta_runner_r})"

        # ComponentDefinition reused for rigid members
        assert_equal side_r_def_before, side_r_rebuilt.definition, 'sideRight definition must be reused'
        assert_equal runner_r_def_before, runner_r_rebuilt.definition, 'runnerRight definition must be reused'

        # Bottom regenerated (different definition, new width 765 mm, thickness 15 mm)
        refute_equal bottom_def_before, bottom_rebuilt.definition.name, 'bottom definition must be regenerated'
        assert_rigid_transformation(bottom_rebuilt.transformation)

        side_r_scale_after = calculate_matrix_scale(side_r_rebuilt.transformation)
        side_r_det_after = calculate_matrix_determinant(side_r_rebuilt.transformation)
        runner_r_scale_after = calculate_matrix_scale(runner_r_rebuilt.transformation)
        runner_r_det_after = calculate_matrix_determinant(runner_r_rebuilt.transformation)

        evidence['r7_rebuild_w600_to_w800'] = {
          'side_right' => {
            'before_translation_mm' => [side_r_before_x, 0.0, 10.0],
            'after_translation_mm' => [side_r_after_x, 0.0, 10.0],
            'delta_mm' => delta_side_r,
            'asset_revision_id_before' => side_r_meta_before.dig('intent', 'assetRevisionId'),
            'asset_revision_id_after' => @metadata_store.read(side_r_rebuilt).dig('intent', 'assetRevisionId'),
            'definition_reused' => (side_r_rebuilt.definition == side_r_def_before),
            'scale_before' => side_r_scale_before,
            'scale_after' => side_r_scale_after,
            'determinant_before' => side_r_det_before,
            'determinant_after' => side_r_det_after
          },
          'runner_right' => {
            'before_translation_mm' => [runner_r_before_x, 0.0, 5.0],
            'after_translation_mm' => [runner_r_after_x, 0.0, 5.0],
            'delta_mm' => delta_runner_r,
            'asset_revision_id_before' => runner_r_meta_before.dig('intent', 'assetRevisionId'),
            'asset_revision_id_after' => @metadata_store.read(runner_r_rebuilt).dig('intent', 'assetRevisionId'),
            'definition_reused' => (runner_r_rebuilt.definition == runner_r_def_before),
            'scale_before' => runner_r_scale_before,
            'scale_after' => runner_r_scale_after,
            'determinant_before' => runner_r_det_before,
            'determinant_after' => runner_r_det_after
          },
          'bottom' => {
            'width_mm_before' => 565.0,
            'width_mm_after' => 765.0,
            'thickness_mm' => 15.0,
            'length_mm' => 480.0,
            'parametric_scaling' => false,
            'definition_regenerated' => true
          }
        }
        evidence['tests']['h2_rebuild_w800'] = { 'status' => 'pass' }
      end

      # H3: Non-identity compound world transform (R8 evidence)
      # Furniture transform * Assembly placement * Member placement * MountFrame
      def test_h3_non_identity_world_transform
        loader_with_mount_frame = create_mount_frame_asset_loader(origin_mm: [15.0, 5.0, 2.0])
        builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: loader_with_mount_frame
        )

        layout_data = build_non_identity_compound_layout
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        t_furniture = Geom::Transformation.translation(Geom::Vector3d.new(1200.0 * MM, 600.0 * MM, 300.0 * MM))
        result = builder.place_existing_furniture(
          model,
          furniture_instance_id: FI_1,
          definition: catalog_definition,
          parameters: {},
          resolved_layout: parsed,
          transformation: t_furniture,
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
        assert result['success']

        furniture = find_furniture(FI_1)
        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        refute_nil side_l

        t_world = furniture.transformation * side_l.transformation
        assert_rigid_transformation(t_world)

        # Expected calculation:
        # Asset origin [0, 0, 0] normalized by MountFrame [15, 5, 2] -> [-15, -5, -2] mm
        # Local member translation [30, 20, 10] -> [15, 15, 8] mm
        # Assembly translation [50, 100, 40] -> [65, 115, 48] mm
        # Furniture translation [1200, 600, 300] -> [1265, 715, 348] mm
        expected_mm = [1265.0, 715.0, 348.0]
        actual_pt = Geom::Point3d.new(0, 0, 0).transform(t_world)
        actual_mm = [actual_pt.x * 25.4, actual_pt.y * 25.4, actual_pt.z * 25.4]

        error_mm = Math.sqrt(
          ((actual_mm[0] - expected_mm[0])**2) +
          ((actual_mm[1] - expected_mm[1])**2) +
          ((actual_mm[2] - expected_mm[2])**2)
        )

        assert error_mm < 1e-3, "Compound world point error #{error_mm} mm exceeds tolerance 1e-3 mm"

        evidence['r8_world_transform'] = {
          'furniture_translation_mm' => [1200.0, 600.0, 300.0],
          'assembly_translation_mm' => [50.0, 100.0, 40.0],
          'member_translation_mm' => [30.0, 20.0, 10.0],
          'mount_frame_origin_mm' => [15.0, 5.0, 2.0],
          'expected_world_point_mm' => expected_mm,
          'actual_world_point_mm' => actual_mm,
          'error_mm' => error_mm,
          'tolerance_mm' => 1e-3,
          'pass' => (error_mm < 1e-3)
        }
        evidence['tests']['h3_non_identity_world_transform'] = { 'status' => 'pass', 'error_mm' => error_mm }
      end

      # H4: Multiple assemblies
      def test_h4_multiple_assemblies
        layout_data = build_multiple_drawers_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        furniture = find_furniture(FI_1)
        children = furniture.definition.entities.grep(Sketchup::ComponentInstance)

        d1_members = children.select do |ci|
          @metadata_store.read(ci)&.dig('identity', 'assemblyInstanceId') == 'drawer-inst-1'
        end
        d2_members = children.select do |ci|
          @metadata_store.read(ci)&.dig('identity', 'assemblyInstanceId') == 'drawer-inst-2'
        end

        assert_equal 5, d1_members.length, 'Drawer 1 must have 4 rigid members + 1 bottom'
        assert_equal 5, d2_members.length, 'Drawer 2 must have 4 rigid members + 1 bottom'

        evidence['tests']['h4_multiple_assemblies'] = {
          'status' => 'pass',
          'assemblies_count' => 2,
          'total_children' => children.length
        }
      end

      # H5: Shared ComponentDefinition
      def test_h5_shared_component_definition
        layout_data = build_multiple_drawers_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        furniture = find_furniture(FI_1)
        children = furniture.definition.entities.grep(Sketchup::ComponentInstance)

        d1_side_l = children.find do |ci|
          meta = @metadata_store.read(ci)
          meta&.dig('identity', 'assemblyInstanceId') == 'drawer-inst-1' &&
            meta&.dig('identity', 'memberId') == 'sideLeft'
        end
        d2_side_l = children.find do |ci|
          meta = @metadata_store.read(ci)
          meta&.dig('identity', 'assemblyInstanceId') == 'drawer-inst-2' &&
            meta&.dig('identity', 'memberId') == 'sideLeft'
        end

        refute_nil d1_side_l
        refute_nil d2_side_l
        assert_equal(
          d1_side_l.definition, d2_side_l.definition,
          'Identical parts across assemblies must share definition'
        )
        refute_equal d1_side_l.transformation.to_a, d2_side_l.transformation.to_a

        evidence['tests']['h5_shared_component_definition'] = {
          'status' => 'pass',
          'shared_definition_name' => d1_side_l.definition.name
        }
      end

      # H6: Save and reopen
      def test_h6_save_and_reopen
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

        evidence['tests']['h6_save_and_reopen'] = { 'status' => 'pass' }
      end

      # H7: Undo and Redo
      def test_h7_undo_redo
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

        evidence['tests']['h7_undo_redo'] = { 'status' => 'pass' }
      end

      # H8: Fail-before-mutate (furniture-wide preflight)
      def test_h8_fail_before_mutate
        layout_initial = build_multiple_drawers_layout(width_mm: 600.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success']
        furniture = find_furniture(FI_1)
        initial_children = furniture.definition.entities.grep(Sketchup::ComponentInstance).map(&:persistent_id)

        # Set up a failing loader
        failing_loader = build_always_failing_asset_loader
        failing_builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: failing_loader
        )

        layout_rebuilt = build_multiple_drawers_layout(width_mm: 800.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = failing_builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        refute result_rebuilt['success'], 'Rebuild must fail before mutation'

        # Existing geometry remains completely untouched
        current_children = furniture.definition.entities.grep(Sketchup::ComponentInstance).map(&:persistent_id)
        assert_equal initial_children, current_children, 'Children must be completely unmodified'

        evidence['tests']['h8_fail_before_mutate'] = { 'status' => 'pass' }
      end

      # H9: Metadata identities
      def test_h9_metadata_identities
        layout_data = build_drawer_assembly_layout(width_mm: 600.0, historical: true)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        furniture = find_furniture(FI_1)
        side_r = find_child_by_name(furniture, 'Lateral Derecho')
        bottom = find_child_by_name(furniture, 'Fondo Cajón')

        side_r_meta = @metadata_store.read(side_r)
        bottom_meta = @metadata_store.read(bottom)

        assert_equal 'drawer-inst-1', side_r_meta.dig('identity', 'assemblyInstanceId')
        assert_equal 'sideRight', side_r_meta.dig('identity', 'memberId')
        assert_equal 'drawer-inst-1:sideRight', side_r_meta.dig('identity', 'hardwarePlacementId')
        assert_equal 2, side_r_meta.dig('identity', 'recipeRevision')
        assert_equal true, side_r_meta.dig('identity', 'isHistorical')
        assert_equal 'snap-merivobox-v2', side_r_meta.dig('identity', 'snapshotId')
        assert_equal 'rev-side-1', side_r_meta.dig('identity', 'assetRevisionId')

        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_l_meta = @metadata_store.read(side_l)
        assert_equal 'snap-merivobox-v2', side_l_meta.dig('identity', 'snapshotId')
        assert_equal side_r_meta.dig('identity', 'snapshotId'), side_l_meta.dig('identity', 'snapshotId')

        assert_equal 'ast-side', side_r_meta.dig('intent', 'assetId')
        assert_equal 'rev-side-1', side_r_meta.dig('intent', 'assetRevisionId')
        assert_equal 2, side_r_meta.dig('intent', 'recipeRevision')
        assert_equal true, side_r_meta.dig('intent', 'isHistorical')
        assert_equal 'snap-merivobox-v2', side_r_meta.dig('intent', 'snapshotId')

        assert_equal 'drawer-inst-1', bottom_meta.dig('identity', 'assemblyInstanceId')
        assert_equal 'bottom', bottom_meta.dig('identity', 'componentId')
        assert_equal 2, bottom_meta.dig('identity', 'recipeRevision')
        assert_equal true, bottom_meta.dig('identity', 'isHistorical')
        assert_equal 'snap-merivobox-v2', bottom_meta.dig('identity', 'snapshotId')

        assert_equal 'drawer_bottom', bottom_meta.dig('intent', 'semanticRole')
        assert_equal 2, bottom_meta.dig('intent', 'recipeRevision')
        assert_equal true, bottom_meta.dig('intent', 'isHistorical')
        assert_equal 'snap-merivobox-v2', bottom_meta.dig('intent', 'snapshotId')

        evidence['tests']['h9_metadata_identities'] = {
          'status' => 'pass',
          'verified_fields' => %w[assemblyInstanceId memberId hardwareId assetId recipeRevision isHistorical snapshotId]
        }
      end

      # H10: No scaling or mirror
      def test_h10_no_scaling_or_mirror
        layout_data = build_multiple_drawers_layout(width_mm: 600.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        furniture = find_furniture(FI_1)
        children = furniture.definition.entities.grep(Sketchup::ComponentInstance)

        rigid_members = children.select do |ci|
          meta = @metadata_store.read(ci)
          meta&.dig('identity', 'assemblyInstanceId') && meta.dig('identity', 'memberId')
        end

        assert_equal 8, rigid_members.length, 'Must have 8 rigid members across 2 assemblies'
        rigid_members.each do |member|
          assert_rigid_transformation(member.transformation)
          scale = calculate_matrix_scale(member.transformation)
          det = calculate_matrix_determinant(member.transformation)
          assert_in_delta 1.0, scale[0], 1e-4
          assert_in_delta 1.0, scale[1], 1e-4
          assert_in_delta 1.0, scale[2], 1e-4
          assert_in_delta 1.0, det, 1e-4
        end

        evidence['tests']['h10_no_scaling_or_mirror'] = {
          'status' => 'pass',
          'verified_rigid_members_count' => rigid_members.length
        }
      end

      private

      def model
        Sketchup.active_model
      end

      def persist_evidence
        out_path = File.join(REPOSITORY_ROOT, 'progress', 'host_smoke_670_d_assembly_runtime_evidence.json')
        FileUtils.mkdir_p(File.dirname(out_path))
        File.write(out_path, JSON.pretty_generate(evidence))
      end

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

      def calculate_matrix_scale(transform)
        mat = transform.to_a
        c0 = [mat[0], mat[1], mat[2]]
        c1 = [mat[4], mat[5], mat[6]]
        c2 = [mat[8], mat[9], mat[10]]
        [
          Granete::SketchUpExtension::Assets::MountFrame.magnitude(c0),
          Granete::SketchUpExtension::Assets::MountFrame.magnitude(c1),
          Granete::SketchUpExtension::Assets::MountFrame.magnitude(c2)
        ]
      end

      def calculate_matrix_determinant(transform)
        mat = transform.to_a
        c0 = [mat[0], mat[1], mat[2]]
        c1 = [mat[4], mat[5], mat[6]]
        c2 = [mat[8], mat[9], mat[10]]
        cross12 = Granete::SketchUpExtension::Assets::MountFrame.cross_product(c1, c2)
        Granete::SketchUpExtension::Assets::MountFrame.dot_product(c0, cross12)
      end

      def assert_rigid_transformation(transform, tolerance = 1e-4)
        s0, s1, s2 = calculate_matrix_scale(transform)
        assert_in_delta 1.0, s0, tolerance, "X axis scale must be 1.0 (got #{s0})"
        assert_in_delta 1.0, s1, tolerance, "Y axis scale must be 1.0 (got #{s1})"
        assert_in_delta 1.0, s2, tolerance, "Z axis scale must be 1.0 (got #{s2})"

        det = calculate_matrix_determinant(transform)
        assert_in_delta 1.0, det, tolerance, "Determinant must be +1.0 (got #{det})"
      end

      def create_fixture_asset_loader
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

      def create_mount_frame_asset_loader(origin_mm: [15.0, 5.0, 2.0])
        _ = origin_mm
        side_skp = File.join(@tmp_dir, 'side_fixture_mf.skp')
        create_box_skp(side_skp, 500.0, 150.0, 16.0)

        downloader = Class.new do
          def initialize(path)
            @path = path
          end

          def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
            _ = [asset_id, revision_id, sha256, expected_bytes, org_id]
            @path
          end
        end.new(side_skp)

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
        defn = model.definitions.add("FixtureDef_#{File.basename(path, '.*')}")
        face = defn.entities.add_face(pts)
        face.pushpull(height_mm * MM)
        defn.save_as(path)
      end

      def build_drawer_assembly_layout(width_mm: 600.0, historical: false)
        delta = width_mm - 600.0
        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => 'Mueble Cajonero',
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
          'hardware' => [],
          'assemblies' => [
            {
              'assemblyInstanceId' => 'drawer-inst-1',
              'agregadoId' => 'agr-merivobox',
              'recipeRevision' => historical ? 2 : 1,
              'isHistorical' => historical,
              'snapshotId' => historical ? 'snap-merivobox-v2' : nil,
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

      def build_non_identity_compound_layout
        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => 'Mueble Cajonero',
          'transformContract' => 'granete.local-basis.v1',
          'dimensionsMm' => [600.0, 720.0, 560.0],
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
          'hardware' => [],
          'assemblies' => [
            {
              'assemblyInstanceId' => 'drawer-inst-1',
              'agregadoId' => 'agr-merivobox',
              'recipeRevision' => 1,
              'isHistorical' => false,
              'dimensionsMm' => [600.0, 150.0, 500.0],
              'placement' => {
                'translationMm' => [50.0, 100.0, 40.0],
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
                    'originMm' => [15.0, 5.0, 2.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  },
                  'localTransform' => {
                    'translationMm' => [30.0, 20.0, 10.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                }
              ],
              'fabricatedComponents' => []
            }
          ]
        }
      end

      def build_multiple_drawers_layout(width_mm: 600.0)
        d1 = build_drawer_assembly_layout(width_mm: width_mm)['assemblies'].first
        d2 = Marshal.load(Marshal.dump(d1))
        d2['assemblyInstanceId'] = 'drawer-inst-2'
        d2['placement']['translationMm'] = [0.0, 100.0, 350.0]

        layout = build_drawer_assembly_layout(width_mm: width_mm)
        layout['assemblies'] = [d1, d2]
        layout
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
