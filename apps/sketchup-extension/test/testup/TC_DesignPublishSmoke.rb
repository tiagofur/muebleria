# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Host smoke for #392 / DT-8 publish: the INSTALLED extension must export a
# real .skp copy and a real preview image host-safely (never touching the
# user's working document), build a managed-only manifest from a model that
# also contains unmanaged decoration, run the full publish sequence against
# a scripted backend fake, and persist the advanced baseRevisionId across
# save/close/reopen. Like TC_ProjectFurnitureSmoke, this suite proves the
# host export/persistence half; the server-side rules (numbering, RLS,
# idempotency, conflicts) are pinned by the Go integration tests.
module Granete
  module SketchUpExtension
    class TC_DesignPublishSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_ID = '52000000-0000-0000-0000-000000000001'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'
      REVISION_R2 = '53000000-0000-0000-0000-000000000002'
      SESSION_ID = '54000000-0000-0000-0000-000000000001'
      DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'

      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'

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

      def test_save_copy_and_write_image_export_real_files_host_safe
        working_title = model.title
        Dir.mktmpdir('granete-publish-smoke') do |dir|
          skp_path = File.join(dir, 'model.skp')
          png_path = File.join(dir, 'preview.png')

          assert model.save_copy(skp_path), 'the host must export a .skp copy'
          assert File.size?(skp_path), 'the exported .skp must be non-empty'

          model.write_image(png_path, 1280, 720, true)
          assert File.size?(png_path), 'the exported preview must be non-empty'

          # Host-safe: the working document never switched to the artifact.
          assert_equal working_title, model.title
          assert model.path.to_s.empty? || !model.path.to_s.include?(dir),
                 'save_copy must not rebind the working document path'
        end
      end

      def test_manifest_is_managed_only_with_unmanaged_decoration_present
        place_managed(FI_1)
        place_managed(FI_2)
        add_unmanaged_decoration

        manifest = Connection::DesignPublish::ManifestBuilder.build(
          model, binding, metadata_store,
          sketchup_version: Sketchup.version, plugin_version: EXTENSION_VERSION
        )

        ids = manifest['items'].map { |item| item['furnitureInstanceId'] }
        assert_equal [FI_1, FI_2].sort, ids.sort,
                     'walls/plants/decoration must never enter the semantic manifest'
        assert_equal PROJECT_ID, manifest['projectId']
        assert_equal DESIGN_ID, manifest['designId']
        assert_equal REVISION_R1, manifest['baseRevisionId']
        assert_equal 'sketchup', manifest['source']['client']
        assert_equal EXTENSION_VERSION, manifest['source']['pluginVersion']
        refute_equal '', manifest['source']['sketchupVersion']
      end

      def test_publish_sequence_exports_uploads_and_advances_binding_base
        place_managed(FI_1)
        place_managed(FI_2)
        add_unmanaged_decoration

        fake = PublishBackendFake.new(REVISION_R2)
        publisher = Connection::DesignPublish::Publisher.new(
          model_provider: -> { model },
          binding_store_factory: -> { Connection::ModelBinding::Store.new(model) },
          duplicate_resolver: resolver(fake),
          service: Connection::DesignPublish::Service.new(
            transport: fake, auth_provider: fake_auth
          ),
          working_copy_service: fake,
          base_advancer: -> { fake.advance_base },
          metadata_store_factory: ->(m) { Metadata::Store.new(m) }
        )

        progress = []
        result = publisher.publish(on_progress: ->(step) { progress << step })

        assert result['ok'], "publish failed: #{result}"
        assert_equal REVISION_R2, result['baseRevisionId']
        assert_equal 2, result['revisionNumber']

        # Sequence proof against the scripted backend.
        assert_equal %i[prepare model manifest preview finalize], fake.sequence
        assert fake.uploaded_all?, 'model, manifest and preview files must reach the backend'
        fake.uploads.each_value do |path|
          assert File.size?(path), "uploaded artifact #{path} must be a real file"
        end
        manifest_upload = JSON.parse(File.read(fake.uploads['manifest']))
        prepared_manifest = fake.prepare_manifest
        assert_equal prepared_manifest['items'].map { |i| i['furnitureInstanceId'] }.sort,
                     manifest_upload['items'].map { |i| i['furnitureInstanceId'] }.sort,
                     'the manifest artifact must mirror the prepared manifest'

        assert_includes progress, 'validating'
        assert_includes progress, 'publishing'

        # Binding base advanced to the new revision (reopen proof follows).
        assert_equal REVISION_R2, binding.base_revision_id
      end

      def test_published_base_survives_save_close_and_reopen
        place_managed(FI_1)
        fake = PublishBackendFake.new(REVISION_R2)
        publisher = Connection::DesignPublish::Publisher.new(
          model_provider: -> { model },
          binding_store_factory: -> { Connection::ModelBinding::Store.new(model) },
          duplicate_resolver: resolver(fake),
          service: Connection::DesignPublish::Service.new(
            transport: fake, auth_provider: fake_auth
          ),
          working_copy_service: fake,
          base_advancer: -> { fake.advance_base },
          metadata_store_factory: ->(m) { Metadata::Store.new(m) }
        )
        assert publisher.publish['ok'], 'publish must succeed before reopen proof'

        Dir.mktmpdir('granete-publish-reopen') do |dir|
          path = File.join(dir, 'cocina-garcia.skp')
          assert model.save(path), 'the host must save the model'
          Sketchup.file_new
          assert Sketchup.open_file(path), 'the host must reopen the model'

          reopened = Connection::ModelBinding::Store.new(model).read
          refute_nil reopened, 'the binding must survive reopen'
          assert_equal REVISION_R2, reopened.base_revision_id,
                       'reopen must see the published base revision, never re-publish R1'
        end
      end

      private

      def model
        Sketchup.active_model
      end

      def metadata_store
        Metadata::Store.new(model)
      end

      def binding
        Connection::ModelBinding::Store.new(model).read
      end

      def place_managed(furniture_instance_id)
        Model::FurnitureBuilder.new(metadata_store: metadata_store).place_existing_furniture(
          model, furniture_instance_id: furniture_instance_id, definition: catalog_definition,
                 parameters: {}, project_id: PROJECT_ID, design_id: DESIGN_ID
        )
      end

      # Unmanaged architecture/decoration: raw host geometry with NO Granete
      # identity metadata — the negative-proof model contents.
      def add_unmanaged_decoration
        wall = model.entities.add_group
        wall.name = 'Pared decorativa'
        plant = model.entities.add_group
        plant.name = 'Planta'
      end

      def resolver(fake)
        Connection::DuplicateResolver.new(
          model_provider: -> { model },
          binding_store_factory: -> { Connection::ModelBinding::Store.new(model) },
          model_binding_service: nil,
          service: fake,
          metadata_store_factory: ->(m) { Metadata::Store.new(m) }
        )
      end

      def catalog_definition
        {
          'furniture_definition_id' => DEFINITION_ID,
          'code' => 'BASE-600', 'name' => 'Gabinete Base 600', 'category' => 'kitchen_base',
          'version' => '1.0.0',
          'parameters' => [
            { 'name' => 'widthMm', 'label' => 'Ancho', 'type' => 'number', 'defaultValue' => 600, 'unit' => 'mm' }
          ]
        }
      end

      def fake_auth
        auth = Object.new
        auth.define_singleton_method(:configured?) { true }
        auth.define_singleton_method(:authorization_header) { 'Bearer smoke-token' }
        auth
      end

      # Scripted backend: records the publish sequence, echoes authoritative
      # SHA-256 for uploads, and advances the authoritative base at finalize
      # exactly like the real server contract.
      class PublishBackendFake
        attr_reader :sequence, :uploads, :prepare_manifest, :working_copy, :advance_calls

        def initialize(new_revision_id)
          @new_revision_id = new_revision_id
          @sequence = []
          @uploads = {}
          @advance_calls = 0
          @instances = {}
          @working_copy = Connection::ProjectFurniture::Contract::WorkingCopy.new(
            design_id: DESIGN_ID, base_revision_id: REVISION_R1, items: []
          )
          [FI_1, FI_2].each do |fi_id|
            @instances[fi_id] = Connection::ProjectFurniture::Contract::Instance.new(
              id: fi_id, project_id: PROJECT_ID, furniture_definition_id: DEFINITION_ID,
              origin: 'design', lifecycle_status: 'active'
            )
          end
        end

        def configured?
          true
        end

        # Transport::Adapter#request — only the publish JSON calls arrive here.
        def request(payload, authorization_header: nil)
          _ = authorization_header
          path = payload['path']
          body =
            if path.end_with?('publish:prepare')
              @sequence << :prepare
              @prepare_manifest = payload['body']['manifest']
              { 'id' => SESSION_ID, 'design_id' => DESIGN_ID, 'status' => 'prepared',
                'base_revision_id' => REVISION_R1, 'expires_at' => '2099-01-01T00:00:00Z',
                'required_artifacts' => %w[model manifest preview] }
            elsif path.end_with?(':finalize')
              @sequence << :finalize
              { 'id' => @new_revision_id, 'design_id' => DESIGN_ID, 'revision_number' => 2,
                'parent_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
                'status' => 'published',
                'artifacts' => %w[model manifest preview].map do |kind|
                  { 'kind' => kind, 'sha256' => "sha256-#{kind.ljust(64, '0')[0, 64]}",
                    'size_bytes' => 1, 'content_type' => 'application/octet-stream' }
                end }
            else
              raise "unexpected publish transport call: #{path}"
            end
          { 'status' => 201, 'headers' => {}, 'body' => body }
        end

        # Transport::Adapter#upload — records real exported files.
        def upload(payload, file_path:, content_type:, authorization_header: nil)
          _ = authorization_header
          kind = payload['path'].split('/').last.to_sym
          @sequence << kind
          @uploads[kind.to_s] = file_path
          digest = Digest::SHA256.file(file_path)
          { 'status' => 201, 'headers' => {},
            'body' => { 'kind' => kind.to_s, 'sha256' => "sha256-#{digest.hexdigest}",
                        'size_bytes' => File.size(file_path), 'content_type' => content_type } }
        end

        # ProjectFurniture service surface (precheck + working copy sync).
        def list_project_furniture(project_id)
          @instances.values.select { |i| i.project_id == project_id }
        end

        def get_working_copy(_design_id)
          @working_copy
        end

        def update_working_copy(design_id, items:, base_revision_id: nil, source_type: nil)
          _ = source_type
          @working_copy = Connection::ProjectFurniture::Contract::WorkingCopy.new(
            design_id: design_id, base_revision_id: base_revision_id, items: items
          )
        end

        # Binding connector adopt double: the authoritative base moves to the
        # published revision only after finalize.
        def advance_base
          @advance_calls += 1
          { 'ok' => true, 'status' => { 'state' => 'connected',
                                        'authoritativeBaseRevisionId' => @new_revision_id } }
        end

        def uploaded_all?
          %w[model manifest preview].all? { |kind| @uploads.key?(kind) }
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
