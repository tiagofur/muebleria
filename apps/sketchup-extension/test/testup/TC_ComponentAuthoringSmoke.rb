# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Real-host smoke test for #467 / SU-AUTH-1:
# Direct internal component authoring with semantic constraints.
#
# Proves against the real INSTALLED extension and SketchUp host, replaying
# the golden #477 scenarios (`02-move-shelf`, `03-add-shelf-shared-definition`,
# `04-remove-shelf`):
#   1. Move: precise-mm move of the movable internal resolves through
#      Granete, rebuilds atomically in ONE operation with the resolved pose
#      stamped by identity, and undo restores the previous composition.
#   2. Add: a second shelf from the same reusable definition gets its own
#      occurrence identity and renders; undo removes exactly it.
#   3. Remove: the shelf disappears while unrelated components stay, in one
#      operation; undo restores it.
#   4. Structural guard: moving a structural part is rejected before any
#      resolve/host operation.
module Granete
  module SketchUpExtension
    class TC_ComponentAuthoringSmoke < TestUp::TestCase
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

      # Golden-backed catalog: the GET layout always answers the CURRENT
      # composition (scenario 01 — sides, bottom/top, back, door, ONE movable
      # shelf), while the authoring resolve replays the active edit scenario.
      # This models the real split: read the present, resolve the edit.
      class SmokeScenarioCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
        BASE_SCENARIO_ID = '01-params-materials-parity'

        attr_accessor :active_scenario_id, :last_authoring_request

        def initialize(fixture)
          super()
          @fixture = fixture
        end

        def find_definition(definition_id)
          return DEFINITION if definition_id == DEFINITION['furniture_definition_id']

          super
        end

        def resolved_layout(_definition_id, _parameters = {}, _choices = {})
          scenario = @fixture['scenarios'].find { |entry| entry['id'] == BASE_SCENARIO_ID }
          return nil unless scenario && scenario['response']['resolved']

          scenario['response']['resolved']['layout']
        end

        def resolve_authoring(request_payload)
          @last_authoring_request = request_payload
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

      # Mirrors the golden definition: dimensions plus the typed parameters
      # the resolve validates, including the quantity-bound shelfCount that
      # authoring must keep consistent with the occurrence snapshot.
      DEFINITION = {
        'furniture_definition_id' => '22222222-2222-2222-2222-222222222222',
        'name' => 'Gabinete Authoring 600',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 },
          { 'name' => 'shelfCount', 'defaultValue' => 1, 'type' => 'number', 'integer' => true,
            'binding' => {
              'version' => 1, 'kind' => 'componentQuantity', 'componentId' => 'comp-shelf',
              'relationship' => {
                'kind' => 'shelf-support', 'sourceRole' => 'shelf-edge',
                'targets' => [
                  { 'componentId' => 'comp-side', 'role' => 'inside-face' },
                  { 'componentId' => 'comp-side-r', 'role' => 'inside-face' }
                ]
              }
            } }
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

      # 1. Move: precise mm → authoritative resolve → one atomic rebuild,
      #    resolved pose stamped by identity, undo restores.
      def test_move_shelf_resolves_authoritatively_and_undo_restores
        initial_entity = place_initial_furniture
        refute_nil initial_entity
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        @catalog_provider.active_scenario_id = '02-move-shelf'
        starts_before = @transaction_observer.starts
        commits_before = @transaction_observer.commits

        outcome = @controller.execute_coordinated_component_mutation(
          @dialog,
          { 'translationMm' => [18, 18, 520] },
          semantic_target: { 'furnitureInstanceRef' => initial_id,
                             'componentInstanceId' => 'mod-comp-shelf-copy-0' },
          command_message_id: 'cmd-move-shelf-1',
          mutation: 'move_component'
        )

        assert outcome.committed?, "move expected to commit, got: #{outcome.outcome} (#{outcome.reason})"
        assert_equal 1, @transaction_observer.starts - starts_before, 'must be exactly ONE start_operation'
        assert_equal 1, @transaction_observer.commits - commits_before, 'must be exactly ONE commit_operation'

        # The request rode the full occurrence snapshot with the transform
        # override — precise authoring intent, no ad-hoc payload.
        furniture_req = @catalog_provider.last_authoring_request['furniture']
        moved = furniture_req['components'].find { |c| c['componentInstanceId'] == 'mod-comp-shelf-copy-0' }
        refute_nil moved, 'the moved occurrence must be part of the snapshot echo'
        assert_equal [18, 18, 520], moved['transform']['translationMm']

        # The applied authoritative layout stamped the resolved pose by
        # identity on the rebuilt child.
        current = granete_furniture_instances.first
        refute_nil current
        assert_equal initial_id, metadata_store.read(current).dig('identity', 'instanceRef')
        resolved_shelf = locate_child(current, 'shelf-01')
        refute_nil resolved_shelf, 'the resolved layout must render its shelf occurrence'
        assert_equal 520, metadata_store.read(resolved_shelf).dig('intent', 'assemblyTranslationMm', 2)

        # ONE undo step restores the previous composition (base shelf back).
        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        refute_nil restored
        assert_equal initial_id, metadata_store.read(restored).dig('identity', 'instanceRef')
        refute_nil locate_child(restored, 'mod-comp-shelf-copy-0'),
                   'undo must restore the pre-move occurrence identity'
      end

      # 2. Add: a second shelf from the SAME reusable definition with its own
      #    occurrence identity; undo removes exactly the addition.
      def test_add_second_shelf_shares_definition_with_distinct_identity
        initial_entity = place_initial_furniture
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        @catalog_provider.active_scenario_id = '03-add-shelf-shared-definition'
        starts_before = @transaction_observer.starts

        outcome = @controller.execute_coordinated_component_mutation(
          @dialog,
          { 'translationMm' => [18, 18, 560] },
          semantic_target: { 'furnitureInstanceRef' => initial_id,
                             'componentInstanceId' => 'mod-comp-shelf-copy-0' },
          command_message_id: 'cmd-add-shelf-1',
          mutation: 'add_component'
        )

        assert outcome.committed?, "add expected to commit, got: #{outcome.outcome} (#{outcome.reason})"
        assert_equal 1, @transaction_observer.starts - starts_before

        furniture_req = @catalog_provider.last_authoring_request['furniture']
        shelves = furniture_req['components'].select { |c| c['componentDefinitionId'] == 'mod-comp-shelf' }
        assert_equal 2, shelves.length, 'the snapshot echo carries both occurrences'
        assert_equal 2, shelves.map { |c| c['componentInstanceId'] }.uniq.length,
                     'distinct componentInstanceId per occurrence'
        assert_equal 2, furniture_req['parameters']['shelfCount'],
                     'the quantity-bound parameter stays consistent with the snapshot'

        current = granete_furniture_instances.first
        shelf_one = locate_child(current, 'shelf-01')
        shelf_two = locate_child(current, 'shelf-02')
        refute_nil shelf_one, 'the first shelf occurrence renders'
        refute_nil shelf_two, 'the added shelf occurrence renders'
        both = [metadata_store.read(shelf_one), metadata_store.read(shelf_two)]
        assert_equal %w[mod-comp-shelf mod-comp-shelf],
                     both.map { |meta| meta.dig('identity', 'componentDefinitionId') },
                     'both occurrences share the reusable definition'

        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        assert_nil locate_child(restored, 'shelf-02'), 'undo removes exactly the addition'
      end

      # 2b. Duplicate: a distinct occurrence identity for the same reusable
      #     definition; undo removes exactly the duplicate.
      def test_duplicate_shelf_allocates_distinct_occurrence_identity
        initial_entity = place_initial_furniture
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        @catalog_provider.active_scenario_id = '03-add-shelf-shared-definition'
        starts_before = @transaction_observer.starts

        outcome = @controller.execute_coordinated_component_mutation(
          @dialog,
          { 'translationMm' => [18, 18, 300] },
          semantic_target: { 'furnitureInstanceRef' => initial_id,
                             'componentInstanceId' => 'mod-comp-shelf-copy-0' },
          command_message_id: 'cmd-duplicate-shelf-1',
          mutation: 'duplicate_component'
        )

        assert outcome.committed?, "duplicate expected to commit, got: #{outcome.outcome} (#{outcome.reason})"
        assert_equal 1, @transaction_observer.starts - starts_before

        furniture_req = @catalog_provider.last_authoring_request['furniture']
        shelves = furniture_req['components'].select { |c| c['componentDefinitionId'] == 'mod-comp-shelf' }
        assert_equal 2, shelves.length
        ids = shelves.map { |c| c['componentInstanceId'] }
        assert_equal 2, ids.uniq.length, 'the duplicate never reuses the source identity'
        assert ids.one? { |id| id.start_with?('ci-') },
               'a fresh ci-* occurrence identity rides alongside the echoed source'

        current = granete_furniture_instances.first
        refute_nil locate_child(current, 'shelf-02'), 'the duplicated occurrence renders'

        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        assert_nil locate_child(restored, 'shelf-02'), 'undo removes exactly the duplicate'
      end

      # 3. Remove: the occurrence disappears, unrelated components stay, and
      #    the dependent relationship/machining state clears with it.
      def test_remove_shelf_drops_occurrence_and_dependent_relationships
        initial_entity = place_initial_furniture
        initial_id = metadata_store.read(initial_entity).dig('identity', 'instanceRef')

        @catalog_provider.active_scenario_id = '04-remove-shelf'
        starts_before = @transaction_observer.starts

        outcome = @controller.execute_coordinated_component_mutation(
          @dialog,
          {},
          semantic_target: { 'furnitureInstanceRef' => initial_id,
                             'componentInstanceId' => 'mod-comp-shelf-copy-0' },
          command_message_id: 'cmd-remove-shelf-1',
          mutation: 'remove_component'
        )

        assert outcome.committed?, "remove expected to commit, got: #{outcome.outcome} (#{outcome.reason})"
        assert_equal 1, @transaction_observer.starts - starts_before

        furniture_req = @catalog_provider.last_authoring_request['furniture']
        assert_equal 0, furniture_req['parameters']['shelfCount'],
                     'the bound parameter reaches zero with the occurrence set'

        current = granete_furniture_instances.first
        assert_nil locate_child(current, 'shelf-01'), 'the shelf occurrence is gone'
        refute_nil locate_child(current, 'door-01'), 'the door stays'
        refute_nil locate_child(current, 'side-left-01'), 'the sides stay'
        assert_nil metadata_store.read(current)['relationships'],
                   'the dependent relationship state clears with the occurrence'

        Sketchup.send_action('editUndo:')
        restored = granete_furniture_instances.first
        refute_nil locate_child(restored, 'mod-comp-shelf-copy-0'), 'undo restores the shelf'
      end

      # 4. Structural guard: a structural part (door, slot `puerta`) never
      #    reaches the resolve — rejected with zero host operations.
      def test_move_structural_part_rejected_with_zero_operations
        place_initial_furniture
        starts_before = @transaction_observer.starts

        outcome = @controller.execute_coordinated_component_mutation(
          @dialog,
          { 'translationMm' => [5, 5, 5] },
          semantic_target: { 'furnitureInstanceRef' => furniture_ref,
                             'componentInstanceId' => 'mod-comp-door-copy-0' },
          command_message_id: 'cmd-structural-1',
          mutation: 'move_component'
        )

        assert outcome.rejected?, 'a structural move must reject'
        assert_equal 0, @transaction_observer.starts - starts_before,
                     'structural moves start ZERO host operations'
        assert outcome.issues.any? { |issue| issue.code == 'OCCURRENCE_COUNT_UNSUPPORTED' },
               'the rejection carries the stable authoring-boundary issue'
      end

      private

      def furniture_ref
        entity = granete_furniture_instances.first
        metadata_store.read(entity).dig('identity', 'instanceRef')
      end

      def quiet_logger
        @quiet_logger ||= Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
      end

      def build_coordinator
        Granete::SketchUpExtension::Host::AuthoringMutationCoordinator.new(
          model_provider: method(:model),
          logger: quiet_logger,
          selection_restorer: Granete::SketchUpExtension::Host::SelectionRestore.new(
            metadata_store_factory: ->(_model) { metadata_store },
            model_provider: method(:model),
            logger: quiet_logger
          ),
          preflight_tracker: Granete::SketchUpExtension::Host::PreflightTracker.new
        )
      end

      def place_initial_furniture
        raw = scenario('01-params-materials-parity')['response']['resolved']['layout']
        layout = Granete::SketchUpExtension::Library::LayoutContract.parse!(raw)

        res = @builder.place_existing_furniture(
          model,
          furniture_instance_id: '51000000-0000-0000-0000-000000000467',
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
          resolved_layout: layout,
          project_id: '41000000-0000-0000-0000-000000000001',
          design_id: '52000000-0000-0000-0000-000000000001'
        )
        raise "initial placement failed: #{res['error']}" unless res['success']

        granete_furniture_instances.first
      end

      def locate_child(furniture, component_id)
        return nil unless furniture

        Granete::SketchUpExtension::Host::SelectionRestore.new(
          metadata_store_factory: ->(_model) { metadata_store },
          model_provider: method(:model),
          logger: quiet_logger
        ).send(:locate_child, furniture, 'componentInstanceId' => component_id)
      end

      def scenario(id)
        fixture['scenarios'].find { |entry| entry['id'] == id } ||
          raise("missing scenario #{id} in golden")
      end

      def fixture
        @fixture ||= JSON.parse(File.read(GOLDEN_PATH))
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
