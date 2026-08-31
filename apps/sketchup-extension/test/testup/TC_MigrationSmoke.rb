# frozen_string_literal: true

require 'json'
require 'stringio'
require 'tmpdir'
require 'testup/testcase'

# Host smoke for the #416 legacy Group → native ComponentInstance migration.
# Like TC_NativeEntitySmoke, the product under test is the INSTALLED RBZ: the
# legacy scene is built in-code with the historical metadata shape, and the
# authoritative layout is injected from the repo fixture exactly like the
# insertion smoke (the catalog provider is test infrastructure; the pipeline
# under test — scanner, migrator, builder — comes from the installed runtime).
module Granete
  module SketchUpExtension
    class TC_MigrationSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'native_layout.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4
      LEGACY_GROUP_NAME = 'Mueble anterior smoke'
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
      end

      def teardown
        cleanup_granete_entities
      end

      def test_successful_migration_preserves_identity_transform_and_marker
        legacy = add_legacy_furniture('inst-smoke-1',
                                      Geom::Transformation.translation(Geom::Vector3d.new(100 * MM, 50 * MM, 30 * MM)))

        report = migrate_compatible

        assert report['success'], "migration failed: #{report['error']}"
        assert report['allMigrated'], "unexpected leftovers: #{report['requiresReview']}"
        refute legacy.valid?, 'legacy Group must be erased after its validated replacement'

        native = granete_furniture_instances.first
        refute_nil native, 'native furniture instance missing after migration'

        metadata = metadata_store.read(native)
        assert_equal 'inst-smoke-1', metadata.dig('identity', 'instanceRef'),
                     'business identity must survive the representation change'
        assert_nil metadata.dig('identity', 'furnitureInstanceId'),
                   'migration must never invent Project identity'
        assert_equal 'legacy-group', metadata.dig('provenance', 'representationMigration', 'from')

        assert_transforms_equal Geom::Transformation.translation(Geom::Vector3d.new(100 * MM, 50 * MM, 30 * MM)),
                                native.transformation

        # No managed Group anywhere in the migrated hierarchy: children are
        # native ComponentInstances only.
        assert native.definition.entities.grep(Sketchup::Group).empty?,
               'migrated hierarchy must not contain managed Groups'
        assert native.definition.entities.grep(Sketchup::ComponentInstance).length.positive?,
               'native hierarchy must carry component children'
      end

      # AC9 + batch policy: ONE undo action reverts the whole migration and
      # restores the legacy Group (with its identity) intact.
      def test_single_undo_reverts_the_whole_migration_to_legacy
        add_legacy_furniture('inst-smoke-undo', Geom::Transformation.new)

        report = migrate_compatible
        assert report['success'], "migration failed: #{report['error']}"
        assert_equal 1, granete_furniture_instances.length

        Sketchup.send_action('editUndo:')

        assert granete_furniture_instances.empty?, 'one undo must remove the migrated native furniture'
        legacy = model.entities.grep(Sketchup::Group).find { |g| g.name == LEGACY_GROUP_NAME }
        refute_nil legacy, 'one undo must restore the legacy Group source'
        assert_equal 'inst-smoke-undo', metadata_store.read(legacy).dig('identity', 'instanceRef'),
                     'restored legacy identity must be untouched'
      end

      # AC6 on the real host: a resolution failure leaves the source intact.
      def test_failed_resolution_preserves_the_legacy_source
        legacy = add_legacy_furniture('inst-smoke-fail', Geom::Transformation.new)

        report = migrate_compatible(layout: nil)

        refute report['success']
        assert_equal 'resolve-unavailable', report['requiresReview'].first['reason']
        assert legacy.valid?, 'legacy source must survive a failed resolution'
        assert granete_furniture_instances.empty?
      end

      # AC8: a successfully migrated model does not ask again after
      # save/reopen — the scan finds nothing legacy, so no offer fires.
      def test_save_and_reopen_does_not_re_prompt
        add_legacy_furniture('inst-smoke-reopen', Geom::Transformation.new)
        assert migrate_compatible['success']

        Dir.mktmpdir do |directory|
          path = File.join(directory, 'granete_migration_smoke.skp')
          assert model.save(path), 'saving the migrated model failed'

          reopened = Sketchup.open_file(path)
          assert reopened, 'reopen of the migrated model failed'

          result = scanner.scan(model)
          refute result.any_legacy?,
                 "reopened model still reports legacy furniture: #{result.counts}"
        end
      end

      private

      def model
        Sketchup.active_model
      end

      def metadata_store
        @metadata_store ||= Granete::SketchUpExtension::Metadata::Store.new(model)
      end

      def scanner
        Granete::SketchUpExtension::Migration::Scanner.new(metadata_store: metadata_store)
      end

      def builder
        Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: metadata_store)
      end

      # Duck-typed provider (test infrastructure): returns the fixture
      # layout, or nil to simulate an unresolvable catalog.
      class FixtureCatalogProvider
        def initialize(layout)
          @layout = layout
        end

        def find_definition(definition_id)
          { 'furniture_definition_id' => definition_id, 'name' => 'Bajo smoke',
            'revisionId' => 'rev-smoke' }
        end

        def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
          @layout
        end
      end

      def migrate_compatible(layout: :fixture)
        native_layout = layout == :fixture ? parsed_fixture_layout : nil
        migrator = Granete::SketchUpExtension::Migration::Migrator.new(
          metadata_store: metadata_store,
          furniture_builder: builder,
          catalog_provider: FixtureCatalogProvider.new(native_layout)
        )
        migrator.migrate(model, scanner.scan(model))
      end

      def parsed_fixture_layout
        Granete::SketchUpExtension::Library::LayoutContract.parse!(JSON.parse(File.read(FIXTURE_PATH)))
      end

      # Builds the legacy scene with the HISTORICAL metadata shape: top-level
      # Group carrying kind='furnitureInstance' plus nested component Groups
      # without componentInstanceId/entityClass (pre-#415 writer output).
      def add_legacy_furniture(instance_ref, transform)
        group = model.entities.add_group
        group.name = LEGACY_GROUP_NAME
        group.transformation = transform
        metadata_store.write(group, {
                               'namespace' => 'com.granete.sketchup_extension',
                               'metadataVersion' => 1,
                               'kind' => 'furnitureInstance',
                               'identity' => {
                                 'instanceRef' => instance_ref,
                                 'projectRef' => metadata_store.project_ref,
                                 'sourceRevisionRef' => 'rev-legacy'
                               },
                               'intent' => {
                                 'semanticRole' => 'furniture-instance',
                                 'furnitureDefinitionId' => 'kitchen-base-standard',
                                 'parameters' => { 'widthMm' => 600 }
                               }
                             })
        child = group.entities.add_group
        child.name = 'componente anterior'
        metadata_store.write(child, {
                               'namespace' => 'com.granete.sketchup_extension',
                               'metadataVersion' => 1,
                               'kind' => 'componentInstance',
                               'identity' => {
                                 'instanceRef' => "#{instance_ref}-comp-0",
                                 'projectRef' => metadata_store.project_ref
                               },
                               'intent' => { 'semanticRole' => 'slot_0' }
                             })
        group
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          entity.definition.name.to_s.start_with?('Granete · Mueble · ')
        end
      end

      def granete_definitions
        model.definitions.select do |definition|
          GRANETE_DEFINITION_PREFIXES.any? { |prefix| definition.name.to_s.start_with?(prefix) }
        end
      end

      def assert_transforms_equal(expected, actual)
        expected.to_a.each_with_index do |value, index|
          assert_in_delta value, actual.to_a[index], 1e-6,
                          "transform component #{index}: expected #{value}, got #{actual.to_a[index]}"
        end
      end

      def cleanup_granete_entities
        current = begin
          model
        rescue StandardError
          nil
        end
        return unless current

        current.entities.grep(Sketchup::Group).each do |group|
          group.erase! if group.valid? && group.name == LEGACY_GROUP_NAME
        end
        granete_furniture_instances.each do |entity|
          entity.erase! if entity.valid?
        end
        current.definitions.to_a.each do |definition|
          next unless GRANETE_DEFINITION_PREFIXES.any? { |p| definition.name.to_s.start_with?(p) }

          current.definitions.remove(definition) if definition.instances.empty?
        end
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
    end
  end
end
