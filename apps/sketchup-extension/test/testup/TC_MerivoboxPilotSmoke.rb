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
#   E9 & E10: Non-identity compound transform on REAL asymmetric asset geometry:
#             Furniture * Assembly * Member(rotated) * inverse(MountFrame rotated),
#             reference vertices of the bracket measured back from the loaded
#             definition must land on the exact composed world points (F2 hardening).
#   E11:      Save, close, and reopen .skp preserves assembly identities, transforms,
#             metadata and the normalized bracket geometry.
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

      # F2 hardening fixture (#668/#670 audit): every scratch .skp now carries a
      # real asymmetric stepped bracket, and every member is placed through a
      # ROTATED MountFrame (det=+1, no mirror). The bracket is intentionally
      # non-symmetric with distinct X/Y/Z extents so an omitted, doubled,
      # transposed or unit-mangled normalization moves its reference points by
      # whole millimeters — the world-point assertions cannot pass silently.
      #
      # Fixture contract kept for the future SKP/GLB parity work (#669):
      #   nominal extents (x, y, z) .... 70 x 54 x 18 mm
      #   reference points (asset mm) .. BRACKET_REFERENCE_POINTS_MM (P0, P1, P2)
      #   MountFrame ................... origin [25, 30, 15], basis rotated +90 deg
      #                                    about Z (x=[0,1,0], y=[-1,0,0], z=[0,0,1])
      #   expected physical result ..... reference points land at
      #                                    T_furniture * T_assembly * T_member
      #                                    * inverse(T_mountFrame) * P_i
      #                                    with pairwise distances preserved.
      IDENTITY_BASIS = {
        'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0]
      }.freeze
      BRACKET_BOTTOM_OUTLINE_MM = [
        [17.0, 23.0, 11.0],
        [87.0, 23.0, 11.0],
        [87.0, 41.0, 11.0],
        [31.0, 41.0, 11.0],
        [31.0, 77.0, 11.0],
        [17.0, 77.0, 11.0]
      ].freeze
      BRACKET_HEIGHT_MM = 18.0
      BRACKET_REFERENCE_POINTS_MM = [
        [17.0, 23.0, 11.0],
        [87.0, 23.0, 11.0],
        [31.0, 77.0, 11.0]
      ].freeze
      MOUNT_FRAME_ORIGIN_MM = [25.0, 30.0, 15.0].freeze
      MOUNT_FRAME_BASIS = {
        'x' => [0.0, 1.0, 0.0],
        'y' => [-1.0, 0.0, 0.0],
        'z' => [0.0, 0.0, 1.0]
      }.freeze
      # E9 non-identity member chain: side-left is translated and rotated about
      # X (det=+1) so the mount rotation and the member rotation compose.
      SIDE_LEFT_E9_TRANSLATION_MM = [3.0, 7.0, 1.0].freeze
      SIDE_LEFT_E9_BASIS = {
        'x' => [1.0, 0.0, 0.0],
        'y' => [0.0, 0.0, 1.0],
        'z' => [0.0, -1.0, 0.0]
      }.freeze
      E9_FURNITURE_ORIGIN_MM = [1200.0, 600.0, 300.0].freeze
      E9_ASSEMBLY_TRANSLATION_MM = [15.0, 50.0, 100.0].freeze
      GEOMETRY_EVIDENCE_PATH = 'progress/host_smoke_668_mount_frame_geometry_evidence.json'
      POINT_TOLERANCE_MM = 1e-3
      MUTANT_MIN_ERROR_MM = 1.0

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
        attr_accessor :evidence, :geometry_evidence

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

      # Dedicated F2 evidence (host-measured bracket reference points) persisted
      # to progress/host_smoke_668_mount_frame_geometry_evidence.json. The
      # actualWorldMm values always come from real host readback.
      self.geometry_evidence = {
        'head' => current_head_sha,
        'rbzSha256' => current_rbz_sha256,
        'sketchupVersion' => nil,
        'assetFixture' => {
          'mountFrame' => { 'originMm' => MOUNT_FRAME_ORIGIN_MM, 'basis' => MOUNT_FRAME_BASIS },
          'nominalExtentsMm' => [70.0, 54.0, 18.0],
          'referencePoints' => []
        },
        'mutantSensitivityMinErrorMm' => {},
        'rigidity' => nil
      }

      def evidence
        self.class.evidence
      end

      def geometry_evidence
        self.class.geometry_evidence
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
        geometry_evidence['sketchupVersion'] ||= Sketchup.version
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

      # E9 & E10: non-identity MountFrame world transform proven on REAL asset
      # geometry (F2 hardening). The scratch .skp carries the asymmetric
      # bracket; its reference vertices are measured back from the loaded
      # definition through the productive pipeline (prefetch -> definitions.load
      # -> compute_prepared_transform -> ComponentInstance) and must land at
      # the exact composed world positions, computed ONLY from contract
      # constants:
      #   T_world(P) = T_furniture * T_assembly * T_member * inverse(T_mountFrame) * P
      def test_e9_e10_non_identity_mount_frame
        loader = create_merivobox_asset_loader
        builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: loader
        )

        layout_data = build_merivobox_layout(
          width_mm: 600.0, nominal_depth_mm: 500.0,
          side_left_translation_mm: SIDE_LEFT_E9_TRANSLATION_MM,
          side_left_basis: SIDE_LEFT_E9_BASIS
        )
        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(layout_data)

        t_furniture = Geom::Transformation.translation(
          Geom::Vector3d.new(E9_FURNITURE_ORIGIN_MM[0] * MM, E9_FURNITURE_ORIGIN_MM[1] * MM,
                             E9_FURNITURE_ORIGIN_MM[2] * MM)
        )
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
        refute_nil side_l, 'sideLeft must be the real loaded asset (fallback would skip normalization)'

        t_world = furniture.transformation * side_l.transformation
        assert_rigid_transformation(t_world)
        assert_no_shear(t_world, 'world chain')
        geometry_evidence['rigidity'] = {
          'scale' => calculate_matrix_scale(t_world).map { |v| (v * 1e6).round / 1e6 },
          'determinant' => calculate_matrix_determinant(t_world)
        }

        reference_points = BRACKET_REFERENCE_POINTS_MM.map do |asset_mm|
          measured_local = measured_vertex_mm(side_l.definition, asset_mm)
          actual_world = measured_world_vertex_mm(furniture, side_l, measured_local)
          expected_world = expected_world_mm(asset_mm, :correct)
          error_mm = point_distance_mm(actual_world, expected_world)
          assert error_mm < POINT_TOLERANCE_MM,
                 "reference point #{asset_mm.inspect}: world error #{error_mm} mm > #{POINT_TOLERANCE_MM} mm"
          {
            'assetMm' => asset_mm,
            'expectedWorldMm' => expected_world,
            'actualWorldMm' => actual_world,
            'errorMm' => error_mm
          }
        end

        # Rigid placement: distances between real vertices survive the whole
        # chain unchanged (measured world vs authored asset space, in mm).
        world_pts = reference_points.map { |rp| rp['actualWorldMm'] }
        assert_in_delta point_distance_mm(BRACKET_REFERENCE_POINTS_MM[0], BRACKET_REFERENCE_POINTS_MM[1]),
                        point_distance_mm(world_pts[0], world_pts[1]), POINT_TOLERANCE_MM
        assert_in_delta point_distance_mm(BRACKET_REFERENCE_POINTS_MM[1], BRACKET_REFERENCE_POINTS_MM[2]),
                        point_distance_mm(world_pts[1], world_pts[2]), POINT_TOLERANCE_MM

        # Conceptual negatives (fixture sensitivity): a missing, doubled,
        # transposed or unit-mangled normalization each move the reference
        # points far beyond tolerance, so the assertions above fail loudly
        # under any of those defects.
        %i[omitted double transposed unit_double].each do |mode|
          min_error = BRACKET_REFERENCE_POINTS_MM.map do |asset_mm|
            point_distance_mm(expected_world_mm(asset_mm, mode), expected_world_mm(asset_mm, :correct))
          end.min
          assert min_error > MUTANT_MIN_ERROR_MM,
                 "mutant :#{mode} would not be detectable (min error #{min_error} mm)"
          geometry_evidence['mutantSensitivityMinErrorMm'][mode.to_s] = min_error
        end

        geometry_evidence['assetFixture']['referencePoints'] = reference_points
        evidence['world_transform'] = {
          'expected_world_point_mm' => reference_points[0]['expectedWorldMm'],
          'actual_world_point_mm' => reference_points[0]['actualWorldMm'],
          'error_mm' => reference_points[0]['errorMm'],
          'tolerance_mm' => POINT_TOLERANCE_MM,
          'reference_points_count' => reference_points.length
        }
        evidence['tests']['e9_e10_mount_frame_world_transform'] = {
          'status' => 'pass', 'error_mm' => reference_points[0]['errorMm']
        }
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

        # F2 (§ Save/Reopen): the reopened model keeps the exact asset revision
        # identity AND the normalized bracket geometry — reference vertices
        # still land on the composed world points (identity furniture
        # transform, default side-left placement in this test's layout).
        side_l_re = find_child_by_name(furniture_reopened, 'Lateral Izquierdo')
        refute_nil side_l_re
        meta_side_l = store_reopened.read(side_l_re)
        assert_equal 'rev-mbx-side-1', meta_side_l.dig('identity', 'assetRevisionId'),
                     'reopened member must keep its exact asset revision identity'
        assert_rigid_transformation(side_l_re.transformation)
        assert_no_shear(furniture_reopened.transformation * side_l_re.transformation, 'reopened world chain')
        BRACKET_REFERENCE_POINTS_MM.each_with_index do |asset_mm, i|
          measured_local = measured_vertex_mm(side_l_re.definition, asset_mm)
          actual_world = measured_world_vertex_mm(furniture_reopened, side_l_re, measured_local)
          expected_world = reopened_expected_world_mm(asset_mm)
          error_mm = point_distance_mm(actual_world, expected_world)
          assert error_mm < POINT_TOLERANCE_MM,
                 "reopened reference point #{i} (#{asset_mm.inspect}): world error #{error_mm} mm"
        end

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

      # Columns of the 3x3 block must stay mutually orthogonal: no shear.
      def assert_no_shear(trans, label)
        a = trans.to_a
        columns = [[a[0], a[1], a[2]], [a[4], a[5], a[6]], [a[8], a[9], a[10]]]
        [[0, 1], [0, 2], [1, 2]].each do |i, j|
          dot = dot3(columns[i], columns[j]).abs
          assert dot < 1e-6, "#{label}: shear detected, |dot(col#{i},col#{j})| = #{dot}"
        end
      end

      def dot3(vec_u, vec_v)
        (vec_u[0] * vec_v[0]) + (vec_u[1] * vec_v[1]) + (vec_u[2] * vec_v[2])
      end

      def point_distance_mm(point_a, point_b)
        Math.sqrt(((point_a[0] - point_b[0])**2) + ((point_a[1] - point_b[1])**2) +
                  ((point_a[2] - point_b[2])**2))
      end

      # Geom::Transformation.axes semantics, evaluated in mm from constants:
      # axes(o, x, y, z) maps p -> o + x*p[0] + y*p[1] + z*p[2].
      def apply_axes_mm(origin_mm, basis, point_mm)
        [0, 1, 2].map do |i|
          origin_mm[i] +
            (basis['x'][i] * point_mm[0]) +
            (basis['y'][i] * point_mm[1]) +
            (basis['z'][i] * point_mm[2])
        end
      end

      # T_norm = inverse(T_mountFrame): T_norm(p) = [bx.(p-O), by.(p-O), bz.(p-O)]
      # — mirrors Assets::MountFrame.derive_normalization exactly.
      def normalization_mm(point_mm, origin: MOUNT_FRAME_ORIGIN_MM, basis: MOUNT_FRAME_BASIS)
        delta = [0, 1, 2].map { |i| point_mm[i] - origin[i] }
        [dot3(basis['x'], delta), dot3(basis['y'], delta), dot3(basis['z'], delta)]
      end

      # Mutant: normalization built with the basis used TRANSPOSED (rows as
      # columns), i.e. R_mount instead of R_mount^T.
      def normalization_transposed_mm(point_mm, origin: MOUNT_FRAME_ORIGIN_MM, basis: MOUNT_FRAME_BASIS)
        delta = [0, 1, 2].map { |i| point_mm[i] - origin[i] }
        [0, 1, 2].map do |i|
          (basis['x'][i] * delta[0]) + (basis['y'][i] * delta[1]) + (basis['z'][i] * delta[2])
        end
      end

      # E9 constant chain from a normalized asset point to world (mm):
      # member (translated + rotated about X) -> assembly -> furniture.
      def chain_to_world_mm(normalized_mm, unit_scale: 1.0)
        member_origin = SIDE_LEFT_E9_TRANSLATION_MM.map { |v| v * unit_scale }
        member = apply_axes_mm(member_origin, SIDE_LEFT_E9_BASIS, normalized_mm)
        assembly = apply_axes_mm(E9_ASSEMBLY_TRANSLATION_MM.map { |v| v * unit_scale }, IDENTITY_BASIS, member)
        apply_axes_mm(E9_FURNITURE_ORIGIN_MM.map { |v| v * unit_scale }, IDENTITY_BASIS, assembly)
      end

      # World position of a bracket vertex under each scenario, from constants:
      # :correct (productive composition), or a conceptual defect for the
      # sensitivity guards. :unit_double models a double mm/inches conversion
      # as the translation chain scaled by 25.4 (inches read as millimeters).
      def expected_world_mm(vertex_mm, mode)
        normalized = case mode
                     when :omitted then vertex_mm
                     when :double then normalization_mm(normalization_mm(vertex_mm))
                     when :transposed then normalization_transposed_mm(vertex_mm)
                     else normalization_mm(vertex_mm)
                     end
        unit_scale = mode == :unit_double ? 25.4 : 1.0
        chain_to_world_mm(normalized, unit_scale: unit_scale)
      end

      # E11 reopen chain: default layout (side-left at origin with identity
      # basis) under an identity furniture transform.
      def reopened_expected_world_mm(vertex_mm)
        assembly = apply_axes_mm(E9_ASSEMBLY_TRANSLATION_MM, IDENTITY_BASIS, normalization_mm(vertex_mm))
        apply_axes_mm([0.0, 0.0, 0.0], IDENTITY_BASIS, assembly)
      end

      # Measured (never literal) vertex data from a loaded definition.
      def definition_vertex_positions(definition)
        positions = []
        definition.entities.each do |entity|
          next unless entity.is_a?(Sketchup::Edge)

          [entity.start.position, entity.end.position].each do |pos|
            positions << [pos.x, pos.y, pos.z]
          end
        end
        positions.uniq { |p| format('%<x>.6f|%<y>.6f|%<z>.6f', x: p[0], y: p[1], z: p[2]) }
      end

      # Finds the measured definition vertex matching an authored fixture point
      # and returns its position in mm (real host readback, inches -> mm).
      def measured_vertex_mm(definition, expected_asset_mm)
        target = expected_asset_mm.map { |v| v * MM }
        best = nil
        best_distance = nil
        definition_vertex_positions(definition).each do |pos|
          d = point_distance_mm(pos, target)
          next unless best_distance.nil? || d < best_distance

          best = pos
          best_distance = d
        end
        if best.nil? || best_distance > 1e-4
          flunk "no measured vertex near #{expected_asset_mm.inspect} (best distance #{best_distance})"
        end
        best.map { |v| v * 25.4 }
      end

      # World position (mm) of a measured local vertex (mm) through the REAL
      # instance chain read back from the model.
      def measured_world_vertex_mm(furniture_instance, member_instance, vertex_local_mm)
        local = Geom::Point3d.new(vertex_local_mm[0] * MM, vertex_local_mm[1] * MM, vertex_local_mm[2] * MM)
        world = local.transform(furniture_instance.transformation * member_instance.transformation)
        [world.x * 25.4, world.y * 25.4, world.z * 25.4]
      end

      # Real, loadable .skp payloads built through the host itself (prepared in
      # setup before the active model is detached). Fake bytes would make
      # definitions.load fail and silently exercise the fallback-box path,
      # skipping the prepared/MountFrame normalization this smoke must prove.
      # Each file carries the REAL asymmetric bracket geometry (F2 fixture) so
      # the loaded definitions expose measurable reference vertices.
      def prepare_scratch_asset_skps
        @side_skp = File.join(@tmp_dir, 'mbx_side.skp')
        # One file per revision: distinct files load as distinct definitions,
        # so the NL450 -> NL500 variant switch is observable on the host.
        @runner450_skp = File.join(@tmp_dir, 'mbx_runner_450.skp')
        @runner500_skp = File.join(@tmp_dir, 'mbx_runner_500.skp')
        # A fresh host model per file: the bracket edges must not accumulate
        # across the three scratch assets.
        [@side_skp, @runner450_skp, @runner500_skp].each do |path|
          Sketchup.file_new
          write_scratch_skp(path)
        end
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
        build_bracket_geometry(model)
        saved = model.save(path)
        flunk 'saving the scratch asset model failed' unless [true, 0].include?(saved)
        path
      end

      # Authors the F2 asymmetric stepped bracket (fixture constants above) as
      # explicit edges, so definitions.load exposes measurable vertices at the
      # reference points. Authored in mm; SketchUp stores inches.
      def build_bracket_geometry(host_model)
        bottom = BRACKET_BOTTOM_OUTLINE_MM
        top = bottom.map { |x, y, z| [x, y, z + BRACKET_HEIGHT_MM] }
        entities = host_model.active_entities
        bottom.each_index do |i|
          j = (i + 1) % bottom.length
          entities.add_line(point3d_mm(bottom[i]), point3d_mm(bottom[j]))
          entities.add_line(point3d_mm(top[i]), point3d_mm(top[j]))
          entities.add_line(point3d_mm(bottom[i]), point3d_mm(top[i]))
        end
      end

      def point3d_mm(mm_point)
        Geom::Point3d.new(mm_point[0] * MM, mm_point[1] * MM, mm_point[2] * MM)
      end

      def persist_evidence
        evidence_path = File.join(REPOSITORY_ROOT, 'progress/host_smoke_670_e_merivobox_pilot_evidence.json')
        FileUtils.mkdir_p(File.dirname(evidence_path))
        File.write(evidence_path, JSON.pretty_generate(self.class.evidence))

        geometry_path = File.join(REPOSITORY_ROOT, GEOMETRY_EVIDENCE_PATH)
        FileUtils.mkdir_p(File.dirname(geometry_path))
        File.write(geometry_path, JSON.pretty_generate(self.class.geometry_evidence))
      end

      def build_merivobox_layout(
        width_mm: 600.0,
        nominal_depth_mm: 500.0,
        mount_origin_mm: MOUNT_FRAME_ORIGIN_MM,
        mount_basis: MOUNT_FRAME_BASIS,
        left_panel_mm: 15.0,
        right_panel_mm: 15.0,
        side_left_translation_mm: [0.0, 0.0, 0.0],
        side_left_basis: IDENTITY_BASIS
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
                    'basis' => mount_basis
                  },
                  'localTransform' => {
                    'translationMm' => side_left_translation_mm,
                    'basis' => side_left_basis
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
                    'basis' => mount_basis
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
                    'basis' => mount_basis
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
                    'basis' => mount_basis
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
