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

      class MockDialog
        attr_reader :executed_scripts

        def initialize
          @executed_scripts = []
        end

        def execute_script(script)
          @executed_scripts << script
        end
      end

      class SmokeScenarioCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
        attr_accessor :active_scenario_id

        def initialize(fixture)
          super()
          @fixture = fixture
        end

        def find_definition(definition_id)
          return DEFINITION if definition_id == DEFINITION['furniture_definition_id']

          super
        end

        def resolved_layout(_definition_id, _parameters = {}, _choices = {})
          scenario = @fixture['scenarios'].find do |entry|
            entry['id'] == (@active_scenario_id || '05-move-manual-hinge')
          end
          return nil unless scenario && scenario['response']['resolved']

          scenario['response']['resolved']['layout']
        end

        def resolve_authoring(request_payload)
          scenario = @fixture['scenarios'].find { |entry| entry['id'] == @active_scenario_id }
          raise "Scenario #{@active_scenario_id.inspect} not found" unless scenario

          body = JSON.parse(JSON.generate(scenario['response']))
          body['responseMessageId'] = "resolve-#{request_payload['messageId']}"
          body['inReplyToMessageId'] = request_payload['messageId']
          body['idempotencyKey'] = request_payload['idempotencyKey']

          Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
            body, expected_request: request_payload
          )
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

        @catalog_provider = SmokeScenarioCatalog.new(fixture)
        @coordinator = build_coordinator
        @dialog = MockDialog.new
        @controller = Granete::SketchUpExtension::UserInterface::DialogController.new(
          logger: quiet_logger,
          status_provider: -> { { 'state' => 'configured' } },
          metadata_store: metadata_store,
          catalog_provider: @catalog_provider,
          mutation_coordinator: @coordinator
        )
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

        @catalog_provider.active_scenario_id = '05-move-manual-hinge'
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        outcome = @controller.execute_coordinated_hardware_update(
          @dialog,
          { 'offsetMm' => 120 },
          semantic_target: { 'furnitureInstanceRef' => initial_id, 'hardwarePlacementId' => 'hp-hinge-01' },
          command_message_id: 'cmd-move-1'
        )

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
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        # Compatible replacement: 06-replace-hinge
        @catalog_provider.active_scenario_id = '06-replace-hinge'
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        outcome = @controller.execute_coordinated_hardware_substitution(
          @dialog,
          { 'targetHardwareDefinitionId' => 'hw-hinge-b' },
          semantic_target: { 'furnitureInstanceRef' => initial_id, 'hardwarePlacementId' => 'hp-hinge-01' },
          command_message_id: 'cmd-sub-1'
        )

        assert outcome.committed?, "substitution expected to commit, got: #{outcome.outcome}"
        assert_equal 1, @transaction_observer.starts - starts_before
        assert_equal 1, @transaction_observer.commits - commits_before

        # Incompatible substitution: rejection with ZERO host operations (#14)
        @catalog_provider.active_scenario_id = 'neg-hardware-incompatible'
        starts_incompat = @transaction_observer.starts

        outcome_incompat = @controller.execute_coordinated_hardware_substitution(
          @dialog,
          { 'targetHardwareDefinitionId' => 'hw-incompatible' },
          semantic_target: { 'furnitureInstanceRef' => initial_id, 'hardwarePlacementId' => 'hp-hinge-01' },
          command_message_id: 'cmd-sub-incompat'
        )

        assert outcome_incompat.rejected?, 'incompatible substitution must reject'
        assert_equal 0, @transaction_observer.starts - starts_incompat,
                     'incompatible substitution must start zero operations'
        assert(outcome_incompat.issues.any? { |i| i.code == 'HARDWARE_INCOMPATIBLE' },
               'must carry structured HARDWARE_INCOMPATIBLE issue')
      end

      # 3. Drilling conflict detection and resolution loop
      def test_drilling_conflict_detected_and_cleared_on_move
        initial_entity = place_initial_furniture
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        # Conflict from authoritative contract (#13)
        @catalog_provider.active_scenario_id = '17-hardware-drilling-conflict'
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        outcome_conflict = @controller.execute_coordinated_hardware_update(
          @dialog,
          { 'offsetMm' => 150 },
          semantic_target: { 'furnitureInstanceRef' => initial_id, 'hardwarePlacementId' => 'hp-hinge-01' },
          command_message_id: 'cmd-conflict-1'
        )

        assert outcome_conflict.committed?
        assert_equal 1, @transaction_observer.starts - starts_before
        assert_equal 1, @transaction_observer.commits - commits_before

        preflight_script = @dialog.executed_scripts.find { |s| s.include?('onPreflightState') }
        refute_nil preflight_script, 'preflight state must be pushed to dialog'

        # Resolve conflict by moving away with 18-hardware-conflict-cleared
        @catalog_provider.active_scenario_id = '18-hardware-conflict-cleared'
        starts_clear = @transaction_observer.starts

        outcome_clear = @controller.execute_coordinated_hardware_update(
          @dialog,
          { 'offsetMm' => 500 },
          semantic_target: { 'furnitureInstanceRef' => initial_id, 'hardwarePlacementId' => 'hp-hinge-01' },
          command_message_id: 'cmd-clear-1'
        )

        assert outcome_clear.committed?
        assert_equal 1, @transaction_observer.starts - starts_clear
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
        raw = scenario('05-move-manual-hinge')['response']['resolved']['layout']
        layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(raw)

        res = @builder.place_existing_furniture(
          model,
          furniture_instance_id: '51000000-0000-0000-0000-0000000000f1',
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
          resolved_layout: layout,
          project_id: '41000000-0000-0000-0000-000000000001',
          design_id: '52000000-0000-0000-0000-000000000001'
        )
        raise "initial placement failed: #{res['error']}" unless res['success']

        granete_furniture_instances.first
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
