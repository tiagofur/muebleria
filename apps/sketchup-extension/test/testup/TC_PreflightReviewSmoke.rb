# frozen_string_literal: true

require 'json'
require 'testup/testcase'

# Real-host smoke test for #466 / SU-UX-1:
# Authoritative preflight review with viewport problem navigation.
#
# Proves against the real INSTALLED extension and SketchUp host:
#   1. Authoritative blocked review: a cabinet fixture with DRILLING_CONFLICT
#      projects as blocked with grouped issues, Spanish titles/remediation,
#      and prevents publication — local parameter validity never claims ready.
#   2. Viewport problem navigation: navigates to exact hardware placement
#      (hp-hinge-01) and host board (side-left-01) without mutating model,
#      entities, definitions or metadata (view state only).
#   3. Rescue loop: user applies corrective authoring intent (hinge move),
#      mutation invalidates review to stale; re-running preflight against
#      cleared authoritative resolve reaches ready and unblocks publish.
#   4. Fallback navigation: when the exact child is regenerated and its
#      locator is stale, navigation frames the owning furniture root.
#   5. Unreachable server: produces honest unavailable, never ready.
module Granete
  module SketchUpExtension
    class TC_PreflightReviewSmoke < TestUp::TestCase
      class MockDialog
        attr_reader :executed_scripts

        def initialize
          @executed_scripts = []
        end

        def execute_script(script)
          @executed_scripts << script
        end

        def visible?
          true
        end
      end

      class SmokeScenarioCatalog < Granete::SketchUpExtension::Library::StaticCatalogProvider
        attr_accessor :active_scenario_id, :unreachable

        def initialize(fixture)
          super()
          @fixture = fixture
          @active_scenario_id = '17-hardware-drilling-conflict'
          @unreachable = false
        end

        def find_definition(definition_id)
          return DEFINITION if definition_id == DEFINITION['furniture_definition_id']

          super
        end

        def resolved_layout(_definition_id, _parameters = {}, _choices = {})
          scenario = @fixture['scenarios'].find do |entry|
            entry['id'] == (@active_scenario_id || '17-hardware-drilling-conflict')
          end
          return nil unless scenario && scenario['response']['resolved']

          scenario['response']['resolved']['layout']
        end

        def resolve_authoring(request_payload)
          if @unreachable
            raise Granete::SketchUpExtension::Library::AuthoringResolveError,
                  'Error del servidor al resolver autoría (HTTP 503)'
          end

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
      FURNITURE_INSTANCE_ID = '51000000-0000-0000-0000-000000000466'
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

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
        @catalog = SmokeScenarioCatalog.new(fixture)
        @dialog = MockDialog.new
        @controller = UserInterface::DialogController.new(
          logger: quiet_logger,
          status_provider: -> { { 'state' => 'configured' } },
          catalog_provider: @catalog
        )
        @furniture = place_initial_furniture
      end

      def teardown
        @controller&.close
        cleanup_granete_entities
      end

      # 1. Blocked review: DRILLING_CONFLICT is projected honestly, with
      # Spanish remediation and grouped issues; publish gate is blocked.
      def test_blocked_preflight_review_and_publish_gate
        payload = run_preflight
        review = payload['review']

        assert_equal 'blocked', review['status']
        assert_equal 1, review['issueCount']
        assert_equal 1, review['severityCounts']['error']

        group = review['groups'].first
        assert_equal 'hardware', group['key']
        assert_equal 'Herrajes y perforaciones', group['label']

        issue = group['issues'].first
        assert_equal 'DRILLING_CONFLICT', issue['code']
        assert_equal 'Conflicto de perforación', issue['title']
        assert_match(/perforaciones|herraje|pieza/, issue['remediation'])

        entry = payload['entries'].find { |e| e['furniture'].include?(FURNITURE_INSTANCE_ID) }
        refute_nil entry
        assert_equal 'blocked', entry['state']
      end

      # 2. Viewport problem navigation: selects the exact hardware and board
      # instances without opening SketchUp operations or mutating the model.
      def test_viewport_problem_navigation_hardware_and_part_zero_mutation
        run_preflight
        entities_count = model.entities.to_a.length
        definitions_count = model.definitions.to_a.length

        # Navigate to hardware problem context
        navigate_issue('issue-0', target: 'hardware')
        selected_hardware = model.selection.first
        refute_nil selected_hardware
        assert_equal 'hp-hinge-01', metadata_store.read(selected_hardware)&.dig('identity', 'hardwarePlacementId')

        # Navigate to host board context
        navigate_issue('issue-0', target: 'part')
        selected_part = model.selection.first
        refute_nil selected_part
        assert_equal 'side-left-01', metadata_store.read(selected_part)&.dig('identity', 'componentInstanceId')

        # Zero productive mutation invariant
        assert_equal entities_count, model.entities.to_a.length, 'navigation must not add or remove entities'
        assert_equal definitions_count, model.definitions.to_a.length, 'navigation must not alter definitions'
      end

      # 3. Rescue loop: moving hinge invalidates review to stale; re-running
      # against cleared authoritative resolve reaches ready.
      def test_authoring_rescue_loop_to_ready
        run_preflight
        assert_equal 'blocked', last_preflight_payload['review']['status']

        target = semantic_scope.merge('hardwarePlacementId' => 'hp-hinge-01')
        mutation_payload = {
          'schemaId' => 'granete.sketchup-host-command.v1',
          'messageId' => 'cmd-rescue-1',
          'mutation' => 'update_hardware_placement',
          'semanticTarget' => target,
          'payload' => { 'offsetMm' => [50, 500], 'placementKind' => 'manual' }
        }
        @controller.handle_authoring_mutation(@dialog, JSON.generate(mutation_payload))

        # Stale state after mutation
        assert_equal 'stale', last_preflight_payload['review']['status']
        assert_equal 'blocked', last_preflight_payload['review']['authoritativeStatus']

        # Switch to cleared authoritative scenario and re-run
        @catalog.active_scenario_id = '18-hardware-conflict-cleared'
        payload = run_preflight

        # Reaches ready
        assert_equal 'ready', payload['review']['status']
        assert_equal 0, payload['review']['issueCount']
        assert_empty payload['review']['groups']

        entry = payload['entries'].find { |e| e['furniture'].include?(FURNITURE_INSTANCE_ID) }
        assert_equal 'ready', entry['state']
      end

      # 4. Fallback navigation when child locator is stale
      def test_stale_child_locator_falls_back_to_owning_furniture
        run_preflight

        # Erase identity metadata on the hinge to simulate stale child locator
        hinge = locate_child_hardware('hp-hinge-01')
        refute_nil hinge
        meta = metadata_store.read(hinge) || {}
        meta.delete('identity')
        metadata_store.write(hinge, meta)

        navigate_issue('issue-0', target: 'hardware')

        nav = last_preflight_payload['review']['navigation']
        assert_equal true, nav['fallback']
        assert_equal 'furniture', nav['kind']
        assert_equal @furniture, model.selection.first
      end

      # 5. Unreachable server produces unavailable, never ready
      def test_unreachable_authoring_resolve_projects_unavailable_never_ready
        @catalog.unreachable = true
        payload = run_preflight

        assert_equal 'unavailable', payload['review']['status']
        refute_equal 'ready', payload['review']['status']
      end

      private

      def run_preflight
        envelope = {
          'schemaId' => 'granete.sketchup-host-command.v1',
          'type' => 'preflight_command',
          'messageId' => "pf-smoke-#{SecureRandom.hex(4)}",
          'command' => 'run',
          'semanticTarget' => semantic_scope,
          'payload' => {}
        }
        @controller.handle_preflight_review(@dialog, JSON.generate(envelope))
        last_preflight_payload
      end

      def navigate_issue(issue_id, target: 'primary')
        envelope = {
          'schemaId' => 'granete.sketchup-host-command.v1',
          'type' => 'preflight_command',
          'messageId' => "pf-nav-#{SecureRandom.hex(4)}",
          'command' => 'navigate_issue',
          'semanticTarget' => semantic_scope,
          'payload' => { 'issueId' => issue_id, 'target' => target }
        }
        @controller.handle_preflight_review(@dialog, JSON.generate(envelope))
      end

      def last_preflight_payload
        script = @dialog.executed_scripts.reverse.find { |s| s.include?('onPreflightState') }
        raise 'no onPreflightState script executed' unless script

        JSON.parse(script.match(/onPreflightState\((.*)\)\z/m)[1])
      end

      def semantic_scope
        { 'furnitureInstanceRef' => FURNITURE_INSTANCE_ID }
      end

      def place_initial_furniture
        raw = scenario('17-hardware-drilling-conflict')['response']['resolved']['layout']
        layout = Library::LayoutContract.parse!(raw)

        res = @builder.place_existing_furniture(
          model,
          furniture_instance_id: FURNITURE_INSTANCE_ID,
          definition: DEFINITION,
          parameters: { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560, 'shelfCount' => 1 },
          resolved_layout: layout
        )
        raise "initial placement failed: #{res['error']}" unless res['success']

        granete_furniture_instances.first
      end

      def locate_child_hardware(placement_id)
        @furniture.definition.entities.grep(Sketchup::ComponentInstance).find do |entity|
          metadata_store.read(entity)&.dig('identity', 'hardwarePlacementId') == placement_id
        end
      end

      def scenario(id)
        fixture['scenarios'].find { |entry| entry['id'] == id } ||
          raise("missing scenario #{id} in golden")
      end

      def fixture
        JSON.parse(File.read(GOLDEN_PATH))
      end

      def metadata_store
        Metadata::Store.new(model)
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

      def quiet_logger
        @quiet_logger ||= SafeLogger.new(sink: StringIO.new)
      end

      def fail_closed_unless_installed_extension_is_loaded
        extension = self.class.installed_extension
        flunk 'Install the Granete for SketchUp RBZ before running the host smoke' unless extension
        flunk 'Enable the installed extension and restart SketchUp before the host smoke' unless extension.loaded?
      end

      def fail_closed_if_loaded_from_checkout
        runtime_path = Runtime.method(:start).source_location&.first
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
