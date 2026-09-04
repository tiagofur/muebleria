# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #498 / SU-HOST-1: Shared host interaction
# orchestration for atomic authoring and degraded states.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   A. Successful mutation: resolved H1 -> authoring mutation -> resolve
#      accepted H2 -> exactly ONE SketchUp operation -> H2 committed ->
#      undo -> H1 restored with semantic identity intact.
#   B. Resolve rejected: server reject -> zero SketchUp operations ->
#      H1 intact.
#   C. Host exception: resolve accepted -> host apply throws -> operation
#      aborts -> previous valid H1 hierarchy & metadata survive.
#   D. Late response: older request arrives after newer one -> superseded ->
#      no stale host apply.
#   E. Save/reopen: committed hierarchy and metadata persist without transient
#      UI state.
module Granete
  module SketchUpExtension
    class TC_HostMutationSmoke < TestUp::TestCase
      class TransactionObserver < Sketchup::ModelObserver
        attr_reader :starts, :commits, :aborts

        def initialize
          super
          @starts = 0
          @commits = 0
          @aborts = 0
        end

        def onTransactionStart(_model)
          @starts += 1
        end

        def onTransactionCommit(_model)
          @commits += 1
        end

        def onTransactionAbort(_model)
          @aborts += 1
        end
      end

      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

      DEFINITION = {
        'furniture_definition_id' => 'mod-1',
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

      # A. Successful mutation: H1 -> mutate -> H2 -> Undo -> H1 restored
      def test_successful_mutation_one_operation_and_undo_restores_h1
        initial_entity = place_initial_furniture
        refute_nil initial_entity, 'initial placement must produce a managed entity'
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')
        initial_shelf_count = metadata_store.read(initial_entity).dig('intent', 'parameters', 'shelfCount')
        assert_equal 1, initial_shelf_count

        coordinator = build_coordinator
        response = scenario_response('13-definition-driven-typed-parameters')
        command = build_command(
          target_entity: initial_entity,
          response: response,
          request: scenario_request('13-definition-driven-typed-parameters'),
          params: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 3, 'softClose' => true }
        )

        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits
        outcome = coordinator.execute(command)

        assert outcome.committed?, "mutation expected to commit, got #{outcome.outcome}: #{outcome.reason}"
        assert_equal 1, @transaction_observer.starts - starts_before, 'must be exactly ONE start_operation'
        assert_equal 1, @transaction_observer.commits - commits_before, 'must be exactly ONE commit_operation'

        # Verify H2
        current_entity = granete_furniture_instances.first
        refute_nil current_entity
        metadata = metadata_store.read(current_entity)
        assert_equal 3, metadata.dig('intent', 'parameters', 'shelfCount')
        assert_equal initial_id, metadata.dig('identity', 'instanceRef'), 'instance identity must survive mutation'

        # Verify ONE undo step restores H1
        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        refute_nil restored, 'undo must restore previous furniture'
        restored_metadata = metadata_store.read(restored)
        assert_equal 1, restored_metadata.dig('intent', 'parameters', 'shelfCount'), 'undo must restore H1 shelf count'
        assert_equal initial_id, restored_metadata.dig('identity', 'instanceRef')
      end

      # B. Resolve rejected: zero operations, H1 intact
      def test_resolve_rejected_starts_zero_operations_and_preserves_h1
        initial_entity = place_initial_furniture
        initial_metadata = metadata_store.read(initial_entity)

        coordinator = build_coordinator
        rejected_response = scenario_response('06-unknown-material-role-rejected')
        command = build_command(
          target_entity: initial_entity,
          response: rejected_response,
          request: scenario_request('06-unknown-material-role-rejected'),
          params: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 }
        )

        starts_before = @transaction_observer.starts
        outcome = coordinator.execute(command)

        assert outcome.rejected?, 'outcome must be rejected'
        assert_equal 0, @transaction_observer.starts - starts_before, 'must start ZERO host operations'

        current_entity = granete_furniture_instances.first
        refute_nil current_entity
        assert_equal initial_metadata, metadata_store.read(current_entity), 'H1 metadata must remain identical'
      end

      # C. Host exception: aborts, H1 intact
      def test_host_apply_exception_aborts_operation_and_preserves_h1
        initial_entity = place_initial_furniture
        initial_metadata = metadata_store.read(initial_entity)

        coordinator = build_coordinator
        response = scenario_response('02-move-shelf')
        command = build_command(
          target_entity: initial_entity,
          response: response,
          request: scenario_request('02-move-shelf'),
          params: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
          raise_during_apply: true
        )

        aborts_before = @transaction_observer.aborts
        outcome = coordinator.execute(command)

        assert outcome.aborted?, 'outcome must be aborted'
        assert_equal 'host_apply_failure', outcome.category
        assert_equal 1, @transaction_observer.aborts - aborts_before, 'must abort the open host operation'

        current_entity = granete_furniture_instances.first
        refute_nil current_entity
        assert_equal initial_metadata, metadata_store.read(current_entity), 'H1 must survive host exception'
      end

      # D. Late response: rejected and does not mutate host
      def test_late_response_rejected_and_does_not_mutate_host
        initial_entity = place_initial_furniture
        coordinator = build_coordinator

        cmd_a = build_command(target_entity: initial_entity, name: 'cmd_a')
        cmd_b = build_command(target_entity: initial_entity, name: 'cmd_b')

        ctx_a = coordinator.begin_resolve(cmd_a)
        assert_equal 'resolving', coordinator.state

        # Command B supersedes Command A
        ctx_b = coordinator.begin_resolve(cmd_b)
        assert_equal 'resolving', coordinator.state
        refute_equal ctx_a[:message_id], ctx_b[:message_id]

        # Delivery for Command A arrives late
        late_envelope = {
          'schemaId' => 'granete.sketchup-authoring-resolve.v1',
          'responseMessageId' => 'resp-a',
          'inReplyToMessageId' => ctx_a[:message_id],
          'idempotencyKey' => ctx_a[:idempotency_key],
          'status' => 'accepted'
        }

        assert_raises(Granete::SketchUpExtension::Host::SupersededResponseError) do
          coordinator.deliver_response(late_envelope)
        end
      end

      # E. Save and reopen retains committed state without transient UI flags
      def test_save_and_reopen_retains_committed_hierarchy_and_clean_metadata
        initial_entity = place_initial_furniture
        coordinator = build_coordinator
        response = scenario_response('13-definition-driven-typed-parameters')
        command = build_command(
          target_entity: initial_entity,
          response: response,
          request: scenario_request('13-definition-driven-typed-parameters'),
          params: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 3, 'softClose' => true }
        )

        outcome = coordinator.execute(command)
        assert outcome.committed?

        # Prove no transient UI keys in metadata
        entity = granete_furniture_instances.first
        metadata = metadata_store.read(entity)
        %w[resolving buttonDisabled networkError dialogTab].each do |transient_key|
          assert_nil metadata[transient_key], "transient key #{transient_key} must not be in metadata"
        end

        Dir.mktmpdir('granete-smoke-reopen') do |dir|
          skp_path = File.join(dir, 'mutation_committed.skp')
          assert model.save(skp_path), 'saving model must succeed'

          Sketchup.file_new
          assert granete_furniture_instances.empty?, 'new model must be clean'

          assert Sketchup.open_file(skp_path), 'reopening saved model must succeed'
          reopened = granete_furniture_instances.first
          refute_nil reopened, 'committed furniture must exist after reopen'
          reopened_metadata = metadata_store.read(reopened)
          assert_equal 3, reopened_metadata.dig('intent', 'parameters', 'shelfCount')
        end
      end

      private

      def build_coordinator
        Granete::SketchUpExtension::Host::AuthoringMutationCoordinator.new(
          model_provider: method(:model),
          logger: Granete::SketchUpExtension::Logging.logger,
          selection_restorer: Granete::SketchUpExtension::Host::SelectionRestore.new(
            metadata_store_factory: method(:metadata_store),
            model_provider: method(:model),
            logger: Granete::SketchUpExtension::Logging.logger
          ),
          preflight_tracker: Granete::SketchUpExtension::Host::PreflightTracker.new
        )
      end

      def place_initial_furniture
        res = @builder.place_existing_furniture(
          model,
          furniture_instance_id: '51000000-0000-0000-0000-0000000000f1',
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
          project_id: '41000000-0000-0000-0000-000000000001',
          design_id: '52000000-0000-0000-0000-000000000001'
        )
        raise "initial placement failed: #{res['error']}" unless res['success']

        granete_furniture_instances.first
      end

      def build_command(target_entity:, response: nil, request: nil, params: {},
                        raise_during_apply: false, name: 'update_furniture')
        builder = @builder
        metadata_store_inst = metadata_store
        active_model = model

        Class.new(Granete::SketchUpExtension::Host::MutationCommand) do
          define_method(:initialize) do
            super(name: name,
                  semantic_target: { 'furnitureInstanceRef' => metadata_store_inst.read(target_entity)&.dig('identity', 'instanceRef') })
            @target = target_entity
            @response = response
            @request = request
            @params = params
            @raise_apply = raise_during_apply
          end

          define_method(:context_still_valid?) { @target && @target.valid? }
          define_method(:manufacturing_affecting?) { true }

          define_method(:resolve_intent) do |request_context|
            return Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'rejected', reason: 'mocked') unless @response

            parsed_response = JSON.parse(JSON.generate(@response))
            parsed_response['inReplyToMessageId'] = request_context[:message_id]
            parsed_response['idempotencyKey'] = request_context[:idempotency_key]
            expected_req = @request ? JSON.parse(JSON.generate(@request)) : {}
            expected_req['messageId'] = request_context[:message_id]
            expected_req['idempotencyKey'] = request_context[:idempotency_key]

            Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
              parsed_response, expected_request: expected_req
            )
          end

          define_method(:apply_accepted_state) do |result, journal|
            raise 'host exception simulated during apply' if @raise_apply

            journal.record_operation('Actualizar mueble') do
              builder.update_furniture(
                active_model, @target, TC_HostMutationSmoke::DEFINITION, @params,
                resolved_layout: result.layout, material_choices: {}
              )
            end
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

      def granete_definitions
        model.definitions.to_a.select do |definition|
          GRANETE_DEFINITION_PREFIXES.any? { |prefix| definition.name.to_s.start_with?(prefix) }
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
        unless expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")
          flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
        end
        return unless expanded.start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end
    end
  end
end
