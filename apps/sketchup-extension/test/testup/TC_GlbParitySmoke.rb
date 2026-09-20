# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'tmpdir'
require 'digest'

module Granete
  module SketchUpExtension
    # #669 Gate P0: SKP <-> GLB numeric parity on the real host.
    #
    # Evolves the #668 edge-wireframe bracket into a closed triangulated solid,
    # mounts it through the productive pipeline with the same proven
    # furniture/assembly/member chain and MountFrame, measures the world
    # position of the reference vertices (SKP side), exports the definition to
    # GLB with Assets::GlbWriter, reads the exported bytes back and computes
    # the world position of the SAME reference points through the identical
    # normalization math (GLB side). Both sides must land on the canonical
    # hand-derived expected world constants (#669 fixture) within tolerance,
    # proving SketchUp and the GLB path interpret the same asset identically.
    #
    # The canonical numbers live ONLY in contracts/fixtures/glb-parity-canonical.json
    # (R12 single-authority pattern): this smoke, the TS domain suite and the Go
    # domain suite all read that file, so no runtime can drift from the contract.
    #
    # The smoke also (re)writes contracts/fixtures/glb-parity-bracket.glb with
    # the host-produced bytes, which is the committed GLB evidence consumed by
    # the TS/Go/WebGL suites.
    class TC_GlbParitySmoke < TestUp::TestCase
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      CANONICAL_PATH = File.join(REPOSITORY_ROOT, 'contracts/fixtures/glb-parity-canonical.json')
      GLB_FIXTURE_PATH = File.join(REPOSITORY_ROOT, 'contracts/fixtures/glb-parity-bracket.glb')
      EVIDENCE_PATH = File.join(REPOSITORY_ROOT, 'progress/host_smoke_669_glb_parity_evidence.json')
      POINT_TOLERANCE_MM = 1e-3
      MUTANT_MIN_ERROR_MM = 1.0
      MM = 1.0 / 25.4
      IDENTITY_BASIS = {
        'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0]
      }.freeze

      PROJECT_ID = '41000000-0000-0000-0000-000000000669'
      DESIGN_ID = '52000000-0000-0000-0000-000000000669'
      FI_1 = '51000000-0000-0000-0000-000000000669'
      FURNITURE_DEF_ID = '50000000-0000-0000-0000-000000000669'
      BRACKET_REVISION_ID = 'rev-glb-parity-bracket-1'

      # Self-contained revision->path stub (TestUp only loads test/testup).
      class StubDownloader
        def initialize(paths_by_revision)
          @paths_by_revision = paths_by_revision
        end

        def download_asset(asset_id:, revision_id:, sha256: nil, expected_bytes: nil, org_id: nil)
          _ = [asset_id, sha256, expected_bytes, org_id]
          @paths_by_revision[revision_id]
        end
      end

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
        'rbzSha256' => current_rbz_sha256,
        'sketchupVersion' => nil,
        'canonicalFixture' => 'contracts/fixtures/glb-parity-canonical.json',
        'glbFixture' => 'contracts/fixtures/glb-parity-bracket.glb',
        'export' => {},
        'skpSide' => {},
        'glbSide' => {},
        'parity' => {},
        'rigidity' => nil,
        'mutantSensitivityMinErrorMm' => {},
        'glbSha256' => nil,
        'tests' => {}
      }

      def evidence
        self.class.evidence
      end

      EXPECTED_NAME = 'Granete for SketchUp'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
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
          flunk "Granete runtime must load from the installed Plugins folder, got #{expanded}"
        end
        plugins_root = expanded.split("#{File::SEPARATOR}Plugins#{File::SEPARATOR}").first
        checkout_root = File.expand_path(REPOSITORY_ROOT)
        flunk 'Host smoke must run against the installed RBZ, not the checkout' if plugins_root == checkout_root
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @tmp_dir = Dir.mktmpdir('granete-glb-parity')
        @canonical = JSON.parse(File.read(CANONICAL_PATH))
        prepare_scratch_bracket_skp
        # Detach the active model from the scratch asset file: SketchUp refuses
        # to definitions.load a .skp that is the active model's own file, which
        # would silently force the member onto the fallback path.
        Sketchup.file_new
        @cache = Granete::SketchUpExtension::Assets::HardwareAssetCache.new(
          cache_dir: File.join(@tmp_dir, 'cache')
        )
        @metadata_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        evidence['sketchupVersion'] ||= Sketchup.version
      end

      def teardown
        FileUtils.remove_entry(@tmp_dir) if @tmp_dir && Dir.exist?(@tmp_dir)
        persist_evidence
        Sketchup.file_new
      end

      def persist_evidence
        FileUtils.mkdir_p(File.dirname(EVIDENCE_PATH))
        File.write(EVIDENCE_PATH, JSON.pretty_generate(evidence))
      rescue StandardError => e
        warn "persist_evidence failed: #{e.message}"
      end

      def model
        Sketchup.active_model
      end

      # ------------------------------------------------------------------
      # The test
      # ------------------------------------------------------------------

      def test_glb_parity_gate_p0
        loader = Granete::SketchUpExtension::Assets::AssetLoader.new(
          downloader: StubDownloader.new(BRACKET_REVISION_ID => @bracket_skp),
          cache: @cache
        )
        builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store,
          asset_loader: loader
        )

        parsed = Granete::SketchUpExtension::Library::LayoutContract.parse!(build_glb_parity_layout)
        t_furniture = Geom::Transformation.translation(
          Geom::Vector3d.new(
            furniture_translation[0] * MM, furniture_translation[1] * MM, furniture_translation[2] * MM
          )
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
        assert result['success'], "placement failed: #{result['error']}"

        furniture = find_furniture(FI_1)
        bracket = find_child_by_name(furniture, 'Soporte GLB Paridad')
        refute_nil bracket, 'bracket must be the real loaded asset (fallback would skip normalization)'

        t_world = furniture.transformation * bracket.transformation
        assert_rigid_transformation(t_world)
        assert_no_shear(t_world, 'world chain')
        evidence['rigidity'] = {
          'scale' => matrix_scale(t_world).map { |v| (v * 1e6).round / 1e6 },
          'determinant' => matrix_determinant(t_world)
        }

        # --- SKP side: measure the real world points of the reference vertices
        skp_world = reference_points_asset_mm.map do |asset_mm|
          measured_local = measured_vertex_mm(bracket.definition, asset_mm)
          measured_world_vertex_mm(furniture, bracket, measured_local)
        end

        # --- GLB side: export the loaded definition, read bytes back, compute
        # world points through the identical normalization + placement math.
        glb_path = File.join(@tmp_dir, 'glb-parity-bracket.glb')
        export_summary = Granete::SketchUpExtension::Assets::GlbWriter.write_definition_to_glb(
          bracket.definition, glb_path
        )
        evidence['export'] = export_summary.merge('deterministicRewrite' => nil)

        # Determinism: exporting the same definition twice yields identical bytes.
        glb_path_again = File.join(@tmp_dir, 'glb-parity-bracket-again.glb')
        Granete::SketchUpExtension::Assets::GlbWriter.write_definition_to_glb(
          bracket.definition, glb_path_again
        )
        deterministic = File.binread(glb_path) == File.binread(glb_path_again)
        assert deterministic, 'GLB writer must be deterministic (same definition, same bytes)'
        evidence['export']['deterministicRewrite'] = deterministic
        evidence['glbSha256'] = Digest::SHA256.file(glb_path).hexdigest

        glb_points_m = Granete::SketchUpExtension::Assets::GlbWriter.read_positions(glb_path)
        glb_world = expected_glb_points_m.map do |expected_glb_m|
          actual_glb = nearest_point(glb_points_m, expected_glb_m)
          distance = vec_distance(actual_glb, expected_glb_m)
          assert distance < canonical_tolerance['glbVertexMatchToleranceM'],
                 "GLB vertex for #{expected_glb_m.inspect} not found (distance #{distance} m)"
          asset_mm = Granete::SketchUpExtension::Assets::GlbWriter.glb_point_to_asset_mm(actual_glb)
          chain_to_world_mm(normalization_mm(asset_mm))
        end

        # --- Parity: SKP world vs GLB world vs canonical expected constants.
        reference_points_asset_mm.each_with_index do |asset_mm, index|
          expected_world = reference_points_expected_world_mm[index]
          skp_error = vec_distance(skp_world[index], expected_world)
          glb_error = vec_distance(glb_world[index], expected_world)
          delta = vec_distance(skp_world[index], glb_world[index])
          assert skp_error < POINT_TOLERANCE_MM,
                 "P#{index} SKP world error #{skp_error} mm > #{POINT_TOLERANCE_MM} mm"
          assert glb_error < POINT_TOLERANCE_MM,
                 "P#{index} GLB world error #{glb_error} mm > #{POINT_TOLERANCE_MM} mm"
          assert delta < POINT_TOLERANCE_MM,
                 "P#{index} SKP<->GLB delta #{delta} mm > #{POINT_TOLERANCE_MM} mm"
          evidence['skpSide']["p#{index}"] = {
            'assetMm' => asset_mm, 'actualWorldMm' => skp_world[index], 'errorMm' => skp_error
          }
          evidence['glbSide']["p#{index}"] = {
            'expectedGlbM' => expected_glb_points_m[index],
            'assetMm' => Granete::SketchUpExtension::Assets::GlbWriter.glb_point_to_asset_mm(
              nearest_point(glb_points_m, expected_glb_points_m[index])
            ),
            'actualWorldMm' => glb_world[index], 'errorMm' => glb_error
          }
          evidence['parity']["p#{index}"] = {
            'skpGlbDeltaMm' => delta, 'expectedWorldMm' => expected_world
          }
        end

        # Dimensions: exported GLB extents in asset mm equal the nominal extents.
        asset_vertices = glb_points_m.map do |point|
          Granete::SketchUpExtension::Assets::GlbWriter.glb_point_to_asset_mm(point)
        end
        extents = asset_vertices.transpose.map { |axis| axis.max - axis.min }
        nominal = nominal_extents_mm
        extents.each_with_index do |extent, axis|
          assert_in_delta nominal[axis], extent, POINT_TOLERANCE_MM,
                          "GLB extent axis #{axis} is #{extent} mm, expected #{nominal[axis]} mm"
        end
        evidence['parity']['dimensionsMm'] = extents
        evidence['parity']['nominalExtentsMm'] = nominal

        # Pairwise distances preserved through the whole chain (world, both sides).
        world_pairwise = [
          vec_distance(glb_world[0], glb_world[1]),
          vec_distance(glb_world[1], glb_world[2]),
          vec_distance(glb_world[0], glb_world[2])
        ]
        expected_pairwise = pairwise_distances_mm
        world_pairwise.each_with_index do |distance, index|
          assert_in_delta expected_pairwise[index], distance, POINT_TOLERANCE_MM,
                          "world pairwise distance #{index} not preserved"
        end
        evidence['parity']['pairwiseDistancesMm'] = world_pairwise

        # Sensitivity: unit confusion, omitted/double normalization and a
        # transposed basis must each move the GLB world points far beyond
        # tolerance (each mutant computed from constants with one deliberate
        # defect, then the unchanged placement chain).
        mutants = {
          'unit_x25_4' => ->(i) { normalization_mm(glb_to_asset_with_scale(expected_glb_points_m[i], 25.4)) },
          'unit_div25_4' => ->(i) { normalization_mm(glb_to_asset_with_scale(expected_glb_points_m[i], 1.0 / 25.4)) },
          'unit_x1000' => ->(i) { normalization_mm(glb_to_asset_with_scale(expected_glb_points_m[i], 1000.0)) },
          'unit_div1000' => ->(i) { normalization_mm(glb_to_asset_with_scale(expected_glb_points_m[i], 0.001)) },
          'omitted' => ->(i) { asset_from_glb_index(i) },
          'double' => ->(i) { normalization_mm(normalization_mm(asset_from_glb_index(i))) },
          'transposed' => ->(i) { normalization_transposed_mm(asset_from_glb_index(i)) }
        }
        mutants.each do |mode, mutant|
          min_error = (0...reference_points_asset_mm.length).map do |index|
            world = chain_to_world_mm(mutant.call(index))
            [vec_distance(world, reference_points_expected_world_mm[index]),
             vec_distance(world, glb_world[index])].min
          end.min
          assert min_error > MUTANT_MIN_ERROR_MM,
                 "mutant #{mode} would not be detectable (min error #{min_error} mm)"
          evidence['mutantSensitivityMinErrorMm'][mode] = min_error
        end

        # Publish the host-produced GLB as the committed fixture (evidence
        # bytes for TS/Go/WebGL suites) and record its digest.
        FileUtils.mkdir_p(File.dirname(GLB_FIXTURE_PATH))
        FileUtils.cp(glb_path, GLB_FIXTURE_PATH)
        evidence['tests']['glb_parity_gate_p0'] = { 'status' => 'pass' }
      end

      private

      # ------------------------------------------------------------ canonical

      def canonical_tolerance
        @canonical.fetch('expected').fetch('tolerance')
      end

      def reference_points_asset_mm
        @canonical.fetch('asset').fetch('referencePointsAssetMm')
      end

      def reference_points_expected_world_mm
        @canonical.fetch('expected').fetch('referencePoints').map { |rp| rp['expectedWorldMm'] }
      end

      def expected_glb_points_m
        @canonical.fetch('glbRepresentation').fetch('expectedGlbReferencePointsM')
      end

      def nominal_extents_mm
        @canonical.fetch('asset').fetch('nominalExtentsMm')
      end

      def pairwise_distances_mm
        distances = @canonical.fetch('expected').fetch('pairwiseDistancesMm')
        [distances['p0p1'], distances['p1p2'], distances['p0p2']]
      end

      def mount_frame
        @canonical.fetch('asset').fetch('mountFrame')
      end

      def furniture_translation
        @canonical.fetch('placementChain').fetch('furniture').fetch('translationMm')
      end

      def assembly_translation
        @canonical.fetch('placementChain').fetch('assembly').fetch('translationMm')
      end

      def member_transform
        @canonical.fetch('placementChain').fetch('member')
      end

      def asset_from_glb_index(index)
        Granete::SketchUpExtension::Assets::GlbWriter.glb_point_to_asset_mm(
          expected_glb_points_m[index]
        )
      end

      # ------------------------------------------------------------- geometry

      # Closed solid: bottom face from the canonical outline, extruded in +Z.
      def prepare_scratch_bracket_skp
        @bracket_skp = File.join(@tmp_dir, 'glb_parity_bracket.skp')
        Sketchup.file_new
        solid_model = model
        outline = @canonical.fetch('asset').fetch('solid').fetch('bottomOutlineMm')
        height = @canonical.fetch('asset').fetch('solid').fetch('extrusionHeightMm')
        points = outline.map { |x, y, z| Geom::Point3d.new(x * MM, y * MM, z * MM) }
        face = solid_model.active_entities.add_face(points)
        refute_nil face, 'canonical outline must produce a face'
        face.reverse! if face.normal.z.negative?
        face.pushpull(height * MM)
        saved = solid_model.save(@bracket_skp)
        flunk 'saving the scratch bracket model failed' unless [true, 0].include?(saved)
      end

      def build_glb_parity_layout
        member = member_transform
        {
          'furnitureDefinitionId' => FURNITURE_DEF_ID,
          'definitionName' => 'GLB Paridad Mueble',
          'transformContract' => 'granete.local-basis.v1',
          'dimensionsMm' => [600.0, 720.0, 560.0],
          'components' => [
            {
              'componentInstanceId' => 'cabinet-side-l',
              'name' => 'Lateral Carcasa Izquierdo',
              'slotId' => 'lateral_carcasa',
              'widthMm' => 15.0,
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
              'assemblyInstanceId' => 'inst-glb-parity-1',
              'agregadoId' => 'agr-glb-parity',
              'recipeRevision' => 1,
              'isHistorical' => false,
              'dimensionsMm' => [570.0, 200.0, 500.0],
              'placement' => {
                'translationMm' => assembly_translation,
                'basis' => { 'x' => [1.0, 0.0, 0.0], 'y' => [0.0, 1.0, 0.0], 'z' => [0.0, 0.0, 1.0] }
              },
              'rigidMembers' => [
                {
                  'memberId' => 'bracket',
                  'role' => 'bracket',
                  'name' => 'Soporte GLB Paridad',
                  'hardwareId' => 'hw-glb-parity-bracket',
                  'assetId' => 'ast-glb-parity-bracket',
                  'assetRevisionId' => BRACKET_REVISION_ID,
                  'preparationState' => 'prepared',
                  'mountFrame' => {
                    'originMm' => mount_frame['originMm'],
                    'basis' => mount_frame['basis']
                  },
                  'localTransform' => {
                    'translationMm' => member['translationMm'],
                    'basis' => member['basis']
                  }
                }
              ],
              'fabricatedComponents' => [],
              'bomItems' => []
            }
          ],
          'hardware' => []
        }
      end

      def catalog_definition
        {
          'furniture_definition_id' => FURNITURE_DEF_ID,
          'name' => 'Mueble Paridad GLB',
          'category' => 'base',
          'default_dimensions' => { 'width' => 600.0, 'height' => 720.0, 'depth' => 560.0 }
        }
      end

      # ------------------------------------------------------------ chain math

      # Mirrors Assets::MountFrame.derive_normalization: T_norm(p) =
      # [bx.(p-O), by.(p-O), bz.(p-O)].
      def normalization_mm(point_mm, origin: nil, basis: nil)
        origin ||= mount_frame['originMm']
        basis ||= mount_frame['basis']
        delta = [0, 1, 2].map { |i| point_mm[i] - origin[i] }
        [dot3(basis['x'], delta), dot3(basis['y'], delta), dot3(basis['z'], delta)]
      end

      def normalization_transposed_mm(point_mm)
        basis = mount_frame['basis']
        origin = mount_frame['originMm']
        delta = [0, 1, 2].map { |i| point_mm[i] - origin[i] }
        [0, 1, 2].map do |i|
          (basis['x'][i] * delta[0]) + (basis['y'][i] * delta[1]) + (basis['z'][i] * delta[2])
        end
      end

      def apply_axes_mm(origin_mm, basis, point_mm)
        [0, 1, 2].map do |i|
          origin_mm[i] +
            (basis['x'][i] * point_mm[0]) +
            (basis['y'][i] * point_mm[1]) +
            (basis['z'][i] * point_mm[2])
        end
      end

      def chain_to_world_mm(normalized_mm)
        member = member_transform
        placed = apply_axes_mm(member['translationMm'], member['basis'], normalized_mm)
        assembly = apply_axes_mm(assembly_translation, IDENTITY_BASIS, placed)
        apply_axes_mm(furniture_translation, IDENTITY_BASIS, assembly)
      end

      def glb_to_asset_with_scale(glb_m, wrong_scale)
        point = Granete::SketchUpExtension::Assets::GlbWriter.glb_point_to_asset_mm(glb_m)
        point.map { |v| v * wrong_scale }
      end

      # ------------------------------------------------------------ utilities

      def dot3(vec_u, vec_v)
        (vec_u[0] * vec_v[0]) + (vec_u[1] * vec_v[1]) + (vec_u[2] * vec_v[2])
      end

      def vec_distance(point_a, point_b)
        Math.sqrt(((point_a[0] - point_b[0])**2) +
                  ((point_a[1] - point_b[1])**2) +
                  ((point_a[2] - point_b[2])**2))
      end

      def nearest_point(points, target)
        best = nil
        best_distance = nil
        points.each do |point|
          d = vec_distance(point, target)
          next unless best_distance.nil? || d < best_distance

          best = point
          best_distance = d
        end
        best
      end

      def find_furniture(instance_id)
        store = @metadata_store
        model.active_entities.grep(Sketchup::ComponentInstance).find do |inst|
          meta = store.read(inst)
          meta && meta.dig('identity', 'furnitureInstanceId') == instance_id
        end
      end

      def find_child_by_name(parent_instance, child_name)
        parent_instance.definition.entities.grep(Sketchup::ComponentInstance).find do |child|
          child.name == child_name
        end
      end

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

      def measured_vertex_mm(definition, expected_asset_mm)
        target = expected_asset_mm.map { |v| v * MM }
        best = nil
        best_distance = nil
        definition_vertex_positions(definition).each do |pos|
          d = vec_distance(pos, target)
          next unless best_distance.nil? || d < best_distance

          best = pos
          best_distance = d
        end
        if best.nil? || best_distance > 1e-4
          flunk "no measured vertex near #{expected_asset_mm.inspect} (best distance #{best_distance})"
        end
        best.map { |v| v * 25.4 }
      end

      def measured_world_vertex_mm(furniture_instance, member_instance, vertex_local_mm)
        local = Geom::Point3d.new(vertex_local_mm[0] * MM, vertex_local_mm[1] * MM, vertex_local_mm[2] * MM)
        world = local.transform(furniture_instance.transformation * member_instance.transformation)
        [world.x * 25.4, world.y * 25.4, world.z * 25.4]
      end

      def assert_rigid_transformation(transformation)
        determinant = matrix_determinant(transformation)
        assert_in_delta 1.0, determinant, 1e-4, "world determinant must be +1 (got #{determinant})"
        matrix_scale(transformation).each_with_index do |scale, axis|
          assert_in_delta 1.0, scale, 1e-4, "world scale axis #{axis} must stay 1 (got #{scale})"
        end
      end

      def matrix_determinant(transformation)
        a = transformation.to_a
        m = [
          [a[0], a[1], a[2]],
          [a[4], a[5], a[6]],
          [a[8], a[9], a[10]]
        ]
        (m[0][0] * ((m[1][1] * m[2][2]) - (m[1][2] * m[2][1]))) -
          (m[0][1] * ((m[1][0] * m[2][2]) - (m[1][2] * m[2][0]))) +
          (m[0][2] * ((m[1][0] * m[2][1]) - (m[1][1] * m[2][0])))
      end

      def matrix_scale(transformation)
        a = transformation.to_a
        columns = [[a[0], a[1], a[2]], [a[4], a[5], a[6]], [a[8], a[9], a[10]]]
        columns.map { |col| Math.sqrt((col[0]**2) + (col[1]**2) + (col[2]**2)) }
      end

      def assert_no_shear(transformation, label)
        a = transformation.to_a
        columns = [[a[0], a[1], a[2]], [a[4], a[5], a[6]], [a[8], a[9], a[10]]]
        pairs = [[0, 1], [0, 2], [1, 2]]
        pairs.each do |i, j|
          dot = dot3(columns[i], columns[j])
          assert_in_delta 0.0, dot, 1e-4, "#{label} has shear (columns #{i}·#{j} = #{dot})"
        end
      end
    end
  end
end
