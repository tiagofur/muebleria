# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the opening representation (#1536, ADR-0009 A2.3): the
# INSTALLED extension rebuilds furniture from the golden grip scenarios and
# the model board MEASURES are compared against the SERVER resolution — the
# plugin transports the resolution, never a Ruby formula. The three
# acceptance models: the L+C drawer column (the C's hardware run between
# every ROW boundary, hosted on the carcass), the italian column (the strip
# BETWEEN fronts as real boards) and the overhang alacena (the front
# extending below the body floor). A FAILED RESOLVE attempts a real rebuild
# that raises and asserts the previous geometry intact; the double rebuild
# pins no duplicates.
#
# SketchUp Bounds accessors: width = X extent, HEIGHT = Y extent,
# DEPTH = Z extent — the vertical assertions read bounds.depth.
module Granete
  module SketchUpExtension
    class TC_OpeningRepresentationSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze
      MM_TO_INCHES = 1.0 / 25.4
      # SketchUp floats: 0.01 in ≈ 0.25 mm — far below any real datasheet
      # precision, far above conversion noise.
      BOUNDS_TOLERANCE_IN = 0.01

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        extension = self.class.installed_extension
        flunk 'la extensión Granete no está instalada y cargada en el host' unless extension
        flunk 'la extensión Granete no está habilitada' unless extension.loaded?

        # Sketchup.file_new settles the model switch lazily when the app is
        # busy — a test that inserts immediately can land in the dying model.
        # The smoke stays on the SAME model and wipes the Granete leftovers
        # in place (definitions removed; recreated fresh per test).
        cleanup_granete_entities
        @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: Granete::SketchUpExtension::Metadata::Store.new(model)
        )
      end

      def teardown
        cleanup_granete_entities
      end

      # 1. Cajonera L arriba + C entre frentes: the model carries the two C
      #    runs (one per ROW boundary) HOSTED ON THE CARCASS (#1300 — they
      #    must NOT ride the drawer motion), and every board's vertical
      #    measure matches the server resolution.
      def test_cajonera_l_c_runs_between_row_boundaries_hosted_on_carcass
        result = parsed('40-grip-cajonera-l-c')
        apply(result)

        runs = model_hardware_children.select do |child|
          child.definition.name.to_s.include?('opening-profile-between-')
        end
        assert_equal 2, runs.length, '3 filas → 2 corridas del C entre frentes en el modelo'

        # #1300: the runs are hosted on the CARCASS — never on a drawer/door
        # front (hosting on the front made the grip swing with the motion).
        front_ids = model_board_ids.select { |id| id.include?('comp-dfront-1536') }
        runs.each do |run|
          host = metadata_store.read(run)&.dig('intent', 'hostComponentInstanceId')
          refute_nil host, 'la corrida declara su host (intent)'
          refute front_ids.include?(host),
                 "la corrida del C se aloja en la carcasa, no en un frente (host #{host})"
        end

        assert_boards_match_resolution('40-grip-cajonera-l-c')
      end

      # 2. Cajonera italiana: the BETWEEN strips are real boards in the model
      #    hanging from each row boundary, and EVERY board's vertical measure
      #    matches the server resolution (z min + z extent from the wire).
      def test_italiana_strips_between_fronts_match_the_resolution
        result = parsed('41-grip-italiana-strip-between')
        apply(result)

        assert_boards_match_resolution('41-grip-italiana-strip-between')

        strips = model_board_children.select do |child|
          child.definition.name.to_s.include?('opening-strip-between-')
        end
        assert_equal 2, strips.length, '3 filas → 2 tiras ENTRE cajones en el modelo'

        # Mirror rule against the WIRE: each strip's AABB z matches the
        # server's published placement (min z + 70 mm height).
        wire_strips = wire_components('41-grip-italiana-strip-between').select do |comp|
          comp['componentInstanceId'].to_s.start_with?('opening-strip-between-')
        end
        assert_equal 2, wire_strips.length
        strips.each do |strip|
          instance_id = metadata_store.read(strip)&.dig('identity', 'componentInstanceId')
          wire = wire_strips.find { |comp| comp['componentInstanceId'] == instance_id }
          refute_nil wire, "la tira #{instance_id} corresponde a la resolución"
          assert_in_delta wire['transform']['translationMm'][2] * MM_TO_INCHES,
                          strip.bounds.min.z, BOUNDS_TOLERANCE_IN,
                          "la tira #{instance_id} cuelga del borde inferior de su fila superior"
          assert_in_delta wire['dimensionsMm'][2] * MM_TO_INCHES,
                          strip.bounds.depth, BOUNDS_TOLERANCE_IN,
                          "la tira #{instance_id} mide su alto declarado (70)"
        end
      end

      # 3. Alacena con rebase de 20 mm: the door extends BELOW the body floor
      #    by EXACTLY the resolved overhang — the model measure equals the
      #    server arithmetic, verbatim.
      def test_alacena_overhang_extends_the_front_below_the_floor
        result = parsed('42-grip-alacena-rebase-20')
        apply(result)

        assert_boards_match_resolution('42-grip-alacena-rebase-20')

        wire_door = wire_components('42-grip-alacena-rebase-20').find do |comp|
          comp['componentInstanceId'].to_s.include?('comp-puerta-1536')
        end
        refute_nil wire_door, 'la alacena tiene su frente en la resolución'

        door = model_board_children.find do |child|
          metadata_store.read(child)&.dig('identity', 'componentInstanceId') == wire_door['componentInstanceId']
        end
        refute_nil door, 'el frente materializado existe en el modelo'
        assert_in_delta wire_door['transform']['translationMm'][2] * MM_TO_INCHES,
                        door.bounds.min.z, BOUNDS_TOLERANCE_IN,
                        'el frente baja exactamente los 20 mm resueltos por el servidor'
        assert_operator door.bounds.min.z, :<, 0,
                        'el frente extendido del rebase baja por debajo del piso del mueble'
        assert_in_delta wire_door['dimensionsMm'][2] * MM_TO_INCHES,
                        door.bounds.depth, BOUNDS_TOLERANCE_IN,
                        'el frente extendido mide su alto resuelto (738 = 718 + 20)'
      end

      # 4. Rebuild twice: no duplicate profiles, strips or cuts — the
      #    identity-based rebuild (update_furniture on the SAME root) wipes
      #    and re-renders in place.
      def test_rebuild_twice_leaves_no_duplicates
        result = parsed('41-grip-italiana-strip-between')
        outcome = @builder.insert_furniture(
          model, definition_for(result), result.normalized_snapshot.fetch('parameters'),
          resolved_layout: result.layout
        )
        assert outcome['success'], "insert failed: #{outcome['error']}"
        top = granete_furniture_instances.first
        refute_nil top, 'el mueble insertado debe existir'
        before_ids = model_board_children.map do |child|
          metadata_store.read(child)&.dig('identity', 'componentInstanceId')
        end.sort
        before_count = model_board_children.size
        runs_before = model_hardware_children.count do |child|
          child.definition.name.to_s.include?('opening-profile-between-')
        end
        definitions_before = granete_definitions.size

        @builder.update_furniture(
          model, top, definition_for(result), result.normalized_snapshot.fetch('parameters'),
          resolved_layout: result.layout
        )
        after_ids = model_board_children.map do |child|
          metadata_store.read(child)&.dig('identity', 'componentInstanceId')
        end.sort
        assert_equal before_ids, after_ids, 'la doble reconstrucción no duplica tableros'
        assert_equal before_count, model_board_children.size, 'sin tableros duplicados'
        runs_after = model_hardware_children.count do |child|
          child.definition.name.to_s.include?('opening-profile-between-')
        end
        assert_equal runs_before, runs_after, 'sin corridas duplicadas'
        assert_equal definitions_before, granete_definitions.size, 'sin definiciones duplicadas'
      end

      # 5. A FAILED RESOLVE preserves the previous valid geometry: a real
      #    rebuild attempt whose resolve RAISES runs through the mutation
      #    coordinator — never commits, the previous geometry intact
      #    (persistent ids and board counts unchanged).
      def test_failed_resolution_preserves_the_previous_geometry
        result = parsed('41-grip-italiana-strip-between')
        outcome = @builder.insert_furniture(
          model, definition_for(result), result.normalized_snapshot.fetch('parameters'),
          resolved_layout: result.layout
        )
        assert outcome['success'], "insert failed: #{outcome['error']}"
        top = granete_furniture_instances.first
        before_ids = granete_furniture_instances.map(&:persistent_id).sort
        boards_before = model_board_children.size
        definitions_before = granete_definitions.size

        command = failing_rebuild_command(top)
        coordinator = Granete::SketchUpExtension::Host::AuthoringMutationCoordinator.new(
          model_provider: method(:model),
          logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new),
          selection_restorer: Granete::SketchUpExtension::Host::SelectionRestore.new(
            metadata_store_factory: -> { Granete::SketchUpExtension::Metadata::Store.new(model) },
            model_provider: method(:model),
            logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
          ),
          preflight_tracker: Granete::SketchUpExtension::Host::PreflightTracker.new
        )
        batch_outcome = coordinator.execute_batch([command])
        refute batch_outcome.committed?, 'el rebuild que falla NUNCA commitea'
        assert_equal before_ids, granete_furniture_instances.map(&:persistent_id).sort,
                     'el resolve que falla no toca la geometría válida'
        assert_equal boards_before, model_board_children.size
        assert_equal definitions_before, granete_definitions.size
      end

      private

      # A MutationCommand whose RESOLVE raises the exact error the
      # design-opening bridge raises when the resolve channel is unavailable
      # — the rebuild fails BEFORE any host mutation.
      def failing_rebuild_command(target)
        store = Granete::SketchUpExtension::Metadata::Store.new(model)
        Class.new(Granete::SketchUpExtension::Host::MutationCommand) do
          define_method(:initialize) do
            ref = store.read(target)&.dig('identity', 'instanceRef')
            super(name: 'update_furniture', operation_name: 'Aplicar Apertura',
                  semantic_target: { 'furnitureInstanceRef' => ref },
                  resolve: nil, apply: nil, context_valid: nil)
            @target = target
          end

          define_method(:context_still_valid?) { @target&.valid? }

          define_method(:resolve_intent) do |_request_context|
            raise Granete::SketchUpExtension::Library::LayoutResolutionError,
                  'el canal de resolución de autoría no está disponible para actualizar la apertura'
          end

          define_method(:apply_accepted_state) do |_result, _host_context|
            flunk 'a failed resolve must never reach apply'
          end
        end.new
      end

      def model
        Sketchup.active_model
      end

      def metadata_store
        Granete::SketchUpExtension::Metadata::Store.new(model)
      end

      def parsed(id)
        entry = scenario(id)
        Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
          entry['response'], expected_request: entry['request']
        )
      end

      def apply(result)
        parameters = result.normalized_snapshot.fetch('parameters')
        @builder.insert_furniture(
          model, definition_for(result), parameters, resolved_layout: result.layout
        )
      end

      def definition_for(result)
        {
          'furniture_definition_id' => result.layout.furniture_definition_id,
          'name' => result.layout.definition_name,
          'parameters' => fixture.fetch('parameterDefinitions')
        }
      end

      # Aceptación 1: las medidas de los TABLEROS del modelo coinciden con la
      # resolución del servidor — z mínima y extensión Z de cada tablero
      # contra el wire (bounds.depth es el eje Z de SketchUp).
      def assert_boards_match_resolution(scenario_id)
        wires = wire_components(scenario_id)
        granete_furniture_instances.each do |top|
          top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
            meta = metadata_store.read(child)
            next unless meta&.dig('identity', 'componentInstanceId')

            wire = wires.find do |comp|
              comp['componentInstanceId'] == meta['identity']['componentInstanceId']
            end
            next unless wire

            assert_in_delta wire['transform']['translationMm'][2] * MM_TO_INCHES,
                            child.bounds.min.z, BOUNDS_TOLERANCE_IN,
                            "#{wire['componentInstanceId']}: z mínima del modelo ≠ resolución"
            assert_in_delta wire['dimensionsMm'][2] * MM_TO_INCHES,
                            child.bounds.depth, BOUNDS_TOLERANCE_IN,
                            "#{wire['componentInstanceId']}: extensión Z del modelo ≠ resolución"
          end
        end
      end

      def wire_components(id)
        scenario(id)['response']['resolved']['layout']['components']
      end

      def model_board_children
        boards = []
        granete_furniture_instances.each do |top|
          top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
            next unless child.definition.name.to_s.start_with?('Granete · Parte · ')

            boards.push(child)
          end
        end
        boards
      end

      def model_board_ids
        model_board_children.map { |child| metadata_store.read(child)&.dig('identity', 'componentInstanceId') }
      end

      def model_hardware_children
        hardware = []
        granete_furniture_instances.each do |top|
          top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
            next unless child.definition.name.to_s.start_with?('Granete · Herraje · ')

            hardware.push(child)
          end
        end
        hardware
      end

      def granete_furniture_instances
        model.entities.to_a.grep(Sketchup::ComponentInstance).select do |entity|
          entity.definition.name.to_s.start_with?('Granete · Mueble · ')
        end
      end

      def granete_definitions
        model.definitions.to_a.select { |definition| definition.name.to_s.start_with?('Granete · ') }
      end

      def cleanup_granete_entities
        granete_furniture_instances.each do |entity|
          entity.erase! if entity.valid?
        end
        model.definitions.to_a.each do |definition|
          next unless GRANETE_DEFINITION_PREFIXES.any? { |p| definition.name.to_s.start_with?(p) }

          model.definitions.remove(definition)
        end
      end

      def scenario(id)
        fixture['scenarios'].find { |entry| entry['id'] == id } ||
          raise("missing scenario #{id} in golden")
      end

      def fixture
        JSON.parse(File.read(GOLDEN_PATH))
      end
    end
  end
end
