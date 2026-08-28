# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host smoke for the native SketchUp entity model (#415 / ADR-0004): the
# INSTALLED extension must insert and rebuild managed furniture as native
# ComponentInstances with local geometry, authoritative #414 transforms and
# Granete contract identity in namespaced metadata. Like TC_BootstrapSmoke,
# this suite never loads the repository checkout: the product under test is
# the installed RBZ. The host's default document template may carry its own
# geometry (e.g. a person ComponentInstance), so every lookup is scoped to
# Granete-generated definitions — never to "whatever entity is first".
module Granete
  module SketchUpExtension
    class TC_NativeEntitySmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'native_layout.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4
      GRANETE_DEFINITION_PREFIXES = ['Granete · Mueble · ', 'Granete · Parte · ',
                                     'Granete · Herraje · '].freeze

      def self.installed_extension
        Sketchup.extensions.to_a.find { |extension| extension.name == EXPECTED_NAME }
      end

      def setup
        fail_closed_unless_installed_extension_is_loaded
        fail_closed_if_loaded_from_checkout
        Sketchup.file_new
      end

      def teardown
        cleanup_granete_entities
      end

      def test_inserted_furniture_and_boards_are_native_component_instances
        result, top = insert_fixture_furniture

        assert result['success'], "insert failed: #{result['error']}"
        assert_instance_of Sketchup::ComponentInstance, top
        assert_equal 1, granete_furniture_instances.length

        # No managed Group wrapper anywhere in the managed hierarchy (the
        # template may legally carry its own unmanaged content).
        children = top.definition.entities.grep(Sketchup::ComponentInstance)
        assert top.definition.entities.grep(Sketchup::Group).empty?
        assert children.length.positive?

        layout = native_layout
        assert_equal layout['components'].length + layout['hardware'].length, children.length
        children.each do |child|
          assert_instance_of Sketchup::ComponentInstance, child
          assert child.definition.entities.length.positive?,
                 "definition of #{child.name} must carry local solid geometry"
        end
      end

      def test_part_definitions_hold_local_geometry_at_origin
        _result, top = insert_fixture_furniture

        lateral = find_child(top, 'Lateral')
        refute_nil lateral
        bounds = lateral.definition.bounds
        # Local box [0,width]×[0,thickness]×[0,length] (engine convention) in
        # inches — never world/AABB coordinates baked into the definition.
        assert_in_delta 560 * MM, bounds.width, 1e-3
        assert_in_delta 18 * MM, bounds.height, 1e-3
        assert_in_delta 684 * MM, bounds.depth, 1e-3
      end

      def test_lateral_transform_matches_the_414_basis_and_translation
        _result, top = insert_fixture_furniture

        lateral = find_child(top, 'Lateral')
        expected = Geom::Transformation.axes(
          Geom::Point3d.new(0, 560 * MM, 0),
          Geom::Vector3d.new(0, -1, 0), Geom::Vector3d.new(1, 0, 0), Geom::Vector3d.new(0, 0, 1)
        )
        assert_transforms_equal expected, lateral.transformation
      end

      def test_furniture_move_and_rotation_never_rewrite_child_geometry
        _result, top = insert_fixture_furniture
        lateral = find_child(top, 'Lateral')
        child_transform_before = lateral.transformation.to_a
        # BoundingBox has no #to_a in the real host; min/max Points do.
        bounds = lateral.definition.bounds
        child_bounds_before = [bounds.min.to_a, bounds.max.to_a]

        quarter_turn = Geom::Transformation.axes(
          Geom::Point3d.new(1000 * MM, 200 * MM, 0),
          Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
        )
        top.transformation = quarter_turn

        assert_transforms_equal quarter_turn, top.transformation
        lateral = find_child(top, 'Lateral')
        assert_transforms_equal Geom::Transformation.new(child_transform_before), lateral.transformation
        bounds = lateral.definition.bounds
        assert_equal child_bounds_before, [bounds.min.to_a, bounds.max.to_a]
      end

      def test_two_furniture_units_diverge_without_shared_definition_effects
        insert_fixture_furniture
        insert_fixture_furniture
        top_a, top_b = granete_furniture_instances.first(2)
        refute_nil top_a
        refute_nil top_b

        refute_same top_a.definition, top_b.definition

        children_b_before = top_b.definition.entities.grep(Sketchup::ComponentInstance).map(&:name)
        rebuild = builder.update_furniture(model, top_a, definition, {},
                                           resolved_layout: parse_layout)
        assert rebuild['success'], "update failed: #{rebuild['error']}"

        assert_equal children_b_before,
                     top_b.definition.entities.grep(Sketchup::ComponentInstance).map(&:name)
      end

      def test_rename_keeps_granete_identity_in_metadata
        _result, top = insert_fixture_furniture
        store = Granete::SketchUpExtension::Metadata::Store.new(model)
        lateral = find_child(top, 'Lateral')
        identity_before = store.read(lateral)['identity']

        top.name = 'Módulo renombrado'
        lateral.name = 'Costado renombrado'

        assert_equal identity_before, store.read(lateral)['identity']
        assert_equal identity_before['componentInstanceId'], store.read(lateral)['identity']['componentInstanceId']
      end

      def test_host_locators_never_become_business_identity
        _result, top = insert_fixture_furniture
        store = Granete::SketchUpExtension::Metadata::Store.new(model)

        store_definition_guids = [top.definition.guid]
        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          store_definition_guids << child.definition.guid
        end

        [top, *top.definition.entities.grep(Sketchup::ComponentInstance)].each do |entity|
          payload = JSON.generate(store.read(entity))
          store_definition_guids.each do |guid|
            refute_includes payload, guid,
                            'a native SU definition GUID must never appear as business identity'
          end
        end

        lateral = find_child(top, 'Lateral')
        identity = store.read(lateral)['identity']
        assert_equal 'st-comp-side', identity['componentDefinitionId']
        refute_equal lateral.definition.guid, identity['componentDefinitionId']
      end

      def test_broken_contract_fails_closed_without_touching_the_model
        body = native_layout_body
        body['components'][0]['localTransform']['basis'] = {
          'x' => [0, 1, 0], 'y' => [1, 0, 0], 'z' => [0, 0, 1] # left-handed mirror
        }

        error = assert_raises Granete::SketchUpExtension::Library::LayoutContract::ContractError do
          parse_layout(body)
        end
        refute_nil error.message
        # No GRANETE entity or definition may exist from a rejected contract
        # (the template's own content is not ours to assert about).
        assert granete_furniture_instances.empty?
        assert granete_definitions.empty?
      end

      def test_abort_operation_leaves_no_partial_hierarchy
        # The atomicity primitive the builder relies on: anything created
        # inside an aborted operation disappears, including definitions.
        model.start_operation('granete_probe', true)
        definition = model.definitions.add('Granete · Parte · probe')
        group = model.active_entities.add_group
        model.abort_operation

        refute definition.valid?
        refute group.valid?
        assert model.definitions['Granete · Parte · probe'].nil?
      end

      def test_legacy_group_representation_fails_closed_with_migration_pointer
        # Host reality: a SketchUp Group ALSO responds to #definition, so the
        # update guard must discriminate by entity type, not duck typing.
        group = model.active_entities.add_group
        group.entities.add_line([0, 0, 0], [100, 0, 0])
        Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
          Granete::SketchUpExtension::Metadata::Store.new(model),
          group, 'inst-legacy', definition, {}
        )
        assert group.respond_to?(:definition)
        assert group.is_a?(Sketchup::Group)

        result = builder.update_furniture(model, group, definition, {})

        refute result['success']
        assert_includes result['error'], '416'
        assert group.valid?
        assert_equal 1, group.definition.entities.count # only its own line
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

      def builder
        @builder ||= Granete::SketchUpExtension::Model::FurnitureBuilder.new(
          metadata_store: Granete::SketchUpExtension::Metadata::Store.new(model)
        )
      end

      def definition
        DEFINITION
      end

      def native_layout_body
        JSON.parse(File.read(FIXTURE_PATH))
      end

      def parse_layout(body = nil)
        Granete::SketchUpExtension::Library::LayoutContract.parse!(body || native_layout_body)
      end

      def native_layout
        native_layout_body
      end

      # Granete furniture = top-level instances of our generated definitions.
      # The document template can carry its own ComponentInstances, so never
      # grab "the first instance in the model".
      def granete_furniture_instances
        model.entities.grep(Sketchup::ComponentInstance).select do |entity|
          entity.definition.name.to_s.start_with?('Granete · Mueble · ')
        end
      end

      def granete_definitions
        model.definitions.select do |definition|
          GRANETE_DEFINITION_PREFIXES.any? { |prefix| definition.name.to_s.start_with?(prefix) }
        end
      end

      def insert_fixture_furniture
        result = builder.insert_furniture(model, definition, {},
                                          resolved_layout: parse_layout)
        [result, granete_furniture_instances.last]
      end

      def find_child(top, name)
        top.definition.entities.grep(Sketchup::ComponentInstance).find { |child| child.name == name }
      end

      def assert_transforms_equal(expected, actual)
        expected.to_a.each_with_index do |value, index|
          assert_in_delta value, actual.to_a[index], 1e-6,
                          "transform component #{index}: expected #{value}, got #{actual.to_a[index]}"
        end
      end

      # Scoped self-cleanup: only Granete-generated entities/definitions are
      # removed — template or user content in the scratch document is not ours.
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
