# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the semantic SelectionContext (#476): the INSTALLED
# extension must resolve viewport selection into the one canonical context
# model — kind furniture/aggregate/part/hardware/unmanaged with stable
# Granete identity and capability-driven inspector data — surviving rename,
# move/rotate and child regeneration, and never guessing managed identity
# for arbitrary user geometry. Like TC_NativeEntitySmoke, this suite tests
# the installed RBZ only and scopes every lookup to Granete-generated
# entities: the host template may carry its own unmanaged content.
module Granete
  module SketchUpExtension
    class TC_SelectionContextSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'native_layout.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze
      IDENTITY_KEYS = %w[kind furnitureInstanceId componentInstanceId
                         componentDefinitionId hardwarePlacementId
                         hardwareDefinitionId hostComponentInstanceId].freeze

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
        @observer = Granete::SketchUpExtension::Observers::SelectionObserver.new(
          metadata_store: Granete::SketchUpExtension::Metadata::Store.new(model),
          catalog_provider: Granete::SketchUpExtension::Library::StaticCatalogProvider.new,
          on_selection_change: ->(_payload) {}
        )
        model.selection.add_observer(@observer)
      end

      def teardown
        model.selection.remove_observer(@observer) if @observer
        cleanup_granete_entities
      end

      def test_top_level_furniture_selection_produces_furniture_context
        insert_fixture_furniture
        top = granete_furniture_instances.first
        context = select_and_resolve(top)
        assert_equal 'furniture', context['kind']
        store = metadata_store
        assert_equal store.read(top).dig('identity', 'instanceRef'), context['furnitureInstanceId']
        assert_equal 'native', context['representation']
        assert context['capabilities']['canEditParameters'].is_a?(Hash)
        # 'mod-1' is not in the packaged static catalog: the capability must
        # be honestly unsupported with an explanation, never silently on.
        refute context['capabilities']['canEditParameters']['supported']
        assert context['capabilities']['canEditParameters']['reason']
      end

      def test_nested_part_selection_keeps_owner_and_definition_identity
        insert_fixture_furniture
        top = granete_furniture_instances.first
        lateral = find_child_by_component_id(top, 'st-comp-side-copy-0')

        context = select_and_resolve(lateral)
        assert_equal 'part', context['kind']
        assert_equal 'st-comp-side-copy-0', context['componentInstanceId']
        assert_equal 'st-comp-side', context['componentDefinitionId']
        assert_equal metadata_store.read(top).dig('identity', 'instanceRef'),
                     context['furnitureInstanceId']
        assert_equal 2, context['semanticPath'].length
        assert context['hostLocator']['entityPersistentId']
      end

      def test_hardware_selection_exposes_placement_host_and_derived_origin
        insert_fixture_furniture
        top = granete_furniture_instances.first
        hardware = top.definition.entities.grep(Sketchup::ComponentInstance).find do |child|
          metadata_store.read(child).dig('intent', 'entityClass') == 'hardware'
        end
        refute_nil hardware, 'fixture layout must render one hardware placement'

        context = select_and_resolve(hardware)
        assert_equal 'hardware', context['kind']
        assert_equal 'mod-comp-door-copy-0-hw-0', context['hardwarePlacementId']
        assert_equal 'hw-handle', context['hardwareDefinitionId']
        assert_equal 'mod-comp-door-copy-0', context['hostComponentInstanceId']
        assert_equal 'resolved', context['origin']
        # Derived hardware never exposes manual-edit capabilities.
        %w[canMove canRotate canChangeHandedness canReplaceDefinition].each do |name|
          refute context['capabilities'][name]['supported'], "#{name} must be disabled"
          assert context['capabilities'][name]['reason'], "#{name} must explain why"
        end
      end

      def test_rename_and_move_never_change_selection_identity
        insert_fixture_furniture
        top = granete_furniture_instances.first
        lateral = find_child_by_component_id(top, 'st-comp-side-copy-0')

        before = select_and_resolve(lateral)

        top.name = 'Módulo renombrado y girado'
        lateral.name = 'Costado renombrado'
        top.transformation = Geom::Transformation.rotation(
          Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(0, 0, 1), 90.degrees
        )

        after = select_and_resolve(lateral)

        IDENTITY_KEYS.each do |key|
          assert_equal before[key], after[key], "identity key #{key} changed"
        end
      end

      def test_rebuild_recovers_the_same_semantic_context_with_new_host_locator
        insert_fixture_furniture
        top = granete_furniture_instances.first
        lateral = find_child_by_component_id(top, 'st-comp-side-copy-0')

        before = select_and_resolve(lateral)
        old_persistent_id = lateral.persistent_id

        rebuild = @builder.update_furniture(model, top, definition, {},
                                            resolved_layout: parse_layout)
        assert rebuild['success'], "update failed: #{rebuild['error']}"

        regenerated = find_child_by_component_id(top, 'st-comp-side-copy-0')
        refute_nil regenerated
        after = select_and_resolve(regenerated)

        IDENTITY_KEYS.each do |key|
          assert_equal before[key], after[key], "identity key #{key} changed across rebuild"
        end
        refute_equal old_persistent_id, regenerated.persistent_id
        assert_equal old_persistent_id, before['hostLocator']['entityPersistentId']
        assert_equal regenerated.persistent_id, after['hostLocator']['entityPersistentId']
      end

      def test_two_occurrences_sharing_one_definition_never_collapse
        body = native_layout_body
        duplicated = JSON.parse(JSON.generate(body['components'].find do |component|
          component['componentInstanceId'] == 'st-comp-base-copy-0'
        end))
        duplicated['componentInstanceId'] = 'st-comp-base-copy-1'
        duplicated['name'] = 'Piso Gemelo'
        duplicated['localTransform']['translationMm'] = [0, 100, 400]
        body['components'] << duplicated

        @builder.insert_furniture(model, definition, {}, resolved_layout: parse_layout(body))
        top = granete_furniture_instances.first
        base_a = find_child_by_component_id(top, 'st-comp-base-copy-0')
        base_b = find_child_by_component_id(top, 'st-comp-base-copy-1')
        refute_nil base_a
        refute_nil base_b

        context_a = select_and_resolve(base_a)
        context_b = select_and_resolve(base_b)

        assert_equal 'part', context_a['kind']
        assert_equal 'part', context_b['kind']
        assert_equal context_a['componentDefinitionId'], context_b['componentDefinitionId']
        refute_equal context_a['componentInstanceId'], context_b['componentInstanceId']
        refute_equal context_a['display']['name'], context_b['display']['name']
      end

      def test_unmanaged_geometry_stays_unmanaged
        insert_fixture_furniture
        group = model.active_entities.add_group
        group.entities.add_line([0, 0, 0], [100, 0, 0])

        context = select_and_resolve(group)
        assert_equal 'unmanaged', context['kind']
        assert_empty context['capabilities']
        assert group.respond_to?(:definition), 'host reality: Group responds to #definition'
      end

      # ------------------------------------------------------------------
      # Test methods must stay ABOVE this line: TestUp discovers public
      # instance methods only.
      # ------------------------------------------------------------------

      DEFINITION = {
        'furniture_definition_id' => 'mod-1',
        'name' => 'Base Una Puerta 600',
        'parameters' => [
          { 'name' => 'widthMm', 'defaultValue' => 600 },
          { 'name' => 'heightMm', 'defaultValue' => 720 },
          { 'name' => 'depthMm', 'defaultValue' => 560 }
        ]
      }.freeze

      private

      def model
        Sketchup.active_model
      end

      def metadata_store
        Granete::SketchUpExtension::Metadata::Store.new(model)
      end

      def definition
        DEFINITION
      end

      # Real-host truth: SketchUp defers SelectionObserver notifications
      # to the event loop, so events never fire synchronously inside a test.
      # The observer's public resolve() is the exact code the deferred event
      # runs — resolving through it proves host metadata, persistent_id and
      # ownership recovery without racing the event loop.
      def select_and_resolve(entity)
        model.selection.clear
        model.selection.add(entity)
        context = @observer.resolve(entity, selection: model.selection)
        refute_nil context, 'the resolver must produce a SelectionContext'
        context.to_payload
      end

      def native_layout_body
        JSON.parse(File.read(FIXTURE_PATH))
      end

      def parse_layout(body = nil)
        Granete::SketchUpExtension::Library::LayoutContract.parse!(body || native_layout_body)
      end

      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          entity.definition.name.to_s.start_with?('Granete · Mueble · ')
        end
      end

      def insert_fixture_furniture
        result = @builder.insert_furniture(model, definition, {},
                                           resolved_layout: parse_layout)
        assert result['success'], "insert failed: #{result['error']}"
        granete_furniture_instances.first
      end

      # Locates a managed child by Granete componentInstanceId metadata —
      # never by name, which rename can change at any time.
      def find_child_by_component_id(top, component_instance_id)
        top.definition.entities.grep(Sketchup::ComponentInstance).find do |child|
          metadata_store.read(child).dig('identity', 'componentInstanceId') == component_instance_id
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
      rescue StandardError
        nil
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
