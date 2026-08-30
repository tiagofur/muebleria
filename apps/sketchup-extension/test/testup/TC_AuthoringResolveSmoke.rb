# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the versioned rich authoring resolve contract (#477): the
# INSTALLED extension must consume the shared golden
# (contracts/sketchupAuthoringResolve.contract.json, generated from the Go
# resolver's own HTTP responses) — an ACCEPTED envelope parses into the
# NativeLayout and drives one atomic FurnitureBuilder operation whose undo
# removes every entity and definition it created; REJECTED/malformed/unknown
# version envelopes raise BEFORE any host mutation: zero operations started,
# zero geometry, zero metadata. Like TC_SelectionContextSmoke, this suite
# tests the installed RBZ only.
module Granete
  module SketchUpExtension
    class TC_AuthoringResolveSmoke < TestUp::TestCase
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
        @apply_calls = 0
      end

      def teardown
        cleanup_granete_entities
      end

      def test_accepted_response_parses_and_drives_one_atomic_native_operation
        response = scenario_response('02-move-shelf')
        result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
          response, expected_request: scenario_request('02-move-shelf')
        )

        assert result.accepted?
        assert_equal 'granete.local-basis.v1', result.layout.transform_contract
        assert_match(/\Asha256-[0-9a-f]{64}\z/, result.manufacturing_fingerprint)
        refute_empty result.catalog_revision
        # Occurrence identity survives request→resolve→this parser: the moved
        # shelf carries the client's exact componentInstanceId.
        shelf = result.layout.boards.find { |board| board.component_instance_id == 'shelf-01' }
        refute_nil shelf
        assert_in_delta 520, shelf.translation[2], 1e-6

        outcome = apply(result)
        assert outcome['success'], "insert failed: #{outcome['error']}"
        assert_equal 1, @apply_calls

        top = granete_furniture_instances.first
        refute_nil top
        # Every board occurrence materialized with its exact Granete identity.
        result.layout.boards.each do |board|
          child = top.definition.entities.grep(Sketchup::ComponentInstance).find do |entity|
            metadata_store.read(entity).dig('identity', 'componentInstanceId') == board.component_instance_id
          end
          refute_nil child, "missing occurrence #{board.component_instance_id}"
        end

        # ONE undo unit: undoing removes every managed entity AND definition
        # the operation created — the atomic rebuild contract.
        definitions_before = granete_definitions.size
        assert definitions_before >= result.layout.boards.size
        entities_before_undo = model.entities.count
        Sketchup.send_action('editUndo:')
        assert granete_furniture_instances.empty?,
               'undo must remove every managed furniture instance'
        assert_equal entities_before_undo - 1, model.entities.count,
                     'undo must remove exactly the one managed top-level instance'
        assert granete_definitions.empty?,
               'undo must remove every Granete definition the operation created'
      end

      def test_rejected_orphan_anchor_never_mutates_the_host
        response = scenario_response('07-orphan-anchor-rejection')
        before = snapshot_host_state

        error = assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveError) do
          apply_parsed(response)
        end
        assert_includes error.issues.map(&:code), 'RELATIONSHIP_ORPHANED'
        assert_host_untouched(before)
        assert_equal 0, @apply_calls
      end

      def test_cost_only_manual_hardware_remains_semantic_and_allows_atomic_rebuild
        result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
          scenario_response('12-cost-only-manual-hardware'),
          expected_request: scenario_request('12-cost-only-manual-hardware')
        )

        assert result.accepted?
        semantic_ids = result.normalized_snapshot['hardwarePlacements'].map do |placement|
          placement['hardwarePlacementId']
        end
        assert_equal ['hp-cost-only-01'], semantic_ids
        refute_includes result.layout.hardware.map(&:placement_id), 'hp-cost-only-01'

        outcome = apply(result)
        assert outcome['success'], "insert failed: #{outcome['error']}"
        assert_equal 1, @apply_calls
        refute_empty granete_furniture_instances
      end

      def test_malformed_envelope_never_mutates_the_host
        before = snapshot_host_state
        assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
          apply_parsed('response' => 'not-an-envelope')
        end
        assert_host_untouched(before)
        assert_equal 0, @apply_calls
      end

      def test_incoherent_snapshot_never_mutates_the_host
        corrupt = deep_copy(scenario_response('02-move-shelf'))
        corrupt['normalizedSnapshot']['components'][0]['componentInstanceId'] = 'corrupt-occurrence'
        before = snapshot_host_state

        assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
          apply_parsed(corrupt, 200)
        end
        assert_host_untouched(before)
        assert_equal 0, @apply_calls
      end

      def test_unknown_schema_version_never_mutates_the_host
        body = scenario_response('08-unknown-schema-version')
        # The gateway already rejected it; simulating a drifted server, the
        # parser must fail closed on the version marker itself.
        drifted = scenario_response('02-move-shelf').merge('schemaVersion' => '9.9')
        before = snapshot_host_state
        assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveContract::ContractError) do
          apply_parsed(drifted)
        end
        # The recorded gateway rejection parses (rejected, with issues) and
        # the transport raises on it instead of returning a usable result.
        result = Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
          body, expected_request: scenario_request('08-unknown-schema-version')
        )
        refute result.accepted?
        assert_raises(Granete::SketchUpExtension::Library::AuthoringResolveError) do
          Granete::SketchUpExtension::Library::AuthoringResolveTransport.interpret(
            { 'status' => 400, 'body' => body },
            expected_request: scenario_request('08-unknown-schema-version')
          )
        end
        assert_host_untouched(before)
        assert_equal 0, @apply_calls
      end

      private

      # The apply path #467/#468 will wire: transport interpret FIRST (a
      # rejection raises there), mutate only after. The sentinel proves a
      # rejection never reaches FurnitureBuilder.
      def apply_parsed(raw_body, http_status = 422)
        result = Granete::SketchUpExtension::Library::AuthoringResolveTransport.interpret(
          { 'status' => http_status, 'body' => raw_body },
          expected_request: scenario_request('02-move-shelf')
        )
        apply(result)
      end

      def apply(result)
        @apply_calls += 1
        @builder.insert_furniture(model, DEFINITION, {}, resolved_layout: result.layout)
      end

      def snapshot_host_state
        {
          entities: model.entities.count,
          definitions: model.definitions.to_a.map(&:name).sort,
          granete: granete_furniture_instances.size,
          granete_definitions: granete_definitions.size
        }
      end

      def assert_host_untouched(before)
        after = snapshot_host_state
        assert_equal before[:entities], after[:entities],
                     'rejected/malformed resolves must not touch host geometry'
        assert_equal before[:definitions], after[:definitions],
                     'rejected/malformed resolves must not touch host definitions'
        assert_equal before[:granete], after[:granete],
                     'rejected/malformed resolves must leave zero managed furniture'
        assert_equal before[:granete_definitions], after[:granete_definitions],
                     'rejected/malformed resolves must leave zero Granete definitions'
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

      def deep_copy(value)
        JSON.parse(JSON.generate(value))
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
