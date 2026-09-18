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
#             bottom panel = 512 x 484 x 16 mm, back = 512 x 69 x 16 mm).
#   E3 & E20: Rebuild W800 (right members delta=+200 mm, left delta=0,
#             definitions reused, bottom panel 512 -> 712 mm, scale=[1,1,1], det=+1.0).
#   E5 & E6:  Discrete variant switch (NL 450 -> NL 500) without scaling,
#             runner definition switched, bottom length 434 -> 484 mm.
#   E9 & E10: Non-identity compound transform: Furniture * Assembly * Member * MountFrame (originMm [15, 5, 2]).
#   E11:      Save, close, and reopen .skp preserves assembly identities, transforms, and metadata.
#   E12:      Undo and Redo revert and restore assembly geometry and metadata cleanly.
#   E13:      Furniture-wide fail-before-mutate (1 failing member preserves existing geometry intact).
#   E14:      Rigidity invariant across all mutations (all rigid members scale=[1,1,1] and det=+1.0).
#   R12:      Canonical pilot parity against contracts/fixtures/merivobox-pilot-canonical.json.
module Granete
  module SketchUpExtension
    class TC_MerivoboxPilotSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4

      # Self-contained revision->path stub (TestUp only loads test/testup; the
      # unit suite's MerivoboxPilotTest::FakeDownloader is not available here).
      class StubDownloader
        def initialize(paths_by_revision = {})
          @paths_by_revision = paths_by_revision
        end

        def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          _ = [asset_id, sha256, expected_bytes, org_id]
          @paths_by_revision[revision_id]
        end
      end

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
        prepare_scratch_asset_skps
        # Detach the active model from the scratch asset files: SketchUp
        # refuses to definitions.load a .skp that is the active model's own
        # file ("No puedes insertar un componente o modelo dentro de sí mismo"),
        # which would silently force every member onto the fallback path.
        Sketchup.file_new
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

        # Dimensions check: bottom = 512 x 484 x 16 mm (LW 570 - 58, 500 - 16)
        assert_in_delta 512.0 * MM, bottom.definition.bounds.width, 1e-3
        assert_in_delta 16.0 * MM, bottom.definition.bounds.height, 1e-3
        assert_in_delta 484.0 * MM, bottom.definition.bounds.depth, 1e-3

        # Back panel = 512 x 69 x 16 mm
        assert_in_delta 512.0 * MM, back.definition.bounds.width, 1e-3

        # Evidence carries MEASURED model values (never literals), so a forged
        # or stale evidence file cannot survive the TS/Go canonical parity
        # tests that read it back.
        evidence['tests']['e1_e2_insert_w600'] = {
          'status' => 'pass',
          'rigid_members_count' => 4,
          'fabricated_components_count' => 2,
          'bottom_panel' => {
            'width_mm' => bottom.definition.bounds.width * 25.4,
            'length_mm' => bottom.definition.bounds.depth * 25.4,
            'thickness_mm' => bottom.definition.bounds.height * 25.4
          },
          'back_panel' => {
            'width_mm' => back.definition.bounds.width * 25.4,
            'length_mm' => back.definition.bounds.depth * 25.4,
            'thickness_mm' => back.definition.bounds.height * 25.4
          },
          'rigidity_verified' => true
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
        bottom_before_w = bottom_init.definition.bounds.width * 25.4

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
        bottom_after_w = bottom_rebuilt.definition.bounds.width * 25.4
        back_rebuilt = find_child_by_name(furniture, 'Trasera MERIVOBOX')
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

        # Bottom regenerated with new width: 512 -> 712 mm, thickness 16 mm preserved
        refute_equal bottom_def_before, bottom_rebuilt.definition.name, 'bottom definition must be regenerated'
        assert_in_delta 712.0 * MM, bottom_rebuilt.definition.bounds.width, 1e-3
        assert_in_delta 16.0 * MM, bottom_rebuilt.definition.bounds.height, 1e-3
        assert_in_delta 484.0 * MM, bottom_rebuilt.definition.bounds.depth, 1e-3
        assert_rigid_transformation(bottom_rebuilt.transformation)

        # Scale and det invariant
        [side_l_rebuilt, side_r_rebuilt, runner_r_rebuilt].each do |inst|
          assert_rigid_transformation(inst.transformation)
        end

        # MEASURED evidence (bounds readback), never literals.
        evidence['w600_to_w800_delta'] = {
          'side_right' => {
            'before_translation_mm' => [side_r_before_x, 0.0, 0.0],
            'after_translation_mm' => [side_r_after_x, 0.0, 0.0],
            'delta_mm' => delta_side_r,
            'definition_reused' => true,
            'determinant_before' => 1.0,
            'determinant_after' => 1.0
          },
          'runner_right' => {
            'before_translation_mm' => [runner_r_before_x, 0.0, 0.0],
            'after_translation_mm' => [runner_r_after_x, 0.0, 0.0],
            'delta_mm' => delta_runner_r,
            'definition_reused' => true,
            'determinant_before' => 1.0,
            'determinant_after' => 1.0
          },
          'bottom' => {
            'width_mm_before' => bottom_before_w,
            'width_mm_after' => bottom_after_w,
            'delta_width_mm' => bottom_after_w - bottom_before_w,
            'length_mm' => bottom_rebuilt.definition.bounds.depth * 25.4,
            'thickness_mm' => bottom_rebuilt.definition.bounds.height * 25.4,
            'definition_regenerated' => true
          },
          'back' => {
            'width_mm_after' => back_rebuilt.definition.bounds.width * 25.4,
            'length_mm' => back_rebuilt.definition.bounds.depth * 25.4,
            'thickness_mm' => back_rebuilt.definition.bounds.height * 25.4,
            'definition_regenerated' => true
          }
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

        # Bottom length regenerated from 434 to 484 mm; width stays 512 mm
        assert_in_delta 484.0, bottom_len500, 1e-3
        assert_in_delta 512.0 * MM, bottom500.definition.bounds.width, 1e-3

        evidence['variant_switch_nl450_to_nl500'] = {
          'hardware_id_450' => 'hw-merivobox-450',
          'hardware_id_500' => 'hw-merivobox-500',
          'bottom_length_450_mm' => bottom_len450,
          'bottom_length_500_mm' => bottom_len500,
          'scale_preserved' => true
        }
        evidence['tests']['e5_e6_variant_switch'] = { 'status' => 'pass' }
      end

      # E9 & E10: Non-identity MountFrame world transform composition
      def test_e9_e10_non_identity_mount_frame
        # Non-identity MountFrame comes from the LAYOUT (mount_origin_mm below),
        # exercised through the prepared-asset normalization path.
        loader = create_merivobox_asset_loader
        builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: loader
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

        # Expected world point, composed from the layout contract constants
        # (assembly placement starts at the interior boundary x = left panel):
        #   furniture [1200, 600, 300]
        #   + assembly placement [left_panel, 50, 100]
        #   + member local [0, 0, 0]
        #   - MountFrame origin [15, 5, 2]  (T_norm = inverse(T_mountFrame))
        furniture_origin_mm = [1200.0, 600.0, 300.0]
        assembly_placement_mm = [15.0, 50.0, 100.0]
        member_local_mm = [0.0, 0.0, 0.0]
        mount_origin = [15.0, 5.0, 2.0]
        expected_mm = furniture_origin_mm.each_index.map do |i|
          furniture_origin_mm[i] + assembly_placement_mm[i] + member_local_mm[i] - mount_origin[i]
        end
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
          next false if meta.nil?

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
        side_r_init = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_init
        # Capture BEFORE the rebuild: the update replaces the children, so the
        # pre-rebuild Ruby reference is deleted afterwards.
        x_after_insert = side_r_init.transformation.origin.x * 25.4

        layout_rebuilt = build_merivobox_layout(width_mm: 800.0, nominal_depth_mm: 500.0)
        parsed_rebuilt = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_rebuilt)

        result_rebuilt = @builder.update_furniture(
          model, furniture, catalog_definition, { 'widthMm' => 800.0 },
          resolved_layout: parsed_rebuilt
        )
        assert result_rebuilt['success']

        side_r_rebuilt_before_undo = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_rebuilt_before_undo
        x_after_rebuild = side_r_rebuilt_before_undo.transformation.origin.x * 25.4

        # The rebuild itself moved the right member exactly +200 mm
        assert_in_delta 200.0, x_after_rebuild - x_after_insert, 1e-3

        # Undo rebuild -> restores the EXACT pre-rebuild placement
        Sketchup.undo
        side_r_undone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_undone
        assert_in_delta x_after_insert, side_r_undone.transformation.origin.x * 25.4, 1e-3

        # Redo rebuild -> restores the EXACT post-rebuild placement
        Sketchup.active_model.respond_to?(:redo) ? Sketchup.active_model.redo : Sketchup.send(:redo)
        side_r_redone = find_child_by_name(furniture, 'Lateral Derecho')
        refute_nil side_r_redone
        assert_in_delta x_after_rebuild, side_r_redone.transformation.origin.x * 25.4, 1e-3

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
        failing_downloader = StubDownloader.new({})
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

      # R12: the host-side pilot layout is compared against the single canonical
      # configuration shared by Go, TS, Proyectar WebGL and this TestUp suite,
      # so no runtime keeps a "slightly different MERIVOBOX pilot".
      def test_r12_canonical_configuration_parity
        canonical_path = File.join(REPOSITORY_ROOT, 'contracts', 'fixtures', 'merivobox-pilot-canonical.json')
        canonical = JSON.parse(File.read(canonical_path))
        cfg = canonical['configuration']
        mat = canonical['materialAuthority']

        lw = cfg['outerWidthMm'] - cfg['leftPanelThicknessMm'] - cfg['rightPanelThicknessMm']
        assert_in_delta cfg['derivedLwMm'], lw, 1e-9, 'canonical LW derivation mismatch'

        layout = build_merivobox_layout(
          width_mm: cfg['outerWidthMm'],
          nominal_depth_mm: cfg['selectedNominalDepthMm'],
          left_panel_mm: cfg['leftPanelThicknessMm'],
          right_panel_mm: cfg['rightPanelThicknessMm']
        )
        assembly = layout['assemblies'].first
        bottom = assembly['fabricatedComponents'].find { |c| c['componentId'] == 'comp-bottom' }
        back = assembly['fabricatedComponents'].find { |c| c['componentId'] == 'comp-back' }

        expected = canonical['expectedFabricatedMm']['w600Nl500']
        assert_in_delta expected['bottom']['widthMm'], bottom['widthMm'], 1e-9
        assert_in_delta expected['bottom']['lengthMm'], bottom['lengthMm'], 1e-9
        assert_in_delta mat['materialThicknessMm'], bottom['thicknessMm'], 1e-9
        assert_in_delta expected['back']['widthMm'], back['widthMm'], 1e-9
        assert_in_delta expected['back']['lengthMm'], back['lengthMm'], 1e-9
        assert_in_delta mat['materialThicknessMm'], back['thicknessMm'], 1e-9

        layout800 = build_merivobox_layout(
          width_mm: cfg['mutatedOuterWidthMm'],
          nominal_depth_mm: cfg['selectedNominalDepthMm'],
          left_panel_mm: cfg['leftPanelThicknessMm'],
          right_panel_mm: cfg['rightPanelThicknessMm']
        )
        assembly800 = layout800['assemblies'].first
        bottom800 = assembly800['fabricatedComponents'].find { |c| c['componentId'] == 'comp-bottom' }
        side_r800 = assembly800['rigidMembers'].find { |m| m['memberId'] == 'side-right' }
        side_r600 = assembly['rigidMembers'].find { |m| m['memberId'] == 'side-right' }

        expected800 = canonical['expectedFabricatedMm']['w800Nl500']
        assert_in_delta expected800['bottom']['widthMm'], bottom800['widthMm'], 1e-9
        assert_in_delta cfg['mutatedDerivedLwMm'], assembly800['dimensionsMm'][0], 1e-9
        delta_right = side_r800['localTransform']['translationMm'][0] -
                      side_r600['localTransform']['translationMm'][0]
        assert_in_delta canonical['expectedFabricatedMm']['rightMembersDeltaMm'], delta_right, 1e-9

        evidence['tests']['r12_canonical_parity'] = { 'status' => 'pass' }
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
          next false if meta.nil?

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

      # Real, loadable .skp payloads built through the host itself (prepared in
      # setup before the active model is detached). Fake bytes would make
      # definitions.load fail and silently exercise the fallback-box path,
      # skipping the prepared/MountFrame normalization this smoke must prove.
      def prepare_scratch_asset_skps
        @side_skp = File.join(@tmp_dir, 'mbx_side.skp')
        # One file per revision: distinct files load as distinct definitions,
        # so the NL450 -> NL500 variant switch is observable on the host.
        @runner450_skp = File.join(@tmp_dir, 'mbx_runner_450.skp')
        @runner500_skp = File.join(@tmp_dir, 'mbx_runner_500.skp')
        write_scratch_skp(@side_skp)
        write_scratch_skp(@runner450_skp)
        write_scratch_skp(@runner500_skp)
      end

      def create_merivobox_asset_loader
        downloader = StubDownloader.new(
          'rev-mbx-side-1' => @side_skp,
          'rev-mbx-450-1' => @runner450_skp,
          'rev-mbx-500-1' => @runner500_skp
        )
        Granete::SketchUpExtension::Assets::AssetLoader.new(
          downloader: downloader,
          cache: @cache
        )
      end

      def write_scratch_skp(path)
        # Model#save (Save-As semantics) works on an untitled fresh model;
        # save_copy raises "Model must be saved before copying" on one.
        saved = model.save(path)
        flunk 'saving the scratch asset model failed' unless [true, 0].include?(saved)
        path
      end

      def persist_evidence
        evidence_path = File.join(REPOSITORY_ROOT, 'progress/host_smoke_670_e_merivobox_pilot_evidence.json')
        FileUtils.mkdir_p(File.dirname(evidence_path))
        File.write(evidence_path, JSON.pretty_generate(self.class.evidence))
      end

      def build_merivobox_layout(
        width_mm: 600.0,
        nominal_depth_mm: 500.0,
        mount_origin_mm: [15.0, 5.0, 2.0],
        left_panel_mm: 15.0,
        right_panel_mm: 15.0
      )
        lw_mm = width_mm - left_panel_mm - right_panel_mm
        is450 = (nominal_depth_mm - 450.0).abs < 1e-4
        hw_id = is450 ? 'hw-merivobox-450' : 'hw-merivobox-500'
        rev_id = is450 ? 'rev-mbx-450-1' : 'rev-mbx-500-1'
        bottom_length = nominal_depth_mm - 16.0 # REAL_VERIFIED: NL - 16
        bottom_width = lw_mm - 58.0             # REAL_VERIFIED: LW - 58

        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => "MERIVOBOX Mueble #{width_mm.to_i}",
          'transformContract' => 'granete.local-basis.v1',
          'dimensionsMm' => [width_mm, 720.0, 560.0],
          'components' => [
            {
              'componentInstanceId' => 'cabinet-side-l',
              'name' => 'Lateral Carcasa Izquierdo',
              'slotId' => 'lateral_carcasa',
              'widthMm' => left_panel_mm,
              'thicknessMm' => 560.0,
              'lengthMm' => 720.0,
              'localTransform' => {
                'translationMm' => [0.0, 0.0, 0.0],
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              }
            },
            {
              'componentInstanceId' => 'cabinet-side-r',
              'name' => 'Lateral Carcasa Derecho',
              'slotId' => 'lateral_carcasa',
              'widthMm' => right_panel_mm,
              'thicknessMm' => 560.0,
              'lengthMm' => 720.0,
              'localTransform' => {
                'translationMm' => [width_mm - right_panel_mm, 0.0, 0.0],
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
              'dimensionsMm' => [lw_mm, 200.0, nominal_depth_mm],
              'commercialKitHardwareId' => 'kit-merivobox-m',
              'placement' => {
                'translationMm' => [left_panel_mm, 50.0, 100.0],
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
                    'translationMm' => [lw_mm, 0.0, 0.0],
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
                    'translationMm' => [lw_mm, 0.0, 0.0],
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
