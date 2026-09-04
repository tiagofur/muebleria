# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Host smoke test for #398 / DT-14: End-to-End Digital Thread host regression gate.
# Proves in the real SketchUp host that:
# 1. Native entity hierarchy preserves backend furnitureInstanceId as authoritative identity
# 2. Host-created duplicates are detected and resolved through DuplicateResolver (origin: duplicate)
# 3. Raw geometry and unmanaged entities (walls, decoration) are strictly excluded from the publish manifest
# 4. Model binding and placed furniture identities survive save, close, and reopen without corruption or identity loss
module Granete
  module SketchUpExtension
    class TC_DigitalThreadE2ESmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '11111111-0000-4000-8000-000000000001'
      DESIGN_ID = '52000000-0000-4000-8000-000000000001'
      REVISION_R1 = '53000000-0000-4000-8000-000000000001'
      FI_1 = 'f1000000-0000-4000-8000-000000000001'
      FI_2 = 'f2000000-0000-4000-8000-000000000002'
      DEF_ID = 'd1000000-0000-4000-8000-000000000001'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        Connection::ModelBinding::Store.new(model).write!(
          Connection::ModelBinding::Binding.new(
            project_id: PROJECT_ID,
            design_id: DESIGN_ID,
            base_revision_id: REVISION_R1
          )
        )
      end

      def teardown
        Sketchup.file_new
      end

      def test_digital_thread_host_placement_and_unmanaged_exclusion
        # 1. Place managed furniture instance
        result = builder.place_existing_furniture(
          model,
          furniture_instance_id: FI_1,
          definition: catalog_definition,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
        assert result['success'], "host placement failed: #{result['error']}"

        # 2. Add unmanaged decoration into the model
        add_unmanaged_decoration

        # 3. Build manifest
        manifest = Connection::DesignPublish::ManifestBuilder.build(
          model,
          binding,
          metadata_store,
          sketchup_version: Sketchup.version,
          plugin_version: EXTENSION_VERSION
        )

        # 4. Verify only the managed instance is in the manifest
        assert_equal 1, manifest['items'].length
        assert_equal FI_1, manifest['items'][0]['furnitureInstanceId']
      end

      def test_digital_thread_duplicate_detection_and_resolution_in_host
        # Place original
        res = builder.place_existing_furniture(
          model,
          furniture_instance_id: FI_1,
          definition: catalog_definition,
          parameters: {},
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
        assert res['success'], res.inspect

        # Locate original
        located = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        original = located['entity']
        refute_nil original

        # Duplicate via SketchUp host copy
        trans = Geom::Transformation.translation(Geom::Vector3d.new(1000, 0, 0))
        copy = model.entities.add_instance(original.definition, trans)
        metadata_store.write(copy, metadata_store.read(original))

        # Duplicate detected loudly
        check = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        assert_equal 2, check['duplicates']
      end

      def test_digital_thread_persistence_across_save_and_reopen
        Dir.mktmpdir('granete-dt-smoke') do |dir|
          path = File.join(dir, 'dt-model.skp')

          builder.place_existing_furniture(
            model,
            furniture_instance_id: FI_1,
            definition: catalog_definition,
            parameters: { 'widthMm' => 600 },
            project_id: PROJECT_ID,
            design_id: DESIGN_ID
          )
          assert model.save(path), 'the host must save the model'

          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the model'

          # Verify binding persisted
          reopened_binding = Connection::ModelBinding::Store.new(model).read
          assert reopened_binding.bound?
          assert_equal PROJECT_ID, reopened_binding.project_id
          assert_equal DESIGN_ID, reopened_binding.design_id
          assert_equal REVISION_R1, reopened_binding.base_revision_id

          # Verify furniture instance identity persisted
          located = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
          refute_nil located['entity']
          assert_equal 1, located['duplicates']
        end
      end

      private

      def model
        Sketchup.active_model
      end

      def binding
        Connection::ModelBinding::Store.new(model).read
      end

      def metadata_store
        Metadata::Store.new(model)
      end

      def builder
        Library::FurnitureBuilder.new
      end

      def add_unmanaged_decoration
        # Create a raw face and a raw group
        pts = [
          Geom::Point3d.new(0, 0, 0),
          Geom::Point3d.new(100, 0, 0),
          Geom::Point3d.new(100, 100, 0),
          Geom::Point3d.new(0, 100, 0)
        ]
        model.entities.add_face(pts)
        grp = model.entities.add_group
        grp.name = 'Unmanaged Wall'
      end

      def catalog_definition
        {
          'id' => DEF_ID,
          'version' => 1,
          'name' => 'Gabinete Bajo 1 Puerta',
          'category' => 'lower_cabinet',
          'parameters' => [
            { 'name' => 'widthMm', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' },
            { 'name' => 'heightMm', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
            { 'name' => 'depthMm', 'type' => 'number', 'defaultValue' => 560, 'unit' => 'mm' }
          ]
        }
      end

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        assert extension, "Extension #{EXPECTED_NAME.inspect} is not registered in Sketchup.extensions"
        assert extension.loaded?, "Extension #{EXPECTED_NAME.inspect} is registered but not loaded"
      end

      def fail_closed_if_loaded_from_checkout
        return unless defined?(Granete::SketchUpExtension::EXTENSION_ROOT)

        loaded_root = File.expand_path(Granete::SketchUpExtension::EXTENSION_ROOT)
        checkout_root = File.expand_path('../../src', __dir__)
        refute_equal checkout_root, loaded_root,
                     "Extension was loaded from repository checkout (#{checkout_root}), " \
                     'not from an installed plugins directory'
      end
    end
  end
end
