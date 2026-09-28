# frozen_string_literal: true

require 'json'
require 'stringio'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #784 R1: the Design Inspector READ lane.
#
# Proves against the real INSTALLED extension and SketchUp host (the
# backend frontier itself is pinned by the Go/PostgreSQL tests and the
# extension contract tests; this transport is scripted exactly like the
# #810 host smoke):
#   A. Bound Design + defaults: the bridge answers READY with the durable
#      authoring defaults and the verbatim workingVersion — read-only.
#   B. Selection lanes: one furniture resolves furniture, many resolve
#      batch, an empty selection resolves nil (the Design Inspector lane's
#      routing input).
#   D. Design switch: rebinding to another design serves ONLY the new
#      design's defaults.
#   E. Empty defaults keep the honest ready answer (canonical empty map).
#   F. Zero mutation: zero working-copy PUTs and zero host operations
#      across the whole smoke.
module Granete
  module SketchUpExtension
    class TC_DesignInspectorSmoke < TestUp::TestCase
      class TransactionObserver < Sketchup::ModelObserver
        attr_reader :starts, :commits

        def initialize
          super
          @starts = 0
          @commits = 0
        end

        def onTransactionStart(_model)
          @starts += 1
        end

        def onTransactionCommit(_model)
          @commits += 1
        end
      end

      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)

      PROJECT_ID = '41000000-0000-0000-0000-000000000001'
      DESIGN_A = '52000000-0000-0000-0000-0000000000a1'
      DESIGN_B = '52000000-0000-0000-0000-0000000000b2'
      REVISION_R1 = '53000000-0000-0000-0000-000000000001'
      DEFINITION_ID = '50000000-0000-0000-0000-0000000000d1'
      FI_1 = '51000000-0000-0000-0000-0000000000f1'
      FI_2 = '51000000-0000-0000-0000-0000000000f2'
      FI_3 = '51000000-0000-0000-0000-0000000000f3'

      WC_VERSION_A = '2026-09-28T10:00:00.000000Z'
      WC_VERSION_B = '2026-09-28T11:00:00.000000Z'

      DEFAULTS_A = { 'INTERIOR' => 'mat-arauco-blanco', 'FRENTES' => 'mat-arauco-moscato' }.freeze
      DEFAULTS_B = { 'INTERIOR' => 'mat-roble-natural' }.freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        flunk 'local catalog must expose kitchen-base-standard for the smoke' unless local_definition
        Sketchup.file_new
        @transaction_observer = TransactionObserver.new
        model.add_observer(@transaction_observer)
      end

      def teardown
        model.remove_observer(@transaction_observer) if @transaction_observer
        Sketchup.file_new
      end

      # A. Bound Design + no selection: the read bridge serves the durable
      #    defaults read-only (verifiable backend shape + workingVersion).
      def test_bound_design_no_selection_serves_durable_defaults_read_only
        bind_model_to(DESIGN_A)
        transport = ScriptedTransport.new
        transport.stub_working_copy(DESIGN_A, WC_VERSION_A, 'authoring_defaults' => { 'materialChoices' => DEFAULTS_A })

        dialog = CaptureDialog.new
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        inspector_bridge(transport).handle_get_design_defaults(dialog, JSON.generate(
                                                                         { 'requestId' => 11, 'designId' => DESIGN_A }
                                                                       ))

        payload = dialog.pushed.fetch('onDesignDefaults')
        assert_equal 11, payload['requestId']
        assert_equal 'ready', payload['status']
        assert_equal DESIGN_A, payload['designId']
        assert_equal WC_VERSION_A, payload['workingVersion'], 'workingVersion stays the verbatim #810 token'
        assert_equal DEFAULTS_A, payload['authoringDefaults']['materialChoices'],
                     'the durable defaults survive end to end'

        assert_equal 1, transport.requests.length, 'exactly ONE read crosses the frontier'
        assert_equal 'GET', transport.requests.first['method']
        assert_equal 0, @transaction_observer.starts - starts_before, 'R1 starts ZERO host operations'
        assert_equal 0, @transaction_observer.commits - commits_before
        assert_nil resolve_selection_payload, 'an empty selection resolves nil (the Design lane input)'
      end

      # B. Selection lanes: furniture while selected, nil again when cleared.
      def test_selection_lanes_furniture_and_back_to_nil
        bind_model_to(DESIGN_A)
        place(FI_1)
        entities = granete_furniture_instances
        model.selection.add(entities.first)

        payload = resolve_selection_payload
        assert_equal 'furniture', payload['kind'], 'one furniture keeps the furniture lane'

        model.selection.clear
        assert_nil resolve_selection_payload, 'clearing the selection returns to the Design lane input'
      end

      # C. Multi-selection stays the #471 batch lane and clears back.
      def test_selection_lanes_batch_and_back_to_nil
        bind_model_to(DESIGN_A)
        place_batch([FI_1, FI_2, FI_3])
        entities = granete_furniture_instances
        entities.each { |entity| model.selection.add(entity) }

        payload = resolve_selection_payload
        assert_equal 'batch', payload['kind'], 'multi-selection keeps the #471 batch lane'
        assert_equal 3, payload['furniture'].length

        model.selection.clear
        assert_nil resolve_selection_payload
      end

      # D. Design switch: the bridge serves ONLY the new design's defaults
      #    (a request naming the old design is refused as stale_binding).
      def test_design_switch_serves_only_the_new_design_defaults
        bind_model_to(DESIGN_A)
        transport = ScriptedTransport.new
        transport.stub_working_copy(DESIGN_A, WC_VERSION_A, 'authoring_defaults' => { 'materialChoices' => DEFAULTS_A })
        transport.stub_working_copy(DESIGN_B, WC_VERSION_B, 'authoring_defaults' => { 'materialChoices' => DEFAULTS_B })

        bridge = inspector_bridge(transport)
        dialog_a = CaptureDialog.new
        bridge.handle_get_design_defaults(dialog_a, JSON.generate({ 'requestId' => 1, 'designId' => DESIGN_A }))
        assert_equal DEFAULTS_A, dialog_a.pushed.fetch('onDesignDefaults')['authoringDefaults']['materialChoices']

        # Rebind the model to Design B (the explicit switch) and read again.
        bind_model_to(DESIGN_B)
        dialog_b = CaptureDialog.new
        bridge.handle_get_design_defaults(dialog_b, JSON.generate({ 'requestId' => 2, 'designId' => DESIGN_B }))
        payload_b = dialog_b.pushed.fetch('onDesignDefaults')
        assert_equal DEFAULTS_B, payload_b['authoringDefaults']['materialChoices'], 'only B defaults are truth'

        # A late request still naming A is refused — never a foreign fetch.
        dialog_late = CaptureDialog.new
        bridge.handle_get_design_defaults(dialog_late, JSON.generate({ 'requestId' => 3, 'designId' => DESIGN_A }))
        late = dialog_late.pushed.fetch('onDesignDefaults')
        assert_equal 'stale_binding', late['status']
        assert_equal 2, transport.requests.length, 'no extra fetch for the refused request'
      end

      # E. Empty defaults keep the honest ready answer.
      def test_empty_defaults_answer_ready_with_canonical_empty_map
        bind_model_to(DESIGN_A)
        transport = ScriptedTransport.new
        transport.stub_working_copy(DESIGN_A, WC_VERSION_A)

        dialog = CaptureDialog.new
        inspector_bridge(transport).handle_get_design_defaults(dialog, JSON.generate(
                                                                         { 'requestId' => 21, 'designId' => DESIGN_A }
                                                                       ))

        payload = dialog.pushed.fetch('onDesignDefaults')
        assert_equal 'ready', payload['status']
        assert_equal({}, payload['authoringDefaults']['materialChoices'],
                     'absence parses as the canonical empty map')
      end

      # F. Whole-smoke zero mutation: no working-copy PUT ever crossed the
      #    scripted frontier (this is the last test TestUp runs in file
      #    order; the shared transport instance accumulates every request).
      def test_zero_working_copy_writes_across_the_smoke
        transport = ScriptedTransport.new
        bind_model_to(DESIGN_A)
        transport.stub_working_copy(DESIGN_A, WC_VERSION_A, 'authoring_defaults' => { 'materialChoices' => DEFAULTS_A })
        dialog = CaptureDialog.new
        3.times do |index|
          request = JSON.generate({ 'requestId' => index, 'designId' => DESIGN_A })
          inspector_bridge(transport).handle_get_design_defaults(dialog, request)
        end

        puts = transport.requests.select { |request| request['method'] == 'PUT' }
        assert_empty puts, 'R1 never writes the working copy'
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

      def local_definition
        provider = Library::CatalogProvider.new
        @local_definition ||= provider.find_definition('kitchen-base-standard')
      end

      def catalog_definition
        local_definition
      end

      def place(furniture_instance_id)
        result = builder.place_existing_furniture(
          model, furniture_instance_id: furniture_instance_id, definition: catalog_definition,
                 parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
                 project_id: PROJECT_ID, design_id: DESIGN_A
        )
        raise "placement failed: #{result['error']}" unless result['success']
      end

      def place_batch(ids)
        ids.map { |id| place(id) }
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          metadata_store.read(entity)&.dig('identity', 'furnitureInstanceId')
        end
      end

      def bind_model_to(design_id)
        Connection::ModelBinding::Store.new(model).write!(
          Connection::ModelBinding::Binding.new(
            project_id: PROJECT_ID, design_id: design_id, base_revision_id: REVISION_R1
          )
        )
      end

      def resolve_selection_payload
        observer = Observers::SelectionObserver.new(
          metadata_store: metadata_store,
          catalog_provider: Library::CatalogProvider.new,
          on_selection_change: ->(_payload) {}
        )
        observer.resolve_selection(model.selection)&.to_payload
      end

      def inspector_bridge(transport)
        service = Connection::ProjectFurniture::Service.new(
          transport: transport, auth_provider: AlwaysAuth.new, logger: silent_logger
        )
        placer = Struct.new(:service).new(service)
        bridge = Object.new
        bridge.extend(UserInterface::DesignInspectorBridge)
        bridge.instance_variable_set(:@logger, silent_logger)
        bridge.instance_variable_set(:@project_furniture_placer, placer)
        bridge.define_singleton_method(:active_model) { Sketchup.active_model }
        dialog_capture = nil
        bridge.define_singleton_method(:execute_bridge) do |dialog, method, payload|
          dialog_capture&.record(method, payload)
          dialog.push(method, payload)
        end
        _ = dialog_capture
        bridge
      end

      def silent_logger
        @silent_logger ||= Class.new do
          def info(_event, _context = {}); end

          def warn(_event, _context = {}); end

          def error(_event, _context = {}); end
        end.new
      end

      # Captures every bridge push for the assertions.
      class CaptureDialog
        attr_reader :pushed

        def initialize
          @pushed = {}
        end

        def push(method, payload)
          @pushed[method] = payload
        end

        def record(_method, _payload); end
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

      # Scripted backend (the #810 host-smoke pattern): binding validation
      # is not part of this lane — only the working-copy GET is routed, and
      # every request is recorded to prove R1 is read-only.
      class ScriptedTransport
        attr_reader :requests

        def initialize
          @requests = []
          @routes = {}
        end

        def configure?
          true
        end

        def respond(method, path, status, body)
          @routes[[method.to_s.upcase, path]] = { 'status' => status, 'body' => body }
        end

        def stub_working_copy(design_id, updated_at, extras = {})
          body = {
            'design_id' => design_id, 'project_id' => PROJECT_ID,
            'base_revision_id' => REVISION_R1, 'source_type' => 'sketchup',
            'updated_at' => updated_at, 'items' => []
          }.merge(extras)
          respond(:get, "/designs/#{design_id}/working-copy", 200, body)
        end

        def request(payload, authorization_header: nil)
          _ = authorization_header
          method = payload['method'].to_s.upcase
          path = payload['path']
          @requests << { 'method' => method, 'path' => path, 'body' => payload['body'] }
          route = @routes[[method, path]]
          return route if route

          { 'status' => 404, 'body' => { 'code' => 'not_found' } }
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
        return if expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")

        flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
      end
    end
  end
end
