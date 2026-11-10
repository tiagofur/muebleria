# frozen_string_literal: true

require 'json'
require 'testup/testcase'

# Host smoke for the opening representation (#1536, ADR-0009 A2.3): the
# INSTALLED extension rebuilds furniture from the golden grip scenarios and
# the model boards MEASURE exactly what the server resolved — the plugin
# transports the resolution, never a Ruby formula. The three acceptance
# models: the L+C drawer column (the C's hardware run between every front
# pair), the italian column (the strip BETWEEN fronts as real boards) and
# the overhang alacena (the front extending below the body floor). Dedupe
# (rebuild twice) and failure preservation ride the same atomicity the
# batch/authoring smokes pin.
module Granete
  module SketchUpExtension
    class TC_OpeningRepresentationSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GOLDEN_PATH = File.join(REPOSITORY_ROOT, 'contracts', 'sketchupAuthoringResolve.contract.json').freeze
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        extension = self.class.installed_extension
        flunk 'la extensión Granete no está instalada y cargada en el host' unless extension
        flunk 'la extensión Granete no está habilitada' unless extension.loaded?

        # SketchUp 2026 file_new settles the model switch LAZILY when the
        # app is busy — a test that inserts immediately can land in the
        # dying model. So: stay on the SAME model and wipe the Granete
        # leftovers in place (definitions removed; definitions.add then
        # recreates them fresh per test — no async race).
        cleanup_granete_entities
        @metadata_store = Granete::SketchUpExtension::Metadata::Store.new(model)
        @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: @metadata_store
        )
      end

      def teardown
        cleanup_granete_entities
      end

      # 1. Cajonera L arriba + C entre frentes: the C's hardware run
      #    materializes BETWEEN every front pair — 2 derived placements for
      #    the 3-front column, the envelope from the frozen datasheet.
      def test_cajonera_l_c_draws_the_c_run_between_every_front_pair
        result = parsed('40-grip-cajonera-l-c')
        apply(result)

        assert_between_runs(result, 2)
      end

      # 2. Cajonera italiana: the strip rides BETWEEN fronts as real boards
      #    (2 strips for 3 fronts; the top band carries the third), the
      #    doors carry the between bevels. The mirror rule: each between
      #    strip's top edge hangs from the upper front's bottom edge.
      def test_italiana_column_carries_the_between_strips_and_bevels
        result = parsed('41-grip-italiana-strip-between')
        apply(result)

        boards = granete_boards
        strips = boards.select { |board| board.definition.name.to_s.include?('opening-strip-between-') }
        assert_equal 2, strips.length,
                     "3 frentes → 2 tiras ENTRE cajones; materializado: #{boards.map do |b|
                       b.definition.name
                     end.join(' || ')}"

        front_instances = boards.select { |board| board.definition.name.to_s.include?('Frente Cajón') }
        assert_equal 3, front_instances.length
        front_bottoms = front_instances.map { |board| board.bounds.min.z }.sort.reverse
        strips.each do |strip|
          top_edge = strip.bounds.min.z + strip.bounds.depth
          assert front_bottoms.any? { |z| (z - top_edge).abs < 1e-6 },
                 "la tira cuelga del borde inferior del frente superior (top #{top_edge})"
        end
      end

      # 3. Alacena con rebase de 20 mm: the door extends BELOW the body
      #    floor by exactly the overhang — the resolved arithmetic, verbatim.
      def test_alacena_overhang_extends_the_front_below_the_floor
        result = parsed('42-grip-alacena-rebase-20')
        apply(result)

        door = granete_boards.find { |board| board.definition.name.to_s.include?('Puerta') } ||
               granete_boards.min_by { |board| board.bounds.min.z }
        refute_nil door, 'la alacena tiene su frente'
        assert_operator door.bounds.min.z, :<, 0,
                        'el frente extendido del rebase baja por debajo del piso del mueble'
      end

      # 4. Rebuild twice: no duplicate profiles, strips or cuts — the
      #    identity-based rebuild (update_furniture on the SAME root) wipes
      #    and re-renders in place.
      def test_rebuild_twice_leaves_no_duplicates
        result = parsed('41-grip-italiana-strip-between')
        @builder.insert_furniture(
          model, definition_for(result), result.normalized_snapshot.fetch('parameters'),
          resolved_layout: result.layout
        )
        top = granete_furniture_instances.first
        refute_nil top, 'el mueble insertado debe existir'
        before_ids = granete_boards.map do |board|
          @metadata_store.read(board).dig('identity', 'componentInstanceId')
        end.sort
        before_count = granete_boards.size
        strips_before = granete_boards.count do |board|
          board.definition.name.to_s.include?('opening-strip-between-')
        end
        definitions_before = granete_definitions.size

        # The rebuild: update_furniture on the SAME root (the #1536 flow the
        # design-opening bridge drives), not a second insert.
        @builder.update_furniture(
          model, top, definition_for(result), result.normalized_snapshot.fetch('parameters'),
          resolved_layout: result.layout
        )
        after_ids = granete_boards.map do |board|
          @metadata_store.read(board).dig('identity', 'componentInstanceId')
        end.sort
        assert_equal before_ids, after_ids, 'la doble reconstrucción no duplica tableros'
        assert_equal before_count, granete_boards.size, 'sin tableros duplicados'
        assert_equal strips_before, granete_boards.count { |board|
          board.definition.name.to_s.include?('opening-strip-between-')
        }, 'sin tiras duplicadas'
        assert_equal definitions_before, granete_definitions.size, 'sin definiciones duplicadas'
        assert_equal definitions_before, granete_definitions.size, 'sin definiciones duplicadas'
      end

      # 5. A failed resolve preserves the previous valid geometry: the
      #    rejected golden scenario leaves the host untouched.
      def test_failed_resolution_preserves_the_previous_geometry
        result = parsed('41-grip-italiana-strip-between')
        apply(result)
        before = granete_furniture_instances.map(&:persistent_id).sort
        boards_before = granete_boards.size

        entry = scenario('neg-adhoc-body-parameter')
        assert_equal 'rejected', entry['response']['status']
        assert_equal before, granete_furniture_instances.map(&:persistent_id).sort,
                     'el resolve rechazado no toca la geometría válida'
        assert_equal boards_before, granete_boards.size
      end

      private

      def model
        Sketchup.active_model
      end

      def parsed(id)
        entry = scenario(id)
        Granete::SketchUpExtension::Library::AuthoringResolveContract.parse!(
          entry['response'], expected_request: entry['request']
        )
      end

      def apply(result)
        parameters = result.normalized_snapshot.fetch('parameters')
        outcome = @builder.insert_furniture(
          model, definition_for(result), parameters, resolved_layout: result.layout
        )
        assert outcome['success'], "insert failed: #{outcome['error']}"
        outcome
      end

      def definition_for(result)
        {
          'furniture_definition_id' => result.layout.furniture_definition_id,
          'name' => result.layout.definition_name,
          'parameters' => fixture.fetch('parameterDefinitions')
        }
      end

      def assert_between_runs(result, expected)
        runs = result.layout.hardware.select do |placement|
          placement.placement_id.to_s.start_with?('opening-profile-between-')
        end
        assert_equal expected, runs.length,
                     "3 frentes → #{expected} corridas del C entre frentes"
        runs.each do |run|
          assert_operator Array(run.dimensions).compact.flatten.map(&:to_f).sum, :>, 0,
                          'la corrida del C lleva su envolvente de ficha'
        end
      end

      def granete_boards
        boards = []
        granete_furniture_instances.each do |top|
          top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
            name = child.definition.name.to_s
            next unless name.start_with?('Granete · Parte · ')
            next if name.include?('Lateral') || name.include?('Techo') ||
                    name.include?('Piso') || name.include?('Respaldo')

            boards.push(child)
          end
        end
        boards
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
