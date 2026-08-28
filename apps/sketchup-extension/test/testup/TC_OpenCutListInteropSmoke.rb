# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# OpenCutList interoperability smoke for #417 (SU-ENT-4). Builds the canonical
# carpentry cabinet (FI-A, FRONT oak 18) plus a rebuilt sibling (FI-B, FRONT
# white 16) with the INSTALLED Granete extension, round-trips both through a
# saved .skp and asks the installed OpenCutList — driven through its public
# CutlistGenerateWorker, never its UI — how it reads Granete's native
# ComponentInstance hierarchy.
#
# This is COMPATIBILITY EVIDENCE ONLY: every assertion compares OpenCutList's
# reading against the Granete fixture truth (dimensions/thickness/materials by
# role). Granete BOM/manufacturing outputs remain the authority even where
# OpenCutList reports something different, and nothing in this suite may ever
# influence runtime code (the ownership boundary test forbids OpenCutList
# terms in src/).
module Granete
  module SketchUpExtension
    class TC_OpenCutListInteropSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'cabinet_validation_layout.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      EVIDENCE_MARKER = 'GRANETE_OCL_EVIDENCE'

      BOARD_EXPECTATIONS = {
        'Lateral Izquierdo' => [16.0, 16.0],
        'Lateral Derecho' => [16.0, 16.0],
        'Piso' => [16.0, 16.0],
        'Techo' => [16.0, 16.0],
        'Entrepaño' => [16.0, 16.0],
        'Fondo' => [6.0, 6.0],
        'Puerta' => [16.0, 18.0],
        # One 'Frente Cajón N' per cabinet: oak 18 in FI-A, rebuilt white 16
        # in FI-B — the drawer aggregate stays three separately named parts.
        'Frente Cajón 1' => [16.0, 18.0],
        'Frente Cajón 2' => [16.0, 18.0],
        'Frente Cajón 3' => [16.0, 18.0]
      }.freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        fail_closed_unless_opencutlist_is_available
        Sketchup.file_new
        # Deterministic mm formatting for every dimension OpenCutList reports.
        # In SketchUp 2026, Length#to_s follows LengthFormat (decimal) AND
        # LengthUnit (millimeter) together.
        apply_millimeter_units(Sketchup.active_model)
      end

      def teardown
        cleanup_granete_entities
        File.delete(@skp_path) if @skp_path && File.exist?(@skp_path)
      end

      def test_opencutlist_reads_granete_native_cabinet_through_saved_skp
        build_two_cabinets_in_saved_file

        cutlist = run_opencutlist_generation
        report = build_evidence_report(cutlist)
        report['diagnostics'] = model_diagnostics(cutlist)
        dump_evidence(report)

        refute cutlist.errors.any? { |error| error.include?('no_component') },
               'OpenCutList must see the Granete component hierarchy'
        assert cutlist.errors.empty?,
               "OpenCutList reported errors: #{cutlist.errors.inspect}"

        board_parts = flatten_parts(cutlist).select { |part| granete_board?(part) }
        assert board_parts.length >= 20,
               "expected the 20 board ComponentInstances as parts, saw #{board_parts.length}"

        BOARD_EXPECTATIONS.each do |board_name, expected_thicknesses|
          actual = board_parts.select { |part| part_entity_names(part).include?(board_name) }
                              .map { |part| dimension_mm(part[:part].thickness) }.sort
          assert_equal expected_thicknesses, actual,
                       "#{board_name}: OpenCutList thickness reading diverges from Granete truth"
        end

        assert_lateral_dimensions_read_correctly(board_parts)

        groups = cutlist.groups.map { |group| group.material_name.to_s }
        ['Granete · MDF Blanco 16', 'Granete · Roble Macizo 18', 'Granete · HDF Fondo 6'].each do |material|
          assert_includes groups, material,
                          "Granete board material must be visible to OpenCutList: #{material}"
        end

        assert_oak_group_holds_exactly_the_front18_boards(cutlist)
      end

      # ------------------------------------------------------------------
      # Test methods must stay ABOVE this line: TestUp discovers public
      # instance methods only.
      # ------------------------------------------------------------------

      DEFINITION = {
        'furniture_definition_id' => 'gab-cajonero-600',
        'name' => 'Gabinete Base Puerta y Cajones 600',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 }
        ]
      }.freeze

      private

      def model
        Sketchup.active_model
      end

      def builder
        @builder ||= Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: Granete::SketchUpExtension::Metadata::Store.new(model)
        )
      end

      def definition
        DEFINITION
      end

      def cabinet_layout_body
        JSON.parse(File.read(FIXTURE_PATH))
      end

      def front16_layout_body
        body = JSON.parse(File.read(FIXTURE_PATH))
        body['components'].each do |component|
          next unless component['optionRole'] == 'FRONT'

          component['thicknessMm'] = 16
          component['dimensionsMm'][1] = 16
          component['materialId'] = 'mat-white16'
          component['materialCode'] = 'MDG-BLANCO-16'
          component['materialName'] = 'MDF Blanco 16'
          component['materialColorHex'] = '#f2f0eb'
        end
        body['hardware'].each do |placement|
          next unless placement['placementId'].end_with?('-hw-handle')

          placement['transform']['translationMm'][1] = 576
        end
        body
      end

      def parse_layout(body)
        Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
      end

      def build_two_cabinets_in_saved_file
        result_a = builder.insert_furniture(model, definition, {},
                                            resolved_layout: parse_layout(cabinet_layout_body))
        assert result_a['success'], "FI-A insert failed: #{result_a['error']}"
        result_b = builder.insert_furniture(model, definition, {},
                                            resolved_layout: parse_layout(cabinet_layout_body))
        assert result_b['success'], "FI-B insert failed: #{result_b['error']}"

        _top_a, top_b = granete_furniture_instances.first(2)
        rebuild = builder.update_furniture(model, top_b, definition, {},
                                           resolved_layout: parse_layout(front16_layout_body),
                                           material_choices: { 'FRONT' => 'mat-white16' })
        assert rebuild['success'], "FI-B rebuild failed: #{rebuild['error']}"

        # Land FI-B beside FI-A so both stay inside the analysis volume.
        top_b.transformation = Geom::Transformation.translation(Geom::Vector3d.new(700.0 / 25.4, 0, 0))

        @skp_path = File.join(Dir.tmpdir, "granete-ocl-#{Process.pid}.skp")
        assert model.save(@skp_path), 'saving the generated model failed'
        assert Sketchup.open_file(@skp_path), 'reopening the generated .skp failed'
        assert_equal 2, granete_furniture_instances.length,
                     'both Granete cabinets must survive the .skp round-trip'
      end

      # OpenCutList's own synchronous generation path (the exact code its UI
      # command runs), never its dialogs. Read-only analysis of the model.
      # The whole-model flow requires an empty selection: the worker analyzes
      # model.selection instead of the model whenever something is selected
      # (the host can legitimately keep a selection across a reopen).
      def run_opencutlist_generation
        model.selection.clear unless model.selection.empty?
        # Part dimension strings are formatted from the analyzed model's unit
        # options at worker-run time: pin mm again on the reopened file.
        apply_millimeter_units(model)
        require File.join(opencutlist_root, 'ruby', 'worker', 'cutlist', 'cutlist_generate_worker')
        Ladb::OpenCutList::CutlistGenerateWorker.new.run
      end

      def apply_millimeter_units(target_model)
        units = target_model.options['UnitsOptions']
        units['LengthFormat'] = Length::Decimal
        units['LengthUnit'] = Length::Millimeter
        units['LengthPrecision'] = 0 if units.keys.include?('LengthPrecision')
      end

      def opencutlist_root
        @opencutlist_root ||= begin
          plugin_file = $LOADED_FEATURES.map { |path| File.expand_path(path) }
                                        .find { |path| path.end_with?('ladb_opencutlist/ruby/plugin.rb') }
          # plugin_file ends at ladb_opencutlist/ruby/plugin.rb: one level up
          # from ruby/ is the extension root that carries worker/.
          File.expand_path('..', File.dirname(plugin_file))
        end
      end

      # Evidence must survive TestUp's console capture: emit one marker line
      # (capturable in run logs that mirror the console) and always write the
      # full JSON report to a deterministic temp path for curation.
      def dump_evidence(report)
        puts "#{EVIDENCE_MARKER} #{JSON.generate(report)}"
        File.write(File.join(Dir.tmpdir, "granete_ocl_evidence_#{Process.pid}.json"),
                   JSON.pretty_generate(report))
      rescue StandardError
        nil
      end

      def build_evidence_report(cutlist)
        {
          'opencutlistVersion' => Ladb::OpenCutList::EXTENSION_VERSION,
          'sketchupVersion' => Sketchup.version.to_s,
          'rubyVersion' => RUBY_VERSION.to_s,
          'graneteFixture' => 'cabinet_validation_layout.json',
          'model' => 'FI-A (FRONT oak 18) + FI-B (FRONT rebuilt white 16), saved+reopened .skp',
          'errors' => cutlist.errors,
          'tips' => cutlist.tips,
          'groups' => cutlist.groups.map do |group|
            {
              'material' => group.material_name.to_s,
              'type' => group.material_type_strippedname.to_s,
              'partCount' => group.part_count,
              'parts' => group.parts.map do |part|
                {
                  'name' => part.name.to_s,
                  'length' => part.length.to_s,
                  'width' => part.width.to_s,
                  'thickness' => part.thickness.to_s,
                  'count' => part.count,
                  'entityNames' => part.entity_names.to_h
                }
              end
            }
          end
        }
      end

      # Model state around the OpenCutList run: which entities the host hands
      # to the worker and what the worker did with them.
      def model_diagnostics(cutlist)
        active = Sketchup.active_model
        {
          'selectionLength' => active.selection.length,
          'activeEntitiesCount' => active.active_entities.length,
          'topLevel' => active.active_entities.map do |entity|
            {
              'class' => entity.class.name,
              'name' => entity.name.to_s,
              'definition' => entity.respond_to?(:definition) ? entity.definition.name.to_s : nil,
              'visible' => entity.respond_to?(:visible?) ? entity.visible? : nil,
              'layer' => entity.respond_to?(:layer) ? entity.layer.name.to_s : nil,
              'definitionInstances' => entity.respond_to?(:definition) ? entity.definition.instances.length : nil
            }
          end,
          'oclInstanceCount' => cutlist.instance_count,
          'oclIgnoredInstanceCount' => cutlist.ignored_instance_count
        }
      rescue StandardError => e
        { 'error' => "#{e.class}: #{e.message}" }
      end

      def flatten_parts(cutlist)
        cutlist.groups.flat_map do |group|
          group.parts.map { |part| { group: group.material_name.to_s, part: part } }
        end
      end

      def granete_board?(part_entry)
        part_entity_names(part_entry).any? { |name| BOARD_EXPECTATIONS.key?(name) }
      end

      def part_entity_names(part_entry)
        part_entry[:part].entity_names.to_h.keys.map(&:to_s)
      end

      def dimension_mm(formatted)
        formatted.to_s[/\d+(?:[.,]\d+)?/].to_s.tr(',', '.').to_f
      end

      def assert_lateral_dimensions_read_correctly(board_parts)
        lateral = board_parts.find { |part| part_entity_names(part).include?('Lateral Izquierdo') }
        refute_nil lateral, 'laterals must be visible as parts to OpenCutList'
        # Auto-oriented solid read: thickness 16 and the 688x544 cutting face.
        assert_in_delta 16.0, dimension_mm(lateral[:part].thickness), 0.2
        assert_in_delta 688.0, dimension_mm(lateral[:part].length), 0.2
        assert_in_delta 544.0, dimension_mm(lateral[:part].width), 0.2
      end

      def assert_oak_group_holds_exactly_the_front18_boards(cutlist)
        oak_group = cutlist.groups.find { |group| group.material_name.to_s == 'Granete · Roble Macizo 18' }
        refute_nil oak_group, 'the oak-18 material group must exist'
        oak_names = oak_group.parts.flat_map { |part| part.entity_names.to_h.keys.map(&:to_s) }.uniq.sort
        expected = ['Frente Cajón 1', 'Frente Cajón 2', 'Frente Cajón 3', 'Puerta'].freeze
        assert_equal expected, oak_names,
                     'material interpretation: oak-18 group must be exactly FI-A front boards'
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          entity.definition.name.to_s.start_with?('Granete · Mueble · ')
        end
      end

      def cleanup_granete_entities
        current = begin
          model
        rescue StandardError
          nil
        end
        return unless current

        granete_furniture_instances.each do |entity|
          entity.erase! if entity.valid?
        end
        current.definitions.to_a.each do |definition|
          next unless definition.name.to_s.start_with?('Granete · ')

          current.definitions.remove(definition)
        end
      rescue StandardError
        nil
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

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end

      def fail_closed_unless_opencutlist_is_available
        unless defined?(Ladb::OpenCutList) && Ladb::OpenCutList.const_defined?(:EXTENSION_VERSION)
          flunk 'OpenCutList must be installed and loaded for this interoperability smoke (#417)'
        end
        return if $LOADED_FEATURES.map { |path| File.expand_path(path) }
                                  .any? { |path| path.end_with?('ladb_opencutlist/ruby/plugin.rb') }

        flunk 'OpenCutList plugin files are not locatable; cannot drive its generation worker'
      end
    end
  end
end
