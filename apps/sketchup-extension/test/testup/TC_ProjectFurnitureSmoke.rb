# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Host smoke for #389 / DT-5 Place EXISTING FurnitureInstance: the INSTALLED
# extension must materialize the native #415 hierarchy with the backend's
# furnitureInstanceId stamped as authoritative business identity, keep the
# technical locator separate, and keep the identity resolvable across
# save/close/reopen. Like TC_ModelBindingSmoke, this suite proves the host
# persistence/placement half; business identity itself stays backend-owned
# (placer unit tests prove the server-side rules).
module Granete
  module SketchUpExtension
    class TC_ProjectFurnitureSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'
      DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
      end

      def teardown
        Sketchup.file_new
      end

      def test_place_existing_stamps_server_identity_in_native_hierarchy
        result = builder.place_existing_furniture(
          model, furniture_instance_id: FI_1, definition: catalog_definition,
                 parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
                 project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        assert result['success'], "host placement failed: #{result['error']}"

        placed = top_level_furniture.find do |entity|
          metadata_store.read(entity)&.dig('identity', 'furnitureInstanceId') == FI_1
        end
        refute_nil placed, 'placed furniture must carry the server furnitureInstanceId'

        # Native #415 representation: a top-level ComponentInstance with
        # nested managed part ComponentInstances — never a Group.
        assert_kind_of Sketchup::ComponentInstance, placed
        nested = placed.definition.entities.grep(Sketchup::ComponentInstance)
        refute_empty nested, 'the native hierarchy must contain managed parts'

        metadata = metadata_store.read(placed)
        assert_equal FI_1, metadata.dig('identity', 'instanceRef'),
                     'instanceRef aliases the server identity (compat locator)'
        assert_equal PROJECT_ID, metadata.dig('identity', 'projectId')
        assert_equal DESIGN_ID, metadata.dig('identity', 'designId')
        assert_equal DEFINITION_ID, metadata.dig('intent', 'furnitureDefinitionId')

        # The host locator exists and is DIFFERENT from the business identity.
        refute_nil placed.persistent_id
        refute_equal FI_1, placed.persistent_id.to_s
      end

      def test_placed_identity_survives_save_close_and_reopen
        Dir.mktmpdir('granete-project-furniture') do |dir|
          path = File.join(dir, 'cocina-garcia.skp')
          builder.place_existing_furniture(
            model, furniture_instance_id: FI_1, definition: catalog_definition,
                   parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
          )
          assert model.save(path), 'the host must save the model'

          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the model'

          located = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
          refute_nil located['entity'], 'placed identity must resolve after reopen'
          assert_equal 1, located['duplicates'], 'reopen must not duplicate the identity'
        end
      end

      def test_copy_paste_duplicate_identity_fails_loud_not_valid
        # Two roots sharing one furnitureInstanceId is #391's invalid steady
        # state: the locator must report it loudly — never count two business
        # units, never mint a new identity.
        first = builder.place_existing_furniture(
          model, furniture_instance_id: FI_1, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        assert first['success'], first.inspect

        model.selection.clear
        model.selection.add(first['entity'])
        model.active_entities.add_instance(first['entity'].definition, first['entity'].transformation)

        located = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        assert_equal 2, located['duplicates'], 'a copied root keeps the same business id'
      end

      def test_duplicate_identity_detected_by_resolver_publish_precheck
        first = builder.place_existing_furniture(
          model, furniture_instance_id: FI_1, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        assert first['success'], first.inspect

        model.selection.clear
        model.selection.add(first['entity'])
        model.active_entities.add_instance(first['entity'].definition, first['entity'].transformation)

        precheck = Connection::DuplicateResolver.validate_model(model)
        refute precheck['valid'], 'precheck must reject duplicate business identity'
        assert_equal 'duplicate_furniture_identity', precheck['code']
      end

      def test_two_units_of_same_definition_keep_distinct_identities
        first = builder.place_existing_furniture(
          model, furniture_instance_id: FI_1, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        second = builder.place_existing_furniture(
          model, furniture_instance_id: FI_2, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        assert first['success'] && second['success']

        # Identity by ID only: identical definition/parameters never collapse
        # the two units, and each top-level definition stays isolated (V1).
        refute_equal first['entity'].definition, second['entity'].definition
        located_first = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        located_second = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_2)
        assert_equal 1, located_first['duplicates']
        assert_equal 1, located_second['duplicates']
      end

      def test_placement_inside_nested_editing_context_lands_at_model_root
        parent_group = model.entities.add_group
        parent_group.name = 'Pared o ambiente'
        result = builder.place_existing_furniture(
          model, furniture_instance_id: FI_1, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
        assert result['success'], result.inspect

        located = ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        refute_nil located['entity'], 'placed furniture must be found at root level'
        assert_equal 1, located['duplicates']
        assert_includes model.entities.to_a, located['entity'], 'entity must be in model.entities root'
        refute_includes parent_group.entities.to_a, located['entity'], 'entity must not be nested in parent group'
      end

      private

      def model
        Sketchup.active_model
      end

      def metadata_store
        Metadata::Store.new(model)
      end

      def builder
        Model::FurnitureBuilder.new(metadata_store: metadata_store)
      end

      def top_level_furniture
        store = metadata_store
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          metadata = store.read(entity)
          metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'
        end
      end

      # A minimal definition shaped like the catalog contract. The host smoke
      # exercises placement/persistence, not server resolution — which the
      # placer unit tests pin against the real backend contract.
      def catalog_definition
        {
          'furniture_definition_id' => DEFINITION_ID,
          'code' => 'BASE-600', 'name' => 'Gabinete Base 600', 'category' => 'kitchen_base',
          'version' => '1.0.0',
          'parameters' => [
            { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' },
            { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
            { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 560, 'unit' => 'mm' },
            { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number', 'defaultValue' => 1 }
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

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end
    end
  end
end
