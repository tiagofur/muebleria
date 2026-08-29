# frozen_string_literal: true

require 'json'
require 'stringio'
require 'testup/testcase'

# Host validation for #417 (SU-ENT-4): the canonical carpentry cabinet —
# BODY 16 / FRONT 18 / BACK 6, a drawer aggregate of three fronts sharing one
# authoring componentDefinitionId, and visible hardware — must render through
# the INSTALLED extension as a fully native ComponentInstance hierarchy whose
# local axes, role thicknesses and contract identities survive world
# transforms, sibling rebuilds and definition-sharing V1 rules. Negative
# proofs: any managed Group/raw-face board or a world-AABB-baked part
# definition fails this suite. Never loads the repository checkout: the
# product under test is the installed RBZ, and every lookup is scoped to
# Granete-generated definitions because the document template carries its own
# unmanaged content.
module Granete
  module SketchUpExtension
    class TC_NativeValidationSmoke < TestUp::TestCase
      EXPECTED_NAME = 'Granete for SketchUp'
      FIXTURE_PATH = File.join(
        File.expand_path('../..', __dir__),
        'test',
        'fixtures',
        'cabinet_validation_layout.json'
      ).freeze
      REPOSITORY_ROOT = File.expand_path('../../../..', __dir__)
      MM = 1.0 / 25.4
      TOLERANCE = 1e-3
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

      def test_canonical_cabinet_is_a_full_native_hierarchy
        result, top = insert_cabinet

        assert result['success'], "insert failed: #{result['error']}"
        assert_instance_of Sketchup::ComponentInstance, top
        assert_equal 1, granete_furniture_instances.length

        # Managed children: 10 boards + 3 hardware placements, every one a
        # native ComponentInstance. No Group and no raw face may live at the
        # furniture level — board geometry belongs inside part definitions.
        children = top.definition.entities.grep(Sketchup::ComponentInstance)
        assert top.definition.entities.grep(Sketchup::Group).empty?,
               'managed furniture must not wrap children in Groups'
        assert top.definition.entities.grep(Sketchup::Face).empty?,
               'managed furniture level must not carry raw face geometry'
        assert_equal fixture_boards.length + fixture_hardware.length, children.length

        children.each do |child|
          assert_instance_of Sketchup::ComponentInstance, child
          faces = child.definition.entities.grep(Sketchup::Face)
          assert_equal 6, faces.length,
                       "#{child.name} definition must be one solid local box (6 faces)"
          assert child.definition.entities.grep(Sketchup::Group).empty?,
                 "#{child.name} definition must not contain Groups"
        end
      end

      def test_role_thicknesses_render_as_local_geometry_by_material
        _result, top = insert_cabinet

        expected_by_option_role = { 'BODY' => 16.0, 'FRONT' => 18.0, 'BACK' => 6.0 }
        fixture_boards.each do |board|
          child = find_child(top, board['name'])
          refute_nil child, "missing managed child #{board['name']}"
          bounds = child.definition.bounds
          # Local box [0,width]x[0,thickness]x[0,length] on X/Y/Z — the role's
          # effective material thickness is the LOCAL Y extent, never a world
          # dimension.
          assert_in_delta expected_by_option_role.fetch(board['optionRole']) * MM, bounds.height, TOLERANCE,
                          "#{board['name']} local thickness"
          assert_in_delta board['widthMm'] * MM, bounds.width, TOLERANCE, "#{board['name']} local width"
          assert_in_delta board['lengthMm'] * MM, bounds.depth, TOLERANCE, "#{board['name']} local length"
        end
      end

      def test_local_axes_survive_move_and_quarter_turns
        _result, top = insert_cabinet
        children_before = child_geometry_snapshot(top)
        refute children_before.empty?
        # Nested instance bounds live in the furniture frame; only the
        # top-level instance carries the world placement.
        top_bounds_before = [top.bounds.min.to_a, top.bounds.max.to_a]

        # Move, then a quarter turn about Z, then a quarter turn about X: the
        # furniture world transform composes with child transforms; Ruby must
        # never rewrite part geometry for placement.
        top.transformation = Geom::Transformation.translation(Geom::Vector3d.new(1200 * MM, 300 * MM, 0))
        assert_child_geometry_unchanged(top, children_before)

        top.transformation = Geom::Transformation.axes(
          Geom::Point3d.new(0, 0, 0),
          Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
        )
        assert_child_geometry_unchanged(top, children_before)

        top.transformation = Geom::Transformation.axes(
          Geom::Point3d.new(500 * MM, 500 * MM, 0),
          Geom::Vector3d.new(1, 0, 0), Geom::Vector3d.new(0, 0, 1), Geom::Vector3d.new(0, -1, 0)
        )
        assert_child_geometry_unchanged(top, children_before)

        # The furniture really moved in the world (composition through
        # transforms, not rebaked local geometry).
        refute_equal top_bounds_before, [top.bounds.min.to_a, top.bounds.max.to_a],
                     'rotating the furniture must move its world bounds'
      end

      def test_instance_transforms_are_rigid_never_scaled
        _result, top = insert_cabinet

        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          transform = child.transformation
          axes = [transform.xaxis, transform.yaxis, transform.zaxis]
          axes.each_with_index do |axis, index|
            assert_in_delta 1.0, axis.length, 1e-6,
                            "#{child.name}: basis vector #{index} is scaled (non-uniform scale forbidden)"
          end
          (0..2).each do |a|
            ((a + 1)..2).each do |b|
              assert_in_delta 0.0, axes[a].dot(axes[b]), 1e-6,
                              "#{child.name}: basis vectors #{a}/#{b} are not orthogonal"
            end
          end
          determinant = axes[0].dot(axes[1].cross(axes[2]))
          assert_in_delta 1.0, determinant, 1e-6,
                          "#{child.name}: basis must be right-handed (det=+1), never a mirror"
        end
      end

      def test_fi_b_front_change_never_mutates_fi_a
        insert_cabinet
        insert_cabinet
        top_a, top_b = granete_furniture_instances.first(2)
        refute_nil top_a
        refute_nil top_b
        refute_same top_a.definition, top_b.definition,
                    'two units of one FurnitureDefinition must not share a top-level definition'

        fi_a_before = furniture_snapshot(top_a)
        rebuild = builder.update_furniture(model, top_b, definition, {},
                                           resolved_layout: parse_layout(front16_layout_body),
                                           material_choices: { 'FRONT' => 'mat-white16' })
        assert rebuild['success'], "FI-B update failed: #{rebuild['error']}"

        # FI-B fronts rebound to 16 mm under the white16 material…
        assert_in_delta 16 * MM, find_child(top_b, 'Puerta').definition.bounds.height, TOLERANCE
        assert_in_delta 16 * MM, find_child(top_b, 'Frente Cajón 2').definition.bounds.height, TOLERANCE
        store = Granete::SketchUpExtension::Metadata::Store.new(model)
        assert_equal 'mat-white16', store.read(top_b).dig('intent', 'materialChoices', 'FRONT')

        # …while FI-A keeps 18 mm fronts, its hierarchy and its metadata.
        assert_in_delta 18 * MM, find_child(top_a, 'Puerta').definition.bounds.height, TOLERANCE
        assert_in_delta 18 * MM, find_child(top_a, 'Frente Cajón 3').definition.bounds.height, TOLERANCE
        assert_equal fi_a_before, furniture_snapshot(top_a),
                     'rebuilding FI-B must not touch FI-A hierarchy or metadata'
      end

      def test_v1_uses_unique_part_definitions_with_shared_authoring_ids
        _result, top = insert_cabinet

        drawers = ['Frente Cajón 1', 'Frente Cajón 2', 'Frente Cajón 3'].map { |name| find_child(top, name) }
        refute drawers.any?(&:nil?), 'drawer aggregate fronts must exist as managed children'

        # Explicit V1 record: every part definition is unique per instance
        # (exactly one live instance each), even when the authoring contract
        # shares one componentDefinitionId across the copies.
        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          assert_equal 1, child.definition.instances.length,
                       "V1 part definition of #{child.name} must be instance-isolated"
        end
        assert_equal 3, drawers.map(&:definition).uniq.length,
                     'the three drawer-front copies must not share one SU definition in V1'

        store = Granete::SketchUpExtension::Metadata::Store.new(model)
        authoring_ids = drawers.map { |drawer| store.read(drawer).dig('identity', 'componentDefinitionId') }
        assert_equal ['gab-drawer-front'], authoring_ids.uniq,
                     'all copies of one authoring component share its componentDefinitionId'
        instance_ids = drawers.map { |drawer| store.read(drawer).dig('identity', 'componentInstanceId') }
        assert_equal 3, instance_ids.uniq.length,
                     'every drawer-front copy keeps a distinct componentInstanceId'
      end

      def test_business_identity_independent_of_host_locators
        result, top = insert_cabinet
        assert result['success'], "insert failed: #{result['error']}"
        store = Granete::SketchUpExtension::Metadata::Store.new(model)

        identity_before = {}
        persistent_ids_before = {}
        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          identity_before[child.name] = store.read(child)['identity']
          persistent_ids_before[child.name] = child.persistent_id
        end

        rebuild = builder.update_furniture(model, top, definition, {},
                                           resolved_layout: parse_layout(front16_layout_body),
                                           material_choices: { 'FRONT' => 'mat-white16' })
        assert rebuild['success'], "rebuild failed: #{rebuild['error']}"

        identity_after = {}
        persistent_ids_after = {}
        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          identity_after[child.name] = store.read(child)['identity']
          persistent_ids_after[child.name] = child.persistent_id
        end

        # Contract identities per part survive the rebuild untouched — host
        # persistent_ids may legitimately change during regeneration.
        assert_equal identity_before.keys.sort, identity_after.keys.sort
        identity_after.each do |name, identity|
          assert_equal identity_before.fetch(name), identity,
                       "#{name}: Granete identity must survive regeneration"
        end

        # No native locator ever leaks into business metadata.
        locator_values = ([persistent_ids_after.values, persistent_ids_before.values] +
                          definition_guids(top)).flatten.map(&:to_s).uniq
        identity_after.each_value do |identity|
          payload = JSON.generate(identity)
          locator_values.each do |locator|
            next if locator.length < 8

            refute_includes payload, locator,
                            'a host locator (persistent_id/GUID) must never appear as business identity'
          end
        end
      end

      def test_outliner_names_are_semantic_and_rename_safe
        _result, top = insert_cabinet
        store = Granete::SketchUpExtension::Metadata::Store.new(model)

        expected_names = fixture_boards.map { |board| board['name'] } +
                         fixture_hardware.map { |placement| placement['name'] }
        actual_names = top.definition.entities.grep(Sketchup::ComponentInstance).map(&:name)
        assert_equal expected_names.sort, actual_names.sort,
                     'Outliner names must mirror the semantic part names of the fixture'

        drawer = find_child(top, 'Frente Cajón 1')
        identity_before = store.read(drawer)['identity']
        top.name = 'Mueble renombrado por el usuario'
        drawer.name = 'Cajón grande'
        assert_equal identity_before, store.read(drawer)['identity'],
                     'renaming is a label change and never mutates contract identity'
      end

      def test_hardware_keeps_host_and_door_binding_metadata
        _result, top = insert_cabinet
        store = Granete::SketchUpExtension::Metadata::Store.new(model)

        handle = find_child(top, 'Manija Puerta 160')
        refute_nil handle
        metadata = store.read(handle)
        assert_equal 'gab-front-door-copy-0', metadata.dig('intent', 'hostComponentInstanceId'),
                     'visible hardware stays bound to its host board instance'
        # Since #476 hardware owns its occurrence namespace: hardwarePlacementId
        # is the placement identity and componentInstanceId stays a part-only
        # namespace that never aliases it.
        assert_equal 'gab-front-door-copy-0-hw-handle', metadata.dig('identity', 'hardwarePlacementId')
        assert_nil metadata.dig('identity', 'componentInstanceId')

        top.definition.entities.grep(Sketchup::ComponentInstance).each do |child|
          next unless child.name.start_with?('Bisagra')

          assert_equal 'gab-front-door-copy-0',
                       store.read(child).dig('intent', 'hostComponentInstanceId')
        end
      end

      # ------------------------------------------------------------------
      # Test methods must stay ABOVE this line: TestUp discovers public
      # instance methods only.
      # ------------------------------------------------------------------

      DEFINITION = {
        'furniture_definition_id' => 'gab-cajonero-600',
        'name' => 'Gabinete Base Puerta y Cajones 600',
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

      def cabinet_layout_body
        JSON.parse(File.read(FIXTURE_PATH))
      end

      # FI-B / rebuild layout: only the FRONT role changes — material
      # white16 and effective thickness 16 (mirrors the #405 parity
      # contract's frontUpdate scenario, hardware anchor included).
      def front16_layout_body
        body = JSON.parse(File.read(FIXTURE_PATH))
        body['components'].each do |component|
          next unless component['optionRole'] == 'FRONT'

          component['thicknessMm'] = 16
          component['dimensionsMm'][1] = 16
          component['materialId'] = 'mat-white16'
          component['materialCode'] = 'MDG-BLANCO-16'
          component['materialName'] = 'MDF Blanco 16'
          component['materialColorHex'] = '#f2f0eb'
        end
        body['hardware'].each do |placement|
          next unless placement['placementId'].end_with?('-hw-handle')

          placement['transform']['translationMm'][1] = 576
        end
        body
      end

      def parse_layout(body)
        Granete::SketchUpExtension::Library::LayoutContract.parse!(body)
      end

      def fixture_boards
        cabinet_layout_body['components']
      end

      def fixture_hardware
        cabinet_layout_body['hardware']
      end

      def insert_cabinet
        result = builder.insert_furniture(model, definition, {},
                                          resolved_layout: parse_layout(cabinet_layout_body))
        [result, granete_furniture_instances.last]
      end

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

      def find_child(top, name)
        top.definition.entities.grep(Sketchup::ComponentInstance).find { |child| child.name == name }
      end

      def definition_guids(top)
        [top.definition.guid] + top.definition.entities.grep(Sketchup::ComponentInstance).map do |child|
          child.definition.guid
        end
      end

      def child_geometry_snapshot(top)
        top.definition.entities.grep(Sketchup::ComponentInstance).each_with_object({}) do |child, snapshot|
          bounds = child.definition.bounds
          snapshot[child.name] = {
            transform: child.transformation.to_a,
            local_bounds: [bounds.min.to_a, bounds.max.to_a]
          }
        end
      end

      def assert_child_geometry_unchanged(top, before)
        after = child_geometry_snapshot(top)
        assert_equal before.keys.sort, after.keys.sort
        after.each do |name, geometry|
          expected = before.fetch(name)
          assert_equal expected[:transform], geometry[:transform],
                       "#{name}: child transform must not change when the furniture moves"
          assert_equal expected[:local_bounds], geometry[:local_bounds],
                       "#{name}: definition geometry must not change when the furniture moves"
        end
      end

      def furniture_snapshot(top)
        store = Granete::SketchUpExtension::Metadata::Store.new(model)
        {
          name: top.name,
          metadata: store.read(top),
          transform: top.transformation.to_a,
          children: top.definition.entities.grep(Sketchup::ComponentInstance).map do |child|
            [child.name, child.definition.name, child.transformation.to_a,
             child.definition.bounds.height / MM, store.read(child)['identity']]
          end.sort
        }
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
