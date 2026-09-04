# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Host smoke test for #398 / DT-14: End-to-End Digital Thread host regression gate.
# Proves in the real SketchUp host that:
# 1. Native entity hierarchy preserves backend furnitureInstanceId as authoritative identity
# 2. Host-created duplicates are detected AND resolved by the real DuplicateResolver
#    executing inside the host (server authority via a controlled service double —
#    no live backend network in TestUp, per host smoke convention)
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
      FI_NEW = '51000000-0000-4000-8000-000000000101'
      DEF_ID = 'd1000000-0000-4000-8000-000000000001'

      # Controlled server double for the binding-validation boundary: answers
      # the resolver's "is this binding current?" question the way the backend
      # would (same base revision => connected).
      class HostModelBindingServiceDouble
        def validate(project_id:, design_id:, base_revision_id:)
          Connection::ModelBinding::Contract::Validation.new(
            state: 'valid',
            schema_version: 1,
            organization: { 'id' => '10000000-0000-0000-0000-00000000000a', 'name' => 'Carpintería Host Smoke' },
            project: { 'id' => project_id, 'name' => 'Project E2E Host' },
            design: { 'id' => design_id, 'name' => 'Design E2E Host', 'status' => 'active' },
            working_copy: { 'base_revision_id' => base_revision_id, 'base_revision_number' => 1 },
            capabilities: { 'can_edit_working_copy' => true, 'can_publish_revision' => true }
          )
        end
      end

      # Controlled server double for the duplicate flow: returns the
      # server-allocated identity for the copy (origin duplicate). The REAL
      # Connection::DuplicateResolver logic runs in the host — only the
      # network boundary is doubled, matching the host smoke convention
      # (no live production backend in TestUp).
      class HostDuplicateServiceDouble
        attr_reader :duplicate_calls

        def initialize(working_copy:)
          @working_copy = working_copy
          @duplicate_calls = []
          @instances_by_id = {}
        end

        def get_working_copy(_design_id)
          @working_copy
        end

        def list_project_furniture(_project_id)
          Connection::ProjectFurniture::Contract::ListResponse.new(items: @instances_by_id.values)
        end

        def register_instance(instance)
          @instances_by_id[instance.id] = instance
        end

        def duplicate_furniture_instance(project_id, instance_id, idempotency_key: nil)
          @duplicate_calls << [project_id, instance_id, idempotency_key]
          created = Connection::ProjectFurniture::Contract::Instance.new(
            id: FI_NEW,
            project_id: project_id,
            furniture_definition_id: DEF_ID,
            origin: 'duplicate',
            lifecycle_status: 'active'
          )
          @instances_by_id[created.id] = created
          created
        end

        def update_working_copy(design_id, items:, base_revision_id:)
          @working_copy = Connection::ProjectFurniture::Contract::WorkingCopy.new(
            design_id: design_id,
            base_revision_id: base_revision_id,
            items: items
          )
        end
      end

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
        # 1. Place original managed furniture FI-001.
        res = builder.place_existing_furniture(
          model,
          furniture_instance_id: FI_1,
          definition: catalog_definition,
          parameters: {},
          project_id: PROJECT_ID,
          design_id: DESIGN_ID
        )
        assert res['success'], res.inspect

        located = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        original = located['entity']
        refute_nil original, 'placed furniture must be found at root level'
        assert_equal 1, located['duplicates']

        # 2-3. Native host copy (Move+Copy / Copy-Paste shape): a second root
        # instance sharing the definition AND the Granete metadata.
        trans = Geom::Transformation.translation(Geom::Vector3d.new(1000, 0, 0))
        copy = model.entities.add_instance(original.definition, trans)
        metadata_store.write(copy, metadata_store.read(original))

        # 4. Collision detected loudly: two roots carry FI-001.
        check = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        assert_equal 2, check['duplicates'],
                     'native copy must surface as a duplicate identity collision'

        # 5-7. The REAL DuplicateResolver executes inside SketchUp. The server
        # boundary is a controlled double seeded with the authoritative working
        # copy (original identified by its persistent locator).
        original_item = Connection::ProjectFurniture::Contract::WorkingItem.new(
          furniture_instance_id: FI_1,
          furniture_definition_id: DEF_ID,
          transform: { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] },
          technical_client_locator: Connection::ProjectFurniture::ManagedFurniture.persistent_locator(original),
          parameters: { 'widthMm' => 600 }
        )
        working_copy = Connection::ProjectFurniture::Contract::WorkingCopy.new(
          design_id: DESIGN_ID,
          project_id: PROJECT_ID,
          base_revision_id: REVISION_R1,
          items: [original_item]
        )
        service = HostDuplicateServiceDouble.new(working_copy: working_copy)
        resolver = Connection::DuplicateResolver.new(
          model_provider: -> { model },
          binding_store_factory: -> { Connection::ModelBinding::Store.new(model) },
          model_binding_service: HostModelBindingServiceDouble.new,
          service: service,
          metadata_store_factory: ->(m) { Metadata::Store.new(m) }
        )

        result = resolver.rescan_and_resolve(model)
        assert result['ok'], "DuplicateResolver failed in host: #{result}"
        assert_equal 1, result['resolved'], "expected exactly one duplicate resolved: #{result}"

        # Server authority: exactly one duplicate command, project/design/FI/persistent-id scoped key.
        assert_equal 1, service.duplicate_calls.length, 'resolver must allocate identity via exactly one server command'
        call_project, call_instance, call_key = service.duplicate_calls.first
        assert_equal PROJECT_ID, call_project
        assert_equal FI_1, call_instance
        copy_pid = copy.respond_to?(:persistent_id) ? copy.persistent_id.to_s : 'unknown'
        assert_equal "dup:#{PROJECT_ID}:#{DESIGN_ID}:#{FI_1}:#{copy_pid}", call_key

        # 8. Identity contract: original keeps FI-001, copy receives the
        # server-allocated FI-NEW with duplicate provenance.
        copy_meta = metadata_store.read(copy)
        new_id = copy_meta['identity']['furnitureInstanceId']
        assert_equal FI_NEW, new_id, 'copy must carry the server-allocated identity'
        refute_equal FI_1, new_id
        assert_match Connection::DuplicateResolver::UUID_PATTERN, new_id
        assert_equal 'duplicate', copy_meta['identity']['origin']
        assert_equal FI_1, copy_meta['identity']['originFurnitureInstanceId']
        assert_equal FI_1, metadata_store.read(original)['identity']['furnitureInstanceId'],
                     'original must keep its authoritative identity'

        # 9. Collision disappears: each identity resolves to exactly one root.
        rescan_original = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
        assert_equal 1, rescan_original['duplicates']
        refute_nil rescan_original['entity']
        rescan_new = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_NEW)
        assert_equal 1, rescan_new['duplicates']
        refute_nil rescan_new['entity']

        # 10. Both identities survive save, close, and reopen.
        Dir.mktmpdir('granete-dt-duplicate') do |dir|
          path = File.join(dir, 'dt-duplicate.skp')
          assert model.save(path), 'the host must save the model'
          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the model'

          reopened_store = Metadata::Store.new(model)
          reopened_original = Connection::ProjectFurniture::ManagedFurniture.locate(model, reopened_store, FI_1)
          assert_equal 1, reopened_original['duplicates'], 'FI-001 must survive reopen exactly once'
          refute_nil reopened_original['entity']
          reopened_copy = Connection::ProjectFurniture::ManagedFurniture.locate(model, reopened_store, FI_NEW)
          assert_equal 1, reopened_copy['duplicates'], 'FI-NEW must survive reopen exactly once'
          refute_nil reopened_copy['entity']
          reopened_meta = reopened_store.read(reopened_copy['entity'])
          assert_equal 'duplicate', reopened_meta['identity']['origin'],
                       'duplicate provenance must survive reopen'
          assert_equal FI_1, reopened_meta['identity']['originFurnitureInstanceId']
        end
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

          # Verify binding persisted (the real Binding API exposes valid?, not bound?)
          reopened_binding = Connection::ModelBinding::Store.new(model).read
          refute_nil reopened_binding, 'the binding must survive reopen'
          assert reopened_binding.valid?, 'the reopened binding must be valid'
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
        # Without metadata_store the placement never stamps Granete identity
        # metadata (MetadataWriter returns early), so ManagedFurniture.locate
        # and ManifestBuilder would find nothing and every assertion in this
        # smoke would fail. Same pattern as TC_ProjectFurnitureSmoke.
        Model::FurnitureBuilder.new(metadata_store: metadata_store)
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

      # A minimal definition shaped like the catalog contract (same host-proven
      # shape as TC_ProjectFurnitureSmoke): MetadataWriter maps
      # furniture_definition_id -> intent.furnitureDefinitionId, which must be
      # a bounded opaque string — the real host rejects any other key shape.
      def catalog_definition
        {
          'furniture_definition_id' => DEF_ID,
          'code' => 'BASE-600', 'name' => 'Gabinete Base 600', 'category' => 'kitchen_base',
          'version' => '1.0.0',
          'parameters' => [
            { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' },
            { 'name' => 'heightMm', 'label' => 'Alto', 'type' => 'number', 'defaultValue' => 720, 'unit' => 'mm' },
            { 'name' => 'depthMm', 'label' => 'Fondo', 'type' => 'number', 'defaultValue' => 560, 'unit' => 'mm' }
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
