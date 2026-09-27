# frozen_string_literal: true

require 'json'
require 'testup/testcase'

# Real-host smoke (#470): native context navigation under the overlay — the
# trapped-editor flow from the owner's report. Runs in its OWN TestUp
# session (testup-ci-470-navigation.yml): heavy Model#active_path /
# close_active navigation leaves the shared session's view state less
# predictable for the viewport-dependent smokes, so this class is isolated
# by process, not by test order.
module Granete
  module SketchUpExtension
    class TC_ManufacturingOverlayNavigationSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      SCENARIO_ID = '17-hardware-drilling-conflict'
      FURNITURE_INSTANCE_ID = '51000000-0000-0000-0000-0000000004f0'
      MM = 1.0 / 25.4
      Overlay = Granete::SketchUpExtension::Overlay

      DEFINITION = {
        'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
        'name' => 'Gabinete Authoring 600',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 },
          { 'name' => 'shelfCount', 'defaultValue' => 1 }
        ]
      }.freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
        @builder = Model::FurnitureBuilder.new(metadata_store: Metadata::Store.new(model))
        @scenario_body = JSON.parse(JSON.generate(scenario['response']))
        place_initial_furniture
      end

      def teardown
        cleanup_granete_entities
      end

      # B2d: the trapped-editor flow from the real-host report, driven at
      # the API level (no viewport geometry): inside the furniture with a
      # part selected, Esc leaves the context one level, double-click
      # semantics re-enter it and leave it again on empty space, the
      # canonical #476 flow DELIVERS the new selection context (the real
      # host defers/drops onSelectionBulkChange for Ruby writes inside a
      # tool event handler — the stuck-inspector bug), and hiding the
      # overlay closes the mode cleanly on the real host APIs.
      def test_escape_and_double_click_navigate_contexts_natively
        attach_canonical_selection_flow
        manager = build_manager
        @flow_manager = manager
        manager.enable(scope)
        root = granete_furniture_instances.first
        part = managed_part('side-left-01')
        tool = Overlay::InspectionTool.new(manager)
        view = model.active_view

        # The reported trap: furniture open, part selected, overlay ON.
        model.selection.clear
        model.selection.add(part)
        model.active_path = [root]
        assert_equal 1, model.active_path.length
        assert manager.mode_on?

        # Esc leaves the editing context one level; the overlay stays ON
        # and the selection is untouched.
        tool.onCancel(0, view)
        assert (model.active_path || []).empty?, 'Esc must leave the editing context'
        # Native host behavior: leaving the context drops the nested
        # selection (the part lived inside the furniture).
        assert_empty model.selection.to_a
        assert manager.mode_on?

        # Re-selecting the furniture WRITES the selection and the canonical
        # flow delivers the furniture context — the inspector cannot stay
        # stuck on "no selection" anymore.
        manager.select_naturally(root)
        assert_equal [root], model.selection.to_a
        assert_equal 'furniture', @observed_payloads.last, 'the bulk context must be delivered'

        # Double-click semantics re-enter the furniture: the click pair
        # selected the root, the double-click opens its context.
        manager.open_or_close_context_naturally(root)
        assert_equal [root], model.active_path.to_a

        # An empty-space double-click leaves it again.
        manager.open_or_close_context_naturally(nil)
        assert (model.active_path || []).empty?

        # Esc at the model root clears the selection, like native Esc.
        tool.onCancel(0, view)
        assert model.selection.empty?

        # Hiding the fabricación overlay pops the tool cleanly: mode off,
        # zero productive mutation (teardown re-proves entity counts).
        manager.disable
        assert_equal 'off', manager.status
      ensure
        # The real host returns nil for active_path at the model root.
        model.active_path = [] if model.respond_to?(:active_path=) && !(model.active_path || []).empty?
        model&.selection&.remove_observer(@canonical_observer) if @canonical_observer
        manager&.disable
      end

      # Host contract of Tool#onCancel reasons on the REAL host: a genuine
      # host Undo (Cmd/Ctrl+Z → Sketchup.send_action('editUndo:')) and a
      # same-tool re-selection (reason 1) must NEVER be interpreted as
      # Escape — context, selection and overlay stay untouched; only an
      # EXPLICIT Escape (reason 0) runs the approved escape semantics; the
      # tool stack is handed back on disable.
      def test_undo_and_reselect_cancels_are_not_escape_on_the_real_host
        attach_canonical_selection_flow
        manager = build_manager
        @flow_manager = manager
        manager.enable(scope)
        root = granete_furniture_instances.first
        part = managed_part('side-left-01')
        tool = Overlay::InspectionTool.new(manager)
        view = model.active_view

        # The trap context: furniture open, part selected, overlay ON.
        model.selection.clear
        model.selection.add(part)
        model.active_path = [root]

        # A benign undoable operation, then a REAL host Undo: the host
        # routes it to the active tool as a cancel. Whatever Undo natively
        # does to its own operation, the OVERLAY must not escape.
        model.start_operation('granete-470-undo-probe', true)
        model.set_attribute('granete_470_probe', 'touched', true)
        model.commit_operation
        Sketchup.send_action('editUndo:')

        # Native Undo may drop the selection on its own — that is host
        # behavior, not an overlay mutation. The OVERLAY-didn't-escape
        # proof is the editing context surviving plus the mode staying ON.
        assert_equal 1, (model.active_path || []).length, 'Undo must not close the context via the overlay'
        assert manager.mode_on?, 'Undo must not disable the overlay'

        # Restore the trap state and prove the TOOL CONTRACT in isolation:
        # the documented cancel reasons delivered directly to the tool are
        # completely inert — no context, selection or mode change.
        manager.select_naturally(part)
        assert_equal [part], model.selection.to_a

        tool.onCancel(1, view)
        assert_equal 1, (model.active_path || []).length, 'reason 1 must not close the context'
        assert_equal [part], model.selection.to_a, 'reason 1 must not clear the selection'
        assert manager.mode_on?

        tool.onCancel(2, view)
        assert_equal 1, (model.active_path || []).length, 'reason 2 must not close the context'
        assert_equal [part], model.selection.to_a, 'reason 2 must not clear the selection'
        assert manager.mode_on?

        # An EXPLICIT Escape keeps the approved semantics: leave the
        # context one level (the nested selection drops, natively).
        tool.onCancel(0, view)
        assert (model.active_path || []).empty?, 'Escape must still leave the context'
        assert_empty model.selection.to_a
        assert manager.mode_on?

        # Hiding the overlay hands the viewport back (stack pop, no
        # residue, mode off).
        manager.disable
        assert_equal 'off', manager.status
      ensure
        model.active_path = [] if model.respond_to?(:active_path=) && !(model.active_path || []).empty?
        model&.selection&.remove_observer(@canonical_observer) if @canonical_observer
        manager&.disable
      end

      private

      def model
        Sketchup.active_model
      end

      def quiet_logger
        @quiet_logger ||= Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
      end

      def scope
        { 'furnitureInstanceRef' => FURNITURE_INSTANCE_ID,
          'componentInstanceId' => 'side-left-01' }
      end

      def scenario
        golden = JSON.parse(File.read(GOLDEN_PATH))
        golden['scenarios'].find { |entry| entry['id'] == SCENARIO_ID }
      end

      def metadata_store
        @metadata_store ||= Metadata::Store.new(model)
      end

      def native_layout
        Library::LayoutContract.parse!(JSON.parse(JSON.generate(@scenario_body['resolved']['layout'])))
      end

      class GoldenCatalogProvider
        attr_reader :requests

        def initialize(scenario_body)
          @scenario_body = scenario_body
          @requests = []
        end

        def find_definition(definition_id)
          return nil unless definition_id == '22222222-2222-2222-2222-222222222222'

          { 'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
            'name' => 'Gabinete Authoring 600' }
        end

        def resolved_native_layout(_definition_id, _parameters = {}, _choices = {})
          Library::LayoutContract.parse!(
            JSON.parse(JSON.generate(@scenario_body['resolved']['layout']))
          )
        end

        def catalog_revision
          @scenario_body['catalogRevision']
        end

        def resolve_authoring(request_payload)
          @requests << request_payload
          body = JSON.parse(JSON.generate(@scenario_body))
          body['responseMessageId'] = "resolve-#{request_payload['messageId']}"
          body['inReplyToMessageId'] = request_payload['messageId']
          body['idempotencyKey'] = request_payload['idempotencyKey']
          Library::AuthoringResolveContract.parse!(
            body,
            expected_request: {
              'messageId' => request_payload['messageId'],
              'idempotencyKey' => request_payload['idempotencyKey']
            }
          )
        end
      end

      # The dialog's selection flow on the real host (#476 observer →
      # payload + overlay re-scope): production order — observer first,
      # then the manager with its host-reality self-delivery hook.
      def attach_canonical_selection_flow
        @observed_payloads = []
        @canonical_observer = Granete::SketchUpExtension::Observers::SelectionObserver.new(
          metadata_store: metadata_store,
          catalog_provider: GoldenCatalogProvider.new(@scenario_body),
          on_selection_change: lambda do |payload|
            @observed_payloads << (payload && payload['kind'])
            @flow_manager.rescope(scope_of_payload(payload)) if @flow_manager&.mode_on?
          end
        )
        model.selection.add_observer(@canonical_observer)
      end

      def scope_of_payload(payload)
        return {} unless payload.is_a?(Hash)

        result = {}
        result['furnitureInstanceId'] = payload['furnitureInstanceId'] if payload['furnitureInstanceId']
        result['furnitureInstanceRef'] = payload['furnitureInstanceRef'] if payload['furnitureInstanceRef']
        result['componentInstanceId'] = payload['componentInstanceId'] if payload['componentInstanceId']
        result
      end

      def build_manager
        Overlay::Manager.new(
          resolver: Overlay::InspectionResolver.new(
            catalog_provider: GoldenCatalogProvider.new(@scenario_body),
            metadata_store_factory: ->(m) { Metadata::Store.new(m) },
            logger: quiet_logger
          ),
          locator: build_locator,
          model_provider: method(:model),
          preflight_tracker: Host::PreflightTracker.new,
          logger: quiet_logger,
          on_selection_written: ->(selection) { @canonical_observer.onSelectionBulkChange(selection) }
        )
      end

      def build_locator
        Overlay::EntityLocator.new(
          metadata_store_factory: ->(m) { Metadata::Store.new(m) },
          model_provider: method(:model)
        )
      end

      def place_initial_furniture
        result = @builder.place_existing_furniture(
          model,
          furniture_instance_id: FURNITURE_INSTANCE_ID,
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
          resolved_layout: native_layout,
          relationships: canonical_relationships
        )
        raise "initial placement failed: #{result['error']}" unless result['entity']
      end

      def canonical_relationships
        relationships = @scenario_body.dig('normalizedSnapshot', 'relationships')
        unless relationships.is_a?(Array) && !relationships.empty?
          raise 'golden scenario must supply normalizedSnapshot.relationships'
        end

        relationships
      end

      def managed_part(component_instance_id)
        root = granete_furniture_instances.first
        part = root.definition.entities.find do |entity|
          entity.respond_to?(:definition) &&
            metadata_store.read(entity)&.dig('identity', 'instanceRef') == component_instance_id
        end
        flunk "fixture part #{component_instance_id} not found" unless part
        part
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          name = entity.definition.name.to_s
          name.start_with?('Granete · Mueble · ')
        end
      end

      def cleanup_granete_entities
        instances = granete_furniture_instances
        model.entities.erase_entities(instances) unless instances.empty?
        model.definitions.purge_unused if model.definitions.respond_to?(:purge_unused)
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
