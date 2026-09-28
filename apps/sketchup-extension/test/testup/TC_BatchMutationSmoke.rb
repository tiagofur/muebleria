# frozen_string_literal: true

require 'json'
require 'stringio'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #471: multi-selection batch editing.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   A. Batch selection: three managed furniture with a MIXED parameter
#      state resolve to a BatchContext (kind 'batch', three individual
#      identities, honest capability intersection).
#   B. Batch apply: N resolves -> exactly ONE SketchUp operation ->
#      every member rebuilt with the shared edit -> ONE undo step
#      restores each member's previous value and identity.
#   C. Resolve failure on a member: zero host operations, every member
#      keeps its previous valid state (all-or-nothing).
module Granete
  module SketchUpExtension
    class TC_BatchMutationSmoke < TestUp::TestCase
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
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

      # The local catalog definition: the resolver finds it through the
      # real CatalogProvider, so the batch capability intersection is
      # computed exactly as in production.
      def local_definition
        provider = Granete::SketchUpExtension::Library::CatalogProvider.new
        @local_definition ||= provider.find_definition('kitchen-base-standard')
      end

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        flunk 'local catalog must expose kitchen-base-standard for the smoke' unless local_definition
        Sketchup.file_new
        @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: Granete::SketchUpExtension::Metadata::Store.new(model)
        )
        @transaction_observer = TransactionObserver.new
        model.add_observer(@transaction_observer)
      end

      def teardown
        model.remove_observer(@transaction_observer) if @transaction_observer
        cleanup_granete_entities
      end

      # A. Mixed multi-selection resolves to a BatchContext with every identity
      def test_mixed_three_furniture_selection_resolves_to_batch_context
        entities = place_batch([1, 2, 3])
        select_all(entities)

        payload = resolve_selection_payload

        assert_equal 'batch', payload['kind']
        assert_equal 'selection', payload['origin']
        assert_equal 3, payload['selectionCount']
        assert_equal 3, payload['furniture'].length, 'individual identities must survive the batch'
        shelf_counts = payload['furniture'].map { |f| f['parameters']['shelfCount'] }.sort
        assert_equal [1, 2, 3], shelf_counts, 'the mixed state stays visible per member'
        assert_empty payload['excluded']
        assert payload['capabilities']['canBatchEditParameters']['supported'],
               payload['capabilities']['canBatchEditParameters'].inspect
      end

      # B. One batch command: ONE operation, every member edited, ONE undo
      #    restores each member's previous mixed values.
      def test_batch_apply_one_operation_and_one_undo_restores_every_member
        entities = place_batch([1, 2, 3])
        original_refs = entities.map { |e| metadata_store.read(e).dig('identity', 'instanceRef') }

        commands = entities.map { |entity| build_command(entity, shelf_count: 3) }
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        outcome = build_coordinator.execute_batch(commands)

        assert outcome.committed?, "batch must commit, got #{outcome.outcome}: #{outcome.reason}"
        assert_equal 3, outcome.result['applied']
        assert_equal 1, @transaction_observer.starts - starts_before, 'the whole batch is ONE start_operation'
        assert_equal 1, @transaction_observer.commits - commits_before, 'the whole batch is ONE commit_operation'

        after = granete_furniture_instances
        assert_equal 3, after.length
        after.each do |entity|
          assert_equal 3, metadata_store.read(entity).dig('intent', 'parameters', 'shelfCount'),
                       'every member received the shared edit'
        end

        # ONE undo step restores the previous mixed state of all three.
        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances
        assert_equal 3, restored.length, 'undo must restore every member'
        restored_counts = restored.map { |e| metadata_store.read(e).dig('intent', 'parameters', 'shelfCount') }.sort
        assert_equal [1, 2, 3], restored_counts, 'one undo restores each member to its own previous value'
        restored_refs = restored.map { |e| metadata_store.read(e).dig('identity', 'instanceRef') }.sort
        assert_equal original_refs.sort, restored_refs, 'identities survive the whole batch cycle'
      end

      # C. Resolve failure on the second member: zero operations, everyone intact
      def test_member_resolve_failure_stops_the_batch_without_host_operations
        entities = place_batch([1, 2, 3])
        original = entities.map { |e| metadata_store.read(e) }

        commands = [
          build_command(entities[0], shelf_count: 3),
          build_command(entities[1], shelf_count: 3, scenario: '07-orphan-anchor-rejection'),
          build_command(entities[2], shelf_count: 3)
        ]
        starts_before = @transaction_observer.starts

        outcome = build_coordinator.execute_batch(commands)

        assert outcome.rejected?, "outcome must be rejected, got #{outcome.outcome}"
        assert_includes outcome.reason, 'lote detenido', 'the outcome names the batch semantics'
        assert_equal 0, @transaction_observer.starts - starts_before, 'a failed batch resolve starts ZERO operations'
        granete_furniture_instances.each_with_index do |entity, index|
          assert_equal original[index], metadata_store.read(entity),
                       "member #{index} keeps its previous valid state"
        end
      end

      private

      def quiet_logger
        @quiet_logger ||= Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
      end

      def build_coordinator
        Granete::SketchUpExtension::Host::AuthoringMutationCoordinator.new(
          model_provider: method(:model),
          logger: quiet_logger,
          selection_restorer: Granete::SketchUpExtension::Host::SelectionRestore.new(
            metadata_store_factory: method(:metadata_store),
            model_provider: method(:model),
            logger: quiet_logger
          ),
          preflight_tracker: Granete::SketchUpExtension::Host::PreflightTracker.new
        )
      end

      def place_batch(shelf_counts)
        shelf_counts.each_with_index.map do |shelf_count, index|
          res = @builder.place_existing_furniture(
            model,
            furniture_instance_id: format('51000000-0000-0000-0000-%012d', index + 1),
            definition: local_definition,
            parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => shelf_count },
            project_id: '41000000-0000-0000-0000-000000000001',
            design_id: '52000000-0000-0000-0000-000000000001'
          )
          raise "placement #{index} failed: #{res['error']}" unless res['success']
        end
        granete_furniture_instances
      end

      def select_all(entities)
        model.selection.clear
        entities.each { |entity| model.selection.add(entity) }
      end

      # The exact payload the live observer would publish for this selection.
      def resolve_selection_payload
        observer = Observers::SelectionObserver.new(
          metadata_store: metadata_store,
          catalog_provider: Granete::SketchUpExtension::Library::CatalogProvider.new,
          on_selection_change: ->(_payload) {}
        )
        observer.resolve_selection(model.selection).to_payload
      end

      def build_command(target_entity, shelf_count:, scenario: '13-definition-driven-typed-parameters')
        builder = @builder
        metadata_store_inst = metadata_store
        definition = local_definition
        request = scenario_request(scenario)
        params = { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => shelf_count }
        response = scenario_response(scenario)

        Class.new(Granete::SketchUpExtension::Host::MutationCommand) do
          define_method(:initialize) do
            ref = metadata_store_inst.read(target_entity)&.dig('identity', 'instanceRef')
            super(name: 'update_furniture', operation_name: 'Editar Mueble',
                  semantic_target: { 'furnitureInstanceRef' => ref },
                  resolve: nil, apply: nil, context_valid: nil)
            @target = target_entity
          end

          define_method(:context_still_valid?) { @target&.valid? }

          define_method(:resolve_intent) do |request_context|
            parsed_response = JSON.parse(JSON.generate(response))
            parsed_response['inReplyToMessageId'] = request_context[:message_id]
            parsed_response['responseMessageId'] = "resolve-#{request_context[:message_id]}"
            parsed_response['idempotencyKey'] = request_context[:idempotency_key]
            expected_req = JSON.parse(JSON.generate(request))
            expected_req['messageId'] = request_context[:message_id]
            expected_req['idempotencyKey'] = request_context[:idempotency_key]
            Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
              parsed_response, expected_request: expected_req
            )
          end

          define_method(:apply_accepted_state) do |result, _host_context|
            builder.update_furniture(
              Sketchup.active_model, @target, definition, params,
              resolved_layout: result.layout, material_choices: {},
              transaction: false
            )
          end
        end.new
      end

      def scenario_response(id)
        scenario(id)['response']
      end

      def scenario_request(id)
        scenario(id)['request']
      end

      def scenario(id)
        fixture['scenarios'].find { |entry| entry['id'] == id } ||
          raise("missing scenario #{id} in golden")
      end

      def fixture
        JSON.parse(File.read(GOLDEN_PATH))
      end

      def metadata_store
        Granete::SketchUpExtension::Metadata::Store.new(model)
      end

      def model
        Sketchup.active_model
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          metadata_store.read(entity)&.dig('identity', 'instanceRef')
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
          next unless GRANETE_DEFINITION_PREFIXES.any? { |p| definition.name.to_s.start_with?(p) }

          current.definitions.remove(definition)
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
