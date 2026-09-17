# frozen_string_literal: true

require 'digest'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'time'
require 'testup/testcase'

# Real-host smoke test for #670 Increment E:
# Piloto MERIVOBOX real end-to-end en SketchUp.
#
# Proves against the real INSTALLED extension and SketchUp 2026 host:
#   E1 & E2:  Insert W600 (rigid members det=+1.0, scale=[1,1,1],
#             bottom panel = 542 x 484 x 16 mm, back = 542 x 69 x 16 mm).
#   E3 & E20: Rebuild W800 (right members delta=+200 mm, left delta=0,
#             definitions reused, bottom panel 542 -> 742 mm, scale=[1,1,1], det=+1.0).
#   E5 & E6:  Discrete variant switch (NL 450 -> NL 500) without scaling,
#             runner definition switched, bottom length 434 -> 484 mm.
#   E9 & E10: Non-identity compound transform: Furniture * Assembly * Member * MountFrame (originMm [15, 5, 2]).
#   E11:      Save, close, and reopen .skp preserves assembly identities, transforms, and metadata.
#   E12:      Undo and Redo revert and restore assembly geometry and metadata cleanly.
#   E13:      Furniture-wide fail-before-mutate (1 failing member preserves existing geometry intact).
#   E14:      Rigidity invariant across all mutations (all rigid members scale=[1,1,1] and det=+1.0).
module Granete
  module SketchUpExtension
    class TC_MerivoboxPilotSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FURNITURE_DEF_ID = '50000000-0000-0000-0000-0000000000d1'

      # Shared evidence accumulator persisted to progress/host_smoke_670_e_merivobox_pilot_evidence.json
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
        'pilot' => 'BLUM_MERIVOBOX_HEIGHT_M',
        'tests' => {},
        'w600_to_w800_delta' => {},
        'variant_switch_nl450_to_nl500' => {},
        'world_transform' => {}
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
        @tmp_dir = Dir.mktmpdir('granete-merivobox-smoke')
        @metadata_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        @asset_loader = create_merivobox_asset_loader
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

      # E1 & E2: Insert W600 MERIVOBOX
      def test_e1_e2_insert_merivobox_w600
        layout_data = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success'], "Insertion failed: #{result['error']}"

        furniture = find_furniture(FI_1)
        refute_nil furniture

        side_l = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r = find_child_by_name(furniture, 'Lateral Derecho')
        runner_l = find_child_by_name(furniture, 'Guía Izquierda')
        runner_r = find_child_by_name(furniture, 'Guía Derecha')
        bottom = find_child_by_name(furniture, 'Fondo MERIVOBOX')
        back = find_child_by_name(furniture, 'Trasera MERIVOBOX')

        refute_nil side_l, 'sideLeft must be materialized'
        refute_nil side_r, 'sideRight must be materialized'
        refute_nil runner_l, 'runnerLeft must be materialized'
        refute_nil runner_r, 'runnerRight must be materialized'
        refute_nil bottom, 'bottom panel must be materialized'
        refute_nil back, 'back panel must be materialized'

        [side_l, side_r, runner_l, runner_r].each do |inst|
          assert_rigid_transformation(inst.transformation)
        end

        # Metadata identity checks
        side_r_meta = @metadata_store.read(side_r)
        assert_equal 'inst-merivobox-1', side_r_meta.dig('identity', 'assemblyInstanceId')
        assert_equal 'side-right', side_r_meta.dig('identity', 'memberId')

        # Dimensions check: bottom = 542 x 484 x 16 mm (600 - 58, 500 - 16)
        assert_in_delta 542.0 * MM, bottom.definition.bounds.width, 1e-3
        assert_in_delta 16.0 * MM, bottom.definition.bounds.height, 1e-3
        assert_in_delta 484.0 * MM, bottom.definition.bounds.depth, 1e-3

        # Back panel = 542 x 69 x 16 mm
        assert_in_delta 542.0 * MM, back.definition.bounds.width, 1e-3

        evidence['tests']['e1_e2_insert_w600'] = {
          'status' => 'pass',
          'rigid_members_count' => 4,
          'fabricated_components_count' => 2,
          'bottom_width_mm' => 542.0,
          'bottom_length_mm' => 484.0,
          'back_width_mm' => 542.0,
          'back_length_mm' => 69.0
        }
      end

      # E3 & E20: Rebuild W800 (+200 mm delta on right side, no scaling, det=+1.0)
      def test_e3_e20_rebuild_w800_delta_200mm
        layout_initial = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success'], "Initial insertion failed: #{result_initial['error']}"

        furniture = find_furniture(FI_1)
        side_l_init = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r_init = find_child_by_name(furniture, 'Lateral Derecho')
        runner_r_init = find_child_by_name(furniture, 'Guía Derecha')
        bottom_init = find_child_by_name(furniture, 'Fondo MERIVOBOX')

        side_r_before_x = side_r_init.transformation.origin.x * 25.4
        runner_r_before_x = runner_r_init.transformation.origin.x * 25.4
        side_l_before_x = side_l_init.transformation.origin.x * 25.4

        side_r_def_before = side_r_init.definition
        runner_r_def_before = runner_r_init.definition
        bottom_def_before = bottom_init.definition.name

        # Rebuild at W800
        layout_rebuilt = build_merivobox_layout(width_mm: 800.0, nominal_depth_mm: 500.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = @builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        assert result_rebuilt['success'], "Update failed: #{result_rebuilt['error']}"

        side_l_rebuilt = find_child_by_name(furniture, 'Lateral Izquierdo')
        side_r_rebuilt = find_child_by_name(furniture, 'Lateral Derecho')
        runner_r_rebuilt = find_child_by_name(furniture, 'Guía Derecha')
        bottom_rebuilt = find_child_by_name(furniture, 'Fondo MERIVOBOX')

        side_r_after_x = side_r_rebuilt.transformation.origin.x * 25.4
        runner_r_after_x = runner_r_rebuilt.transformation.origin.x * 25.4
        delta_side_r = side_r_after_x - side_r_before_x
        delta_runner_r = runner_r_after_x - runner_r_before_x

        # Left members remain fixed at x=0 delta
        assert_in_delta side_l_before_x, side_l_rebuilt.transformation.origin.x * 25.4, 1e-3

        # Right members translate exactly +200 mm
        assert_in_delta 200.0, delta_side_r, 1e-3, "sideRight delta must be exactly +200 mm (got #{delta_side_r})"
        assert_in_delta 200.0, delta_runner_r, 1e-3, "runnerRight delta must be exactly +200 mm (got #{delta_runner_r})"

        # ComponentDefinition reused for rigid members
        assert_equal side_r_def_before, side_r_rebuilt.definition, 'sideRight definition must be reused'
        assert_equal runner_r_def_before, runner_r_rebuilt.definition, 'runnerRight definition must be reused'

        # Bottom regenerated with new width: 542 -> 742 mm, thickness 16 mm preserved
        refute_equal bottom_def_before, bottom_rebuilt.definition.name, 'bottom definition must be regenerated'
        assert_in_delta 742.0 * MM, bottom_rebuilt.definition.bounds.width, 1e-3
        assert_in_delta 16.0 * MM, bottom_rebuilt.definition.bounds.height, 1e-3
        assert_in_delta 484.0 * MM, bottom_rebuilt.definition.bounds.depth, 1e-3
        assert_rigid_transformation(bottom_rebuilt.transformation)

        # Scale and det invariant
        [side_l_rebuilt, side_r_rebuilt, runner_r_rebuilt].each do |inst|
          assert_rigid_transformation(inst.transformation)
        end

        evidence['w600_to_w800_delta'] = {
          'side_right_delta_mm' => delta_side_r,
          'runner_right_delta_mm' => delta_runner_r,
          'bottom_width_before_mm' => 542.0,
          'bottom_width_after_mm' => 742.0,
          'definitions_reused' => true,
          'rigid_scale_preserved' => true
        }
        evidence['tests']['e3_e20_rebuild_w800'] = { 'status' => 'pass' }
      end

      # E5 & E6: Discrete variant change NL 450 -> NL 500 without scaling
      def test_e5_e6_variant_switch_nl450_to_nl500
        layout450 = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 450.0)
        parsed450 = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout450)

        result450 = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed450)
        assert result450['success']

        furniture = find_furniture(FI_1)
        runner_l450 = find_child_by_name(furniture, 'Guía Izquierda')
        bottom450 = find_child_by_name(furniture, 'Fondo MERIVOBOX')

        runner_def450 = runner_l450.definition
        bottom_len450 = bottom450.definition.bounds.depth * 25.4
        assert_in_delta 434.0, bottom_len450, 1e-3

        # Update depth from 480 (NL 450) to 530 (NL 500)
        layout500 = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed500 = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout500)

        result500 = @builder.update_furniture(
          model, furniture, catalog_definition, { 'depthMm' => 530.0 },
          resolved_layout: parsed500
        )
        assert result500['success']

        runner_l500 = find_child_by_name(furniture, 'Guía Izquierda')
        bottom500 = find_child_by_name(furniture, 'Fondo MERIVOBOX')

        runner_def500 = runner_l500.definition
        bottom_len500 = bottom500.definition.bounds.depth * 25.4

        # Runner switched definition cleanly without scaling
        refute_equal runner_def450, runner_def500, 'Runner definition must switch between NL 450 and NL 500'
        assert_rigid_transformation(runner_l500.transformation)

        # Bottom length regenerated from 434 to 484 mm; width stays 542 mm
        assert_in_delta 484.0, bottom_len500, 1e-3
        assert_in_delta 542.0 * MM, bottom500.definition.bounds.width, 1e-3

        evidence['variant_switch_nl450_to_nl500'] = {
          'hardware_id_450' => 'hw-merivobox-450',
          'hardware_id_500' => 'hw-merivobox-500',
          'bottom_length_450_mm' => bottom_len_450,
          'bottom_length_500_mm' => bottom_len_500,
          'scale_preserved' => true
        }
        evidence['tests']['e5_e6_variant_switch'] = { 'status' => 'pass' }
      end

      # E9 & E10: Non-identity MountFrame world transform composition
      def test_e9_e10_non_identity_mount_frame
        loader_with_mount_frame = create_merivobox_asset_loader(origin_mm: [15.0, 5.0, 2.0])
        builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: loader_with_mount_frame
        )

        layout_data = build_merivobox_layout(
          width_mm: 600.0, nominal_depth_mm: 500.0, mount_origin_mm: [15.0, 5.0, 2.0]
        )
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

        # Expected world point:
        # Asset origin [0,0,0] normalized by MountFrame [15, 5, 2] -> [-15, -5, -2] mm
        # Local translation [0, 0, 0] -> [-15, -5, -2] mm
        # Assembly translation [0, 50, 100] -> [-15, 45, 98] mm
        # Furniture translation [1200, 600, 300] -> [1185, 645, 398] mm
        expected_mm = [1185.0, 645.0, 398.0]
        actual_pt = Geom::Point3d.new(0, 0, 0).transform(t_world)
        actual_mm = [actual_pt.x * 25.4, actual_pt.y * 25.4, actual_pt.z * 25.4]

        error_mm = Math.sqrt(
          ((actual_mm[0] - expected_mm[0])**2) +
          ((actual_mm[1] - expected_mm[1])**2) +
          ((actual_mm[2] - expected_mm[2])**2)
        )

        assert error_mm < 1e-3, "World point error #{error_mm} mm exceeds 1e-3 mm tolerance"

        evidence['world_transform'] = {
          'expected_world_point_mm' => expected_mm,
          'actual_world_point_mm' => actual_mm,
          'error_mm' => error_mm,
          'tolerance_mm' => 1e-3
        }
        evidence['tests']['e9_e10_mount_frame_world_transform'] = { 'status' => 'pass', 'error_mm' => error_mm }
      end

      # E11: Save, close, and reopen .skp preserves MERIVOBOX assembly
      def test_e11_save_close_reopen
        layout_data = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        result = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed)
        assert result['success']

        file_path = File.join(@tmp_dir, 'merivobox_saved.skp')
        save_success = model.save(file_path)
        assert save_success, 'Failed to save model to disk'

        Sketchup.file_new
        assert_nil find_furniture(FI_1)

        open_status = Sketchup.open_file(file_path)
        assert([true, 0].include?(open_status), 'Failed to reopen model')

        reopened_model = Sketchup.active_model
        store_reopened = Granete::SketchUpExtension::Metadata::Store.new(reopened_model)

        furniture_reopened = reopened_model.active_entities.grep(Sketchup::ComponentInstance).find do |inst|
          meta = store_reopened.read(inst)
          meta.dig('identity', 'furnitureInstanceId') == FI_1
        end
        refute_nil furniture_reopened, 'Reopened furniture instance not found'

        side_r = find_child_by_name(furniture_reopened, 'Lateral Derecho')
        refute_nil side_r
        meta_side_r = store_reopened.read(side_r)

        assert_equal 'inst-merivobox-1', meta_side_r.dig('identity', 'assemblyInstanceId')
        assert_equal 'side-right', meta_side_r.dig('identity', 'memberId')
        assert_rigid_transformation(side_r.transformation)

        evidence['tests']['e11_save_close_reopen'] = { 'status' => 'pass' }
      end

      # E12: Undo and Redo revert and restore MERIVOBOX cleanly
      def test_e12_undo_redo_clean
        layout_initial = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success']
        furniture = find_furniture(FI_1)

        layout_rebuilt = build_merivobox_layout(width_mm: 800.0, nominal_depth_mm: 500.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = @builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        assert result_rebuilt['success']

        # Undo rebuild -> reverts to W600 (sideRight at x = 600 mm)
        Sketchup.undo
        side_r_undone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_undone
        assert_in_delta 600.0 * MM, side_r_undone.transformation.origin.x, 1e-3

        # Redo rebuild -> restores to W800 (sideRight at x = 800 mm)
        Sketchup.active_model.respond_to?(:redo) ? Sketchup.active_model.redo : Sketchup.send(:redo)
        side_r_redone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_redone
        assert_in_delta 800.0 * MM, side_r_redone.transformation.origin.x, 1e-3

        evidence['tests']['e12_undo_redo'] = { 'status' => 'pass' }
      end

      # E13: Fail-before-mutate preserves existing model
      def test_e13_fail_before_mutate
        layout_initial = build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0)
        parsed_initial = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_initial)

        result_initial = place_test_furniture(furniture_instance_id: FI_1, resolved_layout: parsed_initial)
        assert result_initial['success']
        furniture = find_furniture(FI_1)
        initial_children = furniture.definition.entities.grep(Sketchup::ComponentInstance).map(&:persistent_id)

        # Build a failing loader
        failing_downloader = MerivoboxPilotTest::FakeDownloader.new({})
        failing_loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
          downloader: failing_downloader,
          cache: @cache
        )
        failing_builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: failing_loader
        )

        # Point layout to non-cached asset revision
        layout_failing = build_merivobox_layout(width_mm: 800.0, nominal_depth_mm: 500.0)
        layout_failing['assemblies'].first['rigidMembers'].first['assetRevisionId'] = 'rev-nonexistent-fail'
        parsed_failing = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_failing)

        result_rebuilt = failing_builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_failing
        )
        refute result_rebuilt['success'], 'Update must fail closed when asset is missing'

        # Existing geometry remains completely untouched
        current_children = furniture.definition.entities.grep(Sketchup::ComponentInstance).map(&:persistent_id)
        assert_equal initial_children, current_children, 'Existing geometry must remain unmodified'

        evidence['tests']['e13_fail_before_mutate'] = { 'status' => 'pass' }
      end

      private

      def model
        Sketchup.active_model
      end

      def catalog_definition
        {
          'furniture_definition_id' => FURNITURE_DEF_ID,
          'name' => 'Bajo 1 Cajón MERIVOBOX',
          'category' => 'base',
          'default_dimensions' => { 'width' => 600.0, 'height' => 720.0, 'depth' => 560.0 }
        }
      end

      def find_furniture(instance_id)
        model.active_entities.grep(Sketchup::ComponentInstance).find do |inst|
          meta = @metadata_store.read(inst)
          meta.dig('identity', 'furnitureInstanceId') == instance_id
        end
      end

      def find_child_by_name(parent_instance, child_name)
        parent_instance.definition.entities.grep(Sketchup::ComponentInstance).find do |inst|
          inst.name == child_name
        end
      end

      def place_test_furniture(furniture_instance_id:, resolved_layout:)
        @builder.place_existing_furniture(
          model,
          furniture_instance_id: furniture_instance_id,
          definition: catalog_definition,
          parameters: {},
          resolved_layout: resolved_layout,
          transformation: Geom::Transformation.new,
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
      end

      def assert_rigid_transformation(trans)
        det = calculate_matrix_determinant(trans)
        assert_in_delta 1.0, det, 1e-3, "Matrix determinant #{det} must be +1.0"

        scale = calculate_matrix_scale(trans)
        assert_in_delta 1.0, scale[0], 1e-3, "Scale X #{scale[0]} must be 1.0"
        assert_in_delta 1.0, scale[1], 1e-3, "Scale Y #{scale[1]} must be 1.0"
        assert_in_delta 1.0, scale[2], 1e-3, "Scale Z #{scale[2]} must be 1.0"
      end

      def calculate_matrix_determinant(trans)
        a = trans.to_a
        (a[0] * ((a[5] * a[10]) - (a[6] * a[9]))) -
          (a[1] * ((a[4] * a[10]) - (a[6] * a[8]))) +
          (a[2] * ((a[4] * a[9]) - (a[5] * a[8])))
      end

      def calculate_matrix_scale(trans)
        a = trans.to_a
        [
          Math.sqrt((a[0]**2) + (a[1]**2) + (a[2]**2)),
          Math.sqrt((a[4]**2) + (a[5]**2) + (a[6]**2)),
          Math.sqrt((a[8]**2) + (a[9]**2) + (a[10]**2))
        ]
      end

      def create_merivobox_asset_loader(_origin_mm: [15.0, 5.0, 2.0])
        side_skp = File.join(@tmp_dir, 'mbx_side.skp')
        runner_skp = File.join(@tmp_dir, 'mbx_runner.skp')
        File.binwrite(side_skp, 'SKP MBX SIDE')
        File.binwrite(runner_skp, 'SKP MBX RUNNER')

        downloader = MerivoboxPilotTest::FakeDownloader.new(
          'rev-mbx-side-1' => side_skp,
          'rev-mbx-450-1' => runner_skp,
          'rev-mbx-500-1' => runner_skp
        )
        Granete::SketchUpExtension::Assets::AssetLoader.new(
          downloader: downloader,
          cache: @cache
        )
      end

      def persist_evidence
        evidence_path = File.join(REPOSITORY_ROOT, 'progress/host_smoke_670_e_merivobox_pilot_evidence.json')
        FileUtils.mkdir_p(File.dirname(evidence_path))
        File.write(evidence_path, JSON.pretty_generate(self.class.evidence))
      end

      def build_merivobox_layout(width_mm: 600.0, nominal_depth_mm: 500.0, mount_origin_mm: [15.0, 5.0, 2.0])
        delta_w = width_mm - 600.0
        is450 = (nominal_depth_mm - 450.0).abs < 1e-4
        hw_id = is450 ? 'hw-merivobox-450' : 'hw-merivobox-500'
        rev_id = is450 ? 'rev-mbx-450-1' : 'rev-mbx-500-1'
        bottom_length = nominal_depth_mm - 16.0 # REAL_VERIFIED: NL - 16
        bottom_width = width_mm - 58.0          # REAL_VERIFIED: LW - 58

        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => "MERIVOBOX Mueble #{width_mm.to_i}",
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
              'assemblyInstanceId' => 'inst-merivobox-1',
              'agregadoId' => 'agr-merivobox-m',
              'recipeRevision' => 1,
              'isHistorical' => false,
              'dimensionsMm' => [width_mm, 200.0, nominal_depth_mm],
              'commercialKitHardwareId' => 'kit-merivobox-m',
              'placement' => {
                'translationMm' => [0.0, 50.0, 100.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'rigidMembers' => [
                {
                  'memberId' => 'side-left',
                  'role' => 'drawer_side_left',
                  'name' => 'Lateral Izquierdo',
                  'hardwareId' => hw_id,
                  'assetId' => 'ast-mbx-side',
                  'assetRevisionId' => 'rev-mbx-side-1',
                  'preparationState' => 'prepared',
                  'mountFrame' => {
                    'originMm' => mount_origin_mm,
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  },
                  'localTransform' => {
                    'translationMm' => [0.0, 0.0, 0.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                },
                {
                  'memberId' => 'side-right',
                  'role' => 'drawer_side_right',
                  'name' => 'Lateral Derecho',
                  'hardwareId' => hw_id,
                  'assetId' => 'ast-mbx-side',
                  'assetRevisionId' => 'rev-mbx-side-1',
                  'preparationState' => 'prepared',
                  'mountFrame' => {
                    'originMm' => mount_origin_mm,
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  },
                  'localTransform' => {
                    'translationMm' => [600.0 + delta_w, 0.0, 0.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                },
                {
                  'memberId' => 'runner-left',
                  'role' => 'runner_left',
                  'name' => 'Guía Izquierda',
                  'hardwareId' => hw_id,
                  'assetId' => 'ast-mbx-runner',
                  'assetRevisionId' => rev_id,
                  'preparationState' => 'prepared',
                  'mountFrame' => {
                    'originMm' => mount_origin_mm,
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  },
                  'localTransform' => {
                    'translationMm' => [0.0, 0.0, 0.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                },
                {
                  'memberId' => 'runner-right',
                  'role' => 'runner_right',
                  'name' => 'Guía Derecha',
                  'hardwareId' => hw_id,
                  'assetId' => 'ast-mbx-runner',
                  'assetRevisionId' => rev_id,
                  'preparationState' => 'prepared',
                  'mountFrame' => {
                    'originMm' => mount_origin_mm,
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  },
                  'localTransform' => {
                    'translationMm' => [600.0 + delta_w, 0.0, 0.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                }
              ],
              'fabricatedComponents' => [
                {
                  'componentId' => 'comp-bottom',
                  'name' => 'Fondo MERIVOBOX',
                  'slotId' => 'drawer_bottom',
                  'widthMm' => bottom_width,
                  'thicknessMm' => 16.0,
                  'lengthMm' => bottom_length,
                  'materialColorHex' => '#e0d8cc',
                  'localTransform' => {
                    'translationMm' => [29.0, 16.0, 16.0],
                    'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
                  }
                },
                {
                  'componentId' => 'comp-back',
                  'name' => 'Trasera MERIVOBOX',
                  'slotId' => 'drawer_back',
                  'widthMm' => bottom_width,
                  'thicknessMm' => 16.0,
                  'lengthMm' => 69.0,
                  'materialColorHex' => '#e0d8cc',
                  'localTransform' => {
                    'translationMm' => [29.0, bottom_length, 32.0],
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
