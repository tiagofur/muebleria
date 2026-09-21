# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Host smoke for #810 — the explicit "Sincronizar diseño" operation on the
# INSTALLED extension. Real host semantics only (native hierarchy, host
# transforms, metadata persistence, save/close/reopen); the backend frontier
# itself is pinned by the real-PostgreSQL Go boundary tests and the extension
# contract tests against a scripted transport.
module Granete
  module SketchUpExtension
    class TC_DesignSyncSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'
      DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'

      WC_VERSION_V1 = '2026-09-21T00:00:00Z'
      WC_VERSION_V2 = '2026-09-21T00:02:00Z'

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        Connection::ModelBinding::Store.new(model).write!(
          Connection::ModelBinding::Binding.new(
            project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: REVISION_R1
          )
        )
      end

      def teardown
        Sketchup.file_new
      end

      # The #810 DoD host half: place two units, edit one locally (width),
      # move it, delete the other, then Synchronize Design against a scripted
      # backend. The PUT must carry BOTH identities' final intent minus the
      # deleted one, through the canonical workingVersion token, and the
      # authoring-dirty flag must clear after the confirmed readback.
      def test_synchronize_design_golden_sequence_on_host
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        place(FI_1)
        place(FI_2)

        # Phase 1 — one conscious sync lands both placements with the
        # canonical workingVersion token.
        result = synchronizer(transport).synchronize_design
        assert result['ok'], result.inspect
        assert_equal [FI_1, FI_2].sort, result['changes']['added'].sort
        assert_equal WC_VERSION_V1, transport.working_copy_puts.first['body']['expected_working_version']

        first = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_2)['entity']

        # Local authoring edit (width) + move on FI-001; delete FI-002.
        edit = builder.update_furniture(model, first, catalog_definition,
                                        { 'widthMm' => 750 })
        assert edit['success'], "host edit failed: #{edit['error']}"
        first = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        first.transformation = Geom::Transformation.translation(Geom::Vector3d.new(1000 / 25.4, 0, 0))
        second = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_2)['entity']
        model.entities.erase_entities([second])

        # Phase 2 — the conscious sync applies the update and the conscious
        # remove through the NEW accepted token.
        result = synchronizer(transport).synchronize_design
        assert result['ok'], result.inspect
        assert_equal [FI_1], result['changes']['updated']
        assert_equal [FI_2], result['changes']['removed']

        put = transport.working_copy_puts.last
        assert_equal WC_VERSION_V2, put['body']['expected_working_version']
        items = put['body']['items']
        assert_equal [FI_1], items.map { |item| item['furniture_instance_id'] },
                     'the deleted unit must leave the Design intent'
        assert_equal 750, items.first.dig('parameters', 'widthMm'),
                     'the local width edit must reach the working copy'
        assert_in_delta 1000.0, items.first.dig('transform', 'translation_mm', 0), 0.01

        # Confirmed sync clears the authoring-dirty flag on the host entity.
        metadata = metadata_store.read(
          Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        )
        refute metadata['authoringDirty'], 'confirmed sync must clear the dirty flag'
      end

      # Delete → pending restoration on the real host: after the sync removes
      # FI-002 from the Design intent, the metadata identity still resolves —
      # re-placing reuses FI-002 and never mints a third identity.
      def test_synchronize_design_delete_then_replace_reuses_identity
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        place(FI_1)
        place(FI_2)
        assert synchronizer(transport).synchronize_design['ok'], 'phase 1 sync must land both placements'

        second = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_2)['entity']
        model.entities.erase_entities([second])

        result = synchronizer(transport).synchronize_design
        assert result['ok'], result.inspect
        assert_equal [FI_2], result['changes']['removed']

        replaced = place(FI_2)
        assert replaced['success'], replaced.inspect
        located = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_2)
        assert_equal 1, located['duplicates'], 're-placing must not duplicate the identity'
        identity = metadata_store.read(located['entity'])['identity']
        assert_equal FI_2, identity['furnitureInstanceId'], 're-placing reuses FI-002'
      end

      # A stale writer can never overwrite the newer server state: the typed
      # conflict surfaces as Conflicto and the local edit stays dirty.
      def test_synchronize_design_diverged_conflict_never_overwrites_on_host
        transport = ScriptedTransport.new
        transport.stub_working_copy([transport.working_item_body(FI_1, 600)])
        place(FI_1)

        first = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        edit = builder.update_furniture(model, first, catalog_definition, { 'widthMm' => 750 })
        assert edit['success'], edit.inspect

        transport.fail_next_put_with_divergence
        result = synchronizer(transport).synchronize_design
        refute result['ok'], 'a diverged writer must not be reported as success'
        assert_equal 'conflict', result['code']
        assert_equal 1, transport.working_copy_puts.length, 'a conflict must not produce a second write'

        metadata = metadata_store.read(
          Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        )
        assert metadata['authoringDirty'], 'the local edit still owes the working copy its fields'
      end

      # Save/close/reopen: identity + dirty state persist in the .skp, and a
      # fresh synchronization still resolves both authorities.
      def test_synchronize_design_state_survives_save_close_and_reopen
        transport = ScriptedTransport.new
        transport.stub_working_copy([])
        place(FI_1)
        first = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)['entity']
        edit = builder.update_furniture(model, first, catalog_definition, { 'widthMm' => 750 })
        assert edit['success'], edit.inspect

        Dir.mktmpdir('granete-design-sync') do |dir|
          path = File.join(dir, 'cocina-garcia.skp')
          assert model.save(path), 'the host must save the model'
          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the model'

          located = Connection::ProjectFurniture::ManagedFurniture.locate(model, metadata_store, FI_1)
          assert_equal 1, located['duplicates'], 'reopen must not duplicate the identity'
          reopened = metadata_store.read(located['entity'])
          assert_equal FI_1, reopened.dig('identity', 'furnitureInstanceId')
          assert reopened['authoringDirty'], 'the pending edit must survive reopen'

          transport.stub_working_copy([])
          result = synchronizer(transport).synchronize_design
          assert result['ok'], result.inspect
          items = transport.working_copy_puts.first['body']['items']
          assert_equal 750, items.first.dig('parameters', 'widthMm'),
                       'the reopened edit must still reach the working copy'
        end
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

      def place(furniture_instance_id)
        builder.place_existing_furniture(
          model, furniture_instance_id: furniture_instance_id, definition: catalog_definition,
                 parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
                 project_id: PROJECT_ID, design_id: DESIGN_ID
        )
      end

      def synchronizer(transport)
        service = Connection::ProjectFurniture::Service.new(
          transport: transport, auth_provider: AlwaysAuth.new, logger: silent_logger
        )
        Connection::DesignSync::Synchronizer.new(
          model_provider: -> { Sketchup.active_model },
          binding_store_factory: ->(m) { Connection::ModelBinding::Store.new(m) },
          model_binding_service: Connection::ModelBinding::Service.new(
            transport: transport, auth_provider: AlwaysAuth.new, logger: silent_logger
          ),
          service: service,
          metadata_store_factory: ->(m) { Metadata::Store.new(m) },
          logger: silent_logger
        )
      end

      def silent_logger
        @silent_logger ||= Class.new do
          def info(_event, _context = {}); end

          def warn(_event, _context = {}); end

          def error(_event, _context = {}); end
        end.new
      end

      class AlwaysAuth
        def configured?
          true
        end

        def authorization_header
          'Bearer host-smoke'
        end

        def refresh_if_needed; end
      end

      # Scripted backend: binding validation + working copy with the server
      # semantics #810 needs (accepted PUT mints a new workingVersion and is
      # re-readable; injectable one-shot divergence for the conflict proof).
      class ScriptedTransport
        attr_reader :requests

        def initialize
          @requests = []
          @routes = {}
          @next_put_failure = nil
          stub_binding_validation
        end

        def configure?
          true
        end

        def respond(method, path, status, body)
          @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
        end

        def stub_binding_validation
          respond(:post, "/projects/#{PROJECT_ID}/designs/#{DESIGN_ID}/binding:validate", 200,
                  {
                    'state' => 'valid',
                    'schema_version' => 1,
                    'organization' => { 'id' => '10000000-0000-0000-0000-00000000000a',
                                        'name' => 'Carpintería García' },
                    'project' => { 'id' => PROJECT_ID, 'name' => 'Cocina García' },
                    'design' => { 'id' => DESIGN_ID, 'name' => 'Cocina principal', 'status' => 'active' },
                    'working_copy' => { 'base_revision_id' => REVISION_R1, 'base_revision_number' => 1 },
                    'capabilities' => { 'can_edit_working_copy' => true, 'can_publish_revision' => true,
                                        'can_create_initial_quote' => true }
                  })
        end

        def stub_working_copy(items)
          respond(:get, "/designs/#{DESIGN_ID}/working-copy", 200,
                  { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                    'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                    'updated_at' => WC_VERSION_V1, 'items' => items })
        end

        def fail_next_put_with_divergence
          diverged = { 'design_id' => DESIGN_ID, 'project_id' => PROJECT_ID,
                       'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                       'updated_at' => WC_VERSION_V2,
                       'items' => [working_item_body(FI_1, 999)] }
          @next_put_failure = { 'status' => 409,
                                'body' => { 'code' => 'VERSION_CONFLICT',
                                            'message' => 'El borrador de trabajo cambió' },
                                'then_get' => diverged }
        end

        def working_item_body(fi_id, width)
          {
            'furniture_instance_id' => fi_id,
            'furniture_definition_id' => DEFINITION_ID,
            'parameters' => { 'widthMm' => width, 'heightMm' => 720, 'depthMm' => 560,
                              'shelfCount' => 1 },
            'material_choices' => {},
            'transform' => { 'translation_mm' => [0.0, 0.0, 0.0], 'rotation_deg' => [0.0, 0.0, 0.0] }
          }
        end

        def request(payload, authorization_header: nil)
          _ = authorization_header
          method = payload['method'].to_s.upcase
          path = payload['path']
          @requests << { 'method' => method, 'path' => path, 'body' => payload['body'] }

          if method == 'PUT' && path == "/designs/#{DESIGN_ID}/working-copy"
            if @next_put_failure
              failure = @next_put_failure
              @next_put_failure = nil
              @routes[['GET', path]] = { 'status' => 200, 'body' => failure['then_get'] }
              return { 'status' => failure['status'], 'body' => failure['body'] }
            end
            body = (payload['body'] || {}).dup
            body['project_id'] ||= PROJECT_ID
            body['design_id'] ||= DESIGN_ID
            body['base_revision_id'] ||= REVISION_R1
            body['source_type'] ||= 'sketchup'
            body['items'] ||= []
            body['updated_at'] = WC_VERSION_V2
            @routes[['GET', path]] = { 'status' => 200, 'body' => body }
            return { 'status' => 200, 'body' => body }
          end

          route = @routes[[method, path]]
          return route if route

          { 'status' => 404, 'body' => { 'code' => 'not_found' } }
        end

        def working_copy_puts
          @requests.select do |request|
            request['method'] == 'PUT' && request['path'] == "/designs/#{DESIGN_ID}/working-copy"
          end
        end
      end

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
