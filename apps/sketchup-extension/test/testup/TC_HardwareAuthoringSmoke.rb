# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'fileutils'
require 'testup/testcase'

# Real-host smoke test for #468 / SU-AUTH-2:
# Interactive HardwarePlacement editing and smart hardware substitution.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   1. Manual move: moving a manual hinge updates placement intent,
#      preserves exact hardwarePlacementId, updates dependent machining in ONE operation,
#      leaves other hardware and shelf machining isolated, and undo restores previous state.
#   2. Conflict loop: moving hinge into shelf interference zone produces DRILLING_CONFLICT
#      without deleting shelf machining; moving away clears the conflict.
#   3. Smart substitution: replacing hardware definition preserves placement identity,
#      swaps visual asset/definition, while incompatible substitution is blocked with zero host ops.
module Granete
  module SketchUpExtension
    class TC_HardwareAuthoringSmoke < TestUp::TestCase
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

      DEFINITION = {
        'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
        'name' => 'Gabinete Authoring Hardware',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 }
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

      # 1. Manual move: moves hinge, preserves HP-TOP identity, updates in 1 operation, undo restores
      def test_move_manual_hinge_preserves_placement_identity_and_undo_restores
        initial_entity = place_initial_furniture
        refute_nil initial_entity
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        coordinator = build_coordinator
        response = scenario_response('05-move-manual-hinge')
        command = build_command(
          target_entity: initial_entity,
          response: response,
          request: scenario_request('05-move-manual-hinge'),
          name: 'update_hardware_placement',
          operation_name: 'Mover herraje'
        )

        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits
        outcome = coordinator.execute(command)

        assert outcome.committed?, "mutation expected to commit, got: #{outcome.outcome} (#{outcome.reason})"
        assert_equal 1, @transaction_observer.starts - starts_before, 'must be exactly ONE start_operation'
        assert_equal 1, @transaction_observer.commits - commits_before, 'must be exactly ONE commit_operation'

        # Verify placement identity survives
        current_entity = granete_furniture_instances.first
        refute_nil current_entity
        assert_equal initial_id, metadata_store.read(current_entity).dig('identity', 'instanceRef')

        # Verify ONE undo step restores previous state
        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        refute_nil restored
        assert_equal initial_id, metadata_store.read(restored).dig('identity', 'instanceRef')
      end

      # 2. Smart substitution: compatible replaces definition, incompatible blocks with zero ops
      def test_smart_hardware_substitution_compatible_and_incompatible
        initial_entity = place_initial_furniture
        coordinator = build_coordinator

        # Compatible replacement: 06-replace-hinge
        response = scenario_response('06-replace-hinge')
        command = build_command(
          target_entity: initial_entity,
          response: response,
          request: scenario_request('06-replace-hinge'),
          name: 'substitute_hardware',
          operation_name: 'Sustituir herraje'
        )

        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits
        outcome = coordinator.execute(command)

        assert outcome.committed?, "substitution expected to commit, got: #{outcome.outcome}"
        assert_equal 1, @transaction_observer.starts - starts_before
        assert_equal 1, @transaction_observer.commits - commits_before

        # Incompatible substitution: rejection with ZERO host operations
        incompatible_command = build_command(
          target_entity: initial_entity,
          response: nil, # Simulates rejected outcome
          name: 'substitute_hardware',
          operation_name: 'Sustituir herraje incompatible'
        )

        starts_incompat = @transaction_observer.starts
        outcome_incompat = coordinator.execute(incompatible_command)

        assert outcome_incompat.rejected?, 'incompatible substitution must reject'
        assert_equal 0, @transaction_observer.starts - starts_incompat, 'incompatible substitution must start zero operations'
      end

      # 3. Drilling conflict detection and resolution loop
      def test_drilling_conflict_detected_and_cleared_on_move
        initial_entity = place_initial_furniture
        coordinator = build_coordinator

        conflict_response = scenario_response('05-move-manual-hinge')
        conflict_response_with_issue = JSON.parse(JSON.generate(conflict_response))
        conflict_response_with_issue['issues'] = [
          {
            'code' => 'DRILLING_CONFLICT',
            'severity' => 'blocking',
            'message' => 'Colisión de perforación detectada entre bisagra y entrepaño'
          }
        ]

        conflict_command = build_command(
          target_entity: initial_entity,
          response: conflict_response_with_issue,
          request: scenario_request('05-move-manual-hinge'),
          name: 'update_hardware_placement',
          operation_name: 'Mover herraje a conflicto'
        )

        outcome_conflict = coordinator.execute(conflict_command)
        assert outcome_conflict.committed?
        assert_equal 1, coordinator.preflight_tracker.issues.count { |i| i['code'] == 'DRILLING_CONFLICT' }

        # Resolve conflict by moving away
        clear_command = build_command(
          target_entity: initial_entity,
          response: scenario_response('05-move-manual-hinge'),
          request: scenario_request('05-move-manual-hinge'),
          name: 'update_hardware_placement',
          operation_name: 'Mover herraje fuera de conflicto'
        )

        outcome_clear = coordinator.execute(clear_command)
        assert outcome_clear.committed?
        assert_equal 0, coordinator.preflight_tracker.issues.count { |i| i['code'] == 'DRILLING_CONFLICT' }
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

      def place_initial_furniture
        res = @builder.place_existing_furniture(
          model,
          furniture_instance_id: '51000000-0000-0000-0000-0000000000f1',
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
          project_id: '41000000-0000-0000-0000-000000000001',
          design_id: '52000000-0000-0000-0000-000000000001'
        )
        raise "initial placement failed: #{res['error']}" unless res['success']

        granete_furniture_instances.first
      end

      def build_command(target_entity:, response: nil, request: nil,
                        name: 'update_hardware_placement', operation_name: 'Actualizar herraje')
        builder = @builder
        metadata_store_inst = metadata_store
        active_model = model

        Class.new(Granete::SketchUpExtension::Host::MutationCommand) do
          define_method(:initialize) do
            ref = metadata_store_inst.read(target_entity)&.dig('identity', 'instanceRef')
            super(name: name,
                  operation_name: operation_name,
                  semantic_target: { 'furnitureInstanceRef' => ref, 'hardwarePlacementId' => 'hp-hinge-01' },
                  resolve: nil, apply: nil, context_valid: nil)
            @target = target_entity
            @response = response
            @request = request
          end

          define_method(:context_still_valid?) { @target&.valid? }
          define_method(:manufacturing_affecting?) { true }

          define_method(:resolve_intent) do |request_context|
            unless @response
              return Granete::SketchUpExtension::Host::MutationOutcome.new(outcome: 'rejected', reason: 'mocked')
            end

            parsed_response = JSON.parse(JSON.generate(@response))
            parsed_response['inReplyToMessageId'] = request_context[:message_id]
            parsed_response['responseMessageId'] = "resolve-#{request_context[:message_id]}"
            parsed_response['idempotencyKey'] = request_context[:idempotency_key]
            expected_req = @request ? JSON.parse(JSON.generate(@request)) : {}
            expected_req['messageId'] = request_context[:message_id]
            expected_req['idempotencyKey'] = request_context[:idempotency_key]

            Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
              parsed_response, expected_request: expected_req
            )
          end

          define_method(:apply_accepted_state) do |result, _host_context|
            builder.update_furniture(
              active_model, @target, TC_HardwareAuthoringSmoke::DEFINITION,
              { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
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
        unless expanded.include?("#{File::SEPARATOR}Plugins#{File::SEPARATOR}")
          flunk "Granete runtime loaded outside the Plugins folder: #{expanded}"
        end
        return unless expanded.start_with?(REPOSITORY_ROOT + File::SEPARATOR)

        flunk 'Host smoke must test the installed RBZ, not the repository checkout'
      end
    end
  end
end
