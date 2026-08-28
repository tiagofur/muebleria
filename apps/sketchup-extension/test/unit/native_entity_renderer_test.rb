# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'

# #415 — native SketchUp entity model verification matrix (ADR-0004):
#
#   top-level furniture  = Sketchup::ComponentInstance (isolated definition)
#   physical boards      = nested Sketchup::ComponentInstance
#   local geometry       = definition-local box at origin (#414 axes)
#   identity             = Granete contract IDs in metadata, never host GUIDs
#
# The negative-proof tests fail if the renderer ever regresses to Group-only
# rendering, world-AABB baking, non-uniform scale for productive dimensions,
# shared mutable definitions or native GUIDs as business identity.
class NativeEntityRendererTest < Minitest::Test
  MM = 1.0 / 25.4
  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupLayoutTransform.contract.json', __dir__)

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
  end

  def furniture_instance
    @model.active_entities.instances.first
  end

  def part_instances
    furniture_instance.definition.entities.instances
  end

  def golden_native_layout(body = nil)
    Granete::SketchUpExtension::Library::LayoutContract.parse!(body || JSON.parse(File.read(GOLDEN_PATH)))
  end

  def insert_from_golden
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition,
                              { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
                              resolved_layout: golden_native_layout)
  end

  def vec3(triple)
    Geom::Vector3d.new(triple[0], triple[1], triple[2])
  end

  def rigid?(transform)
    # Columns must be unit and mutually orthogonal, and right-handed: a
    # non-uniform scale (or mirror) can never represent productive dimensions.
    cols = [transform.xaxis, transform.yaxis, transform.zaxis]
    cols.each do |c|
      norm = Math.sqrt((c.x**2) + (c.y**2) + (c.z**2))
      return false if (norm - 1.0).abs > 1e-9
    end
    [0, 1, 2].each do |a|
      ([0, 1, 2] - [a]).each do |b|
        dot = (cols[a].x * cols[b].x) + (cols[a].y * cols[b].y) + (cols[a].z * cols[b].z)
        return false if dot.abs > 1e-9
      end
    end
    x, y, z = cols
    det = (x.x * ((y.y * z.z) - (y.z * z.y))) -
          (x.y * ((y.x * z.z) - (y.z * z.x))) +
          (x.z * ((y.x * z.y) - (y.y * z.x)))
    (det - 1.0).abs <= 1e-9
  end

  # --- obligatory matrix -----------------------------------------------------

  def test_furniture_top_level_is_a_native_component_instance
    result = insert_from_golden

    assert result['success'], result['error']
    furniture = furniture_instance
    assert_instance_of SketchupStub::ComponentInstanceStub, furniture
    # NEGATIVE PROOF: no Group wrapper for managed furniture — a regression to
    # the add_group renderer fails this immediately.
    assert_empty @model.active_entities.groups
  end

  def test_every_physical_managed_board_is_a_nested_component_instance
    insert_from_golden

    layout = golden_native_layout
    assert_equal(layout.boards.length, part_instances.count { |p| metadata_for(p)&.dig('intent', 'role') })
    part_instances.each do |part|
      assert_instance_of SketchupStub::ComponentInstanceStub, part
      # Solid local geometry lives in the definition, not in the parent.
      refute_empty part.definition.entities.faces
      assert_empty part.definition.entities.groups
    end
  end

  def test_local_axes_match_the_414_transform_contract
    insert_from_golden

    layout = golden_native_layout
    layout.boards.each do |board|
      part = part_instances.find do |candidate|
        metadata_for(candidate)&.dig('identity', 'componentInstanceId') == board.component_instance_id
      end
      refute_nil part, "missing native instance for #{board.component_instance_id}"

      expected = Geom::Transformation.axes(
        Geom::Point3d.new(board.translation[0] * MM, board.translation[1] * MM, board.translation[2] * MM),
        vec3(board.basis['x']), vec3(board.basis['y']), vec3(board.basis['z'])
      )
      assert_equal expected, part.transformation,
                   "#{board.slot_id} transform must map 1:1 onto the #414 basis+translation"
      assert rigid?(part.transformation)
    end
  end

  def test_rotated_boards_keep_exact_90_degree_bases
    insert_from_golden

    layout = golden_native_layout
    lateral = layout.boards.find { |b| b.slot_id == 'lateral_izquierdo' }
    part = part_instances.find do |candidate|
      metadata_for(candidate)&.dig('identity', 'componentInstanceId') == lateral.component_instance_id
    end

    # 90° placement: basis entries are exactly 0/±1 (see #414 contract).
    assert_equal Geom::Vector3d.new(0, -1, 0), part.transformation.xaxis
    assert_equal Geom::Vector3d.new(1, 0, 0), part.transformation.yaxis
    assert_equal Geom::Vector3d.new(0, 0, 1), part.transformation.zaxis
    assert_equal Geom::Point3d.new(0, 560 * MM, 0), part.transformation.origin
  end

  def test_furniture_world_rotation_and_move_never_rewrite_child_geometry
    insert_from_golden
    furniture = furniture_instance

    before_children = part_instances.map { |p| [p.name, p.transformation.to_a] }
    before_geometry = part_instances.map { |p| [p.name, p.definition.entities.faces.map(&:points)] }

    quarter_turn = Geom::Transformation.axes(
      Geom::Point3d.new(1000 * MM, 200 * MM, 0),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
    furniture.transformation = quarter_turn

    assert_equal quarter_turn, furniture.transformation
    # Child local transforms and definition geometry are untouched: world
    # placement composes top-down, never baked into parts.
    assert_equal(before_children, part_instances.map { |p| [p.name, p.transformation.to_a] })
    assert_equal(before_geometry, part_instances.map { |p| [p.name, p.definition.entities.faces.map(&:points)] })
  end

  def test_definition_geometry_is_local_at_origin_never_world_aabb
    insert_from_golden

    layout = golden_native_layout
    layout.boards.each do |board|
      part = part_instances.find do |candidate|
        metadata_for(candidate)&.dig('identity', 'componentInstanceId') == board.component_instance_id
      end
      face = part.definition.entities.faces.first
      refute_nil face

      xs = face.points.map(&:x)
      ys = face.points.map(&:y)
      # The local box spans [0,width]×[0,thickness] on X/Y at z=0 — the AABB
      # min corner / world position must NOT be baked into the definition.
      assert_in_delta 0.0, xs.min, 1e-9
      assert_in_delta board.width_mm * MM, xs.max, 1e-9
      assert_in_delta 0.0, ys.min, 1e-9
      assert_in_delta board.thickness_mm * MM, ys.max, 1e-9
      face.points.each { |pt| assert_in_delta 0.0, pt.z, 1e-9 }
    end
  end

  def test_two_furniture_from_same_granete_definition_diverge_in_isolation
    definition = @provider.find_definition('kitchen-base-standard')
    first = @builder.insert_furniture(@model, definition, { 'widthMm' => 600, 'shelfCount' => 1 })
    second = @builder.insert_furniture(@model, definition, { 'widthMm' => 600, 'shelfCount' => 1 })

    assert first['success'] && second['success']
    furniture_a, furniture_b = @model.active_entities.instances.first(2)

    # V1: isolated host definition per FurnitureInstance, even for the same
    # Granete FurnitureDefinition (ADR-0004 §6).
    refute_same furniture_a.definition, furniture_b.definition

    before_b_children = furniture_b.definition.entities.instances.map(&:name)
    before_b_geometry = furniture_b.definition.entities.instances.map { |p| p.definition.entities.faces.map(&:points) }

    # Rebuild FI-A with a different resolved composition (from the server
    # golden). FI-B must not change in any way.
    rebuild = @builder.update_furniture(@model, furniture_a, definition,
                                        { 'widthMm' => 600, 'heightMm' => 720, 'depthMm' => 560 },
                                        resolved_layout: golden_native_layout)
    assert rebuild['success'], rebuild['error']

    assert_equal before_b_children, furniture_b.definition.entities.instances.map(&:name)
    assert_equal(before_b_geometry,
                 furniture_b.definition.entities.instances.map { |p| p.definition.entities.faces.map(&:points) })
    # NEGATIVE PROOF: a shared mutable top-level definition would have
    # propagated FI-A's rebuild into FI-B's children here.
  end

  def test_rename_never_changes_granete_identity
    insert_from_golden
    furniture = furniture_instance

    furniture_meta_before = @store.read(furniture)
    part = part_instances.first
    part_meta_before = @store.read(part)

    furniture.name = 'Cocina renombrada por el usuario'
    part.name = 'Pieza renombrada'

    assert_equal furniture_meta_before, @store.read(furniture)
    assert_equal part_meta_before, @store.read(part)
    # Names are labels only; IDs survive rename untouched.
    assert_equal part_meta_before.dig('identity', 'componentInstanceId'),
                 @store.read(part).dig('identity', 'componentInstanceId')
  end

  def test_native_host_locators_never_become_business_identity
    insert_from_golden
    furniture = furniture_instance

    furniture_definition_guid = furniture.definition.guid
    persisted_ids = [furniture.persistent_id] + part_instances.map(&:persistent_id)

    all_metadata = [@store.read(furniture)] + part_instances.map { |p| @store.read(p) }
    all_metadata.each do |meta|
      json = JSON.generate(meta)
      refute_includes json, furniture_definition_guid
      persisted_ids.each { |pid| refute_includes json, "\"#{pid}\"" }
    end

    # componentDefinitionId is the server-contract value, verbatim.
    layout = golden_native_layout
    layout.boards.each do |board|
      part = part_instances.find do |candidate|
        metadata_for(candidate)&.dig('identity', 'componentInstanceId') == board.component_instance_id
      end
      identity = @store.read(part)['identity']
      assert_equal board.component_definition_id, identity['componentDefinitionId']
      refute_equal identity['componentDefinitionId'], identity['componentInstanceId']
      # Hard rule: the authoring definition ID is neither the SU GUID…
      refute_equal furniture_definition_guid, identity['componentDefinitionId']
      # …nor the part instance's own definition GUID.
      refute_equal part.definition.guid, identity['componentDefinitionId']
    end
  end

  def test_child_metadata_carries_full_semantic_identity
    insert_from_golden

    layout = golden_native_layout
    lateral = layout.boards.find { |b| b.slot_id == 'lateral_izquierdo' }
    part = part_instances.find do |candidate|
      metadata_for(candidate)&.dig('identity', 'componentInstanceId') == lateral.component_instance_id
    end
    meta = @store.read(part)

    assert_equal 'componentInstance', meta['kind']
    assert_equal lateral.component_instance_id, meta.dig('identity', 'componentInstanceId')
    assert_equal lateral.component_definition_id, meta.dig('identity', 'componentDefinitionId')
    assert_equal furniture_instance_metadata_id, meta.dig('identity', 'furnitureInstanceRef')
    assert_equal lateral.slot_id, meta.dig('intent', 'semanticRole')
    assert_equal lateral.role, meta.dig('intent', 'role')
    assert_equal lateral.option_role, meta.dig('intent', 'materialBindingRole')
  end

  def test_catalog_reference_stays_a_separate_namespace
    body = JSON.parse(File.read(GOLDEN_PATH))
    body['components'].each { |c| c['catalogComponentId'] = "catalog-#{c['componentDefinitionId']}" }

    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition, {}, resolved_layout: golden_native_layout(body))

    assert result['success'], result['error']
    part = part_instances.find do |candidate|
      metadata_for(candidate)&.dig('identity', 'componentInstanceId') == 'st-comp-side-copy-0'
    end
    identity = @store.read(part)['identity']
    assert_equal 'catalog-st-comp-side', identity['catalogComponentId']
    # Hard rule: catalog provenance never aliases the authoring definition.
    refute_equal identity['catalogComponentId'], identity['componentDefinitionId']
    refute_equal identity['catalogComponentId'], identity['componentInstanceId']
  end

  def test_hardware_fallback_is_a_native_component_instance
    insert_from_golden

    handle = part_instances.find { |p| p.name == 'Manija 160' }
    refute_nil handle
    assert_instance_of SketchupStub::ComponentInstanceStub, handle
    refute_empty handle.definition.entities.faces
    assert_empty handle.definition.entities.groups

    meta = @store.read(handle)
    assert_equal 'mod-comp-door-copy-0', meta.dig('intent', 'hostComponentInstanceId')
    assert_equal furniture_instance_metadata_id, meta.dig('identity', 'furnitureInstanceRef')
  end

  def test_insertion_failure_is_atomic_and_leaves_no_partial_hierarchy
    definition = @provider.find_definition('kitchen-base-standard')

    # Host explodes while creating the door's part definition: the insertion
    # must abort with zero Granete entities and zero Granete definitions.
    original_add = @model.definitions.method(:add)
    @model.definitions.define_singleton_method(:add) do |name|
      raise 'host definition explosion' if name.include?('Puerta')

      original_add.call(name)
    end

    result = @builder.insert_furniture(@model, definition, {},
                                       resolved_layout: golden_native_layout)

    refute result['success']
    assert_includes result['error'], 'host definition explosion'
    assert_equal :abort, @model.operations.last
    assert_empty @model.active_entities.instances
    assert_empty @model.active_entities.groups
    assert_empty @model.definitions.to_a
  end

  def test_update_rejects_legacy_group_representation
    definition = @provider.find_definition('kitchen-base-standard')
    legacy = SketchupStub::GroupStub.new('legacy cabinet')
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, legacy, 'inst-legacy', definition, {}
    )

    # Host-faithful trap: a real SketchUp Group ALSO responds to #definition,
    # so duck typing cannot discriminate — entity type must.
    assert legacy.respond_to?(:definition)
    assert legacy.is_a?(Sketchup::Group)

    result = @builder.update_furniture(@model, legacy, definition, {})

    refute result['success']
    assert_includes result['error'], 'legacy'
    assert_includes result['error'], '416'
    # The legacy representation is never partially rebuilt: no operation was
    # even started and its definition stays untouched.
    assert_empty legacy.definition.entities.to_a
    assert_empty @model.operations
  end

  def test_builder_rejects_raw_hash_layouts
    definition = @provider.find_definition('kitchen-base-standard')

    result = @builder.insert_furniture(@model, definition, {},
                                       resolved_layout: { 'components' => [] })

    refute result['success']
    assert_includes result['error'], 'NativeLayout'
    assert_empty @model.active_entities.instances
  end

  def test_generic_offline_path_is_also_native
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition,
                                       { 'widthMm' => 600, 'shelfCount' => 1, 'doorCount' => 1 })

    assert result['success']
    assert_instance_of SketchupStub::ComponentInstanceStub, furniture_instance
    assert_empty @model.active_entities.groups
    part_instances.each do |part|
      assert_instance_of SketchupStub::ComponentInstanceStub, part
      assert rigid?(part.transformation)
      assert_equal furniture_instance_metadata_id,
                   @store.read(part).dig('identity', 'furnitureInstanceRef')
    end
  end

  private

  def metadata_for(entity)
    @store.read(entity)
  end

  def furniture_instance_metadata_id
    @store.read(furniture_instance).dig('identity', 'instanceRef')
  end
end
