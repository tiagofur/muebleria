# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/library/layout_contract'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

class MaterialRebuildTest < Minitest::Test
  MM = 1.0 / 25.4

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)
    @definition = Granete::SketchUpExtension::Library::CatalogProvider.new
                                                                      .find_definition('kitchen-base-standard')
  end

  def test_material_change_atomically_rebuilds_every_bound_native_part_and_preserves_context
    initial_choices = {
      'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-16', 'BACK' => 'mat-back-6'
    }
    insert = @builder.insert_furniture(
      @model, @definition, {}, resolved_layout: native_layout(16),
                               material_choices: initial_choices
    )
    assert insert['success'], insert['error']

    furniture = furniture_instances.first
    original_meta = @store.read(furniture)
    original_meta['identity']['furnitureInstanceId'] = 'fi-project-404'
    original_meta['identity']['designRef'] = 'design-404'
    original_meta['identity']['sourceRevisionRef'] = 'obsolete-revision'
    original_meta['intent']['designRevisionId'] = 'design-revision-7'
    @store.write(furniture, original_meta)

    # Model a native copy that temporarily shares the top-level definition.
    sibling = @model.active_entities.add_instance(furniture.definition, Geom::Transformation.new)
    @store.write(sibling, original_meta.merge('identity' => original_meta['identity'].merge('instanceRef' => 'copy')))
    sibling_definition = sibling.definition
    sibling_snapshot = hierarchy_snapshot(sibling)

    moved = Geom::Transformation.axes(
      Geom::Point3d.new(100 * MM, 50 * MM, 0),
      Geom::Vector3d.new(0, 1, 0), Geom::Vector3d.new(-1, 0, 0), Geom::Vector3d.new(0, 0, 1)
    )
    furniture.transformation = moved
    before_operations = @model.operations.length

    result = @builder.update_furniture(
      @model, furniture, @definition, {}, resolved_layout: native_layout(18),
                                          material_choices: { 'FRONT' => 'mat-front-18' }
    )

    assert result['success'], result['error']
    assert_same furniture, furniture_instances.first
    assert_equal moved, furniture.transformation
    refute_same sibling_definition, furniture.definition
    assert_same sibling_definition, sibling.definition
    assert_equal sibling_snapshot, hierarchy_snapshot(sibling)
    assert_equal [[:start, 'Editar Mueble Gabinete Base Estándar', true], :commit],
                 @model.operations.drop(before_operations)

    body = managed_parts(furniture).select { |part| material_role(part) == 'BODY' }
    fronts = managed_parts(furniture).select { |part| material_role(part) == 'FRONT' }
    assert_equal 2, body.length
    assert_equal 3, fronts.length
    body.each { |part| assert_in_delta 16 * MM, local_thickness(part), 1e-9 }
    fronts.each { |part| assert_in_delta 18 * MM, local_thickness(part), 1e-9 }

    handle = managed_parts(furniture).find { |part| part.name == 'Handle' }
    refute_nil handle
    assert_equal Geom::Point3d.new(480 * MM, 18 * MM, 300 * MM), handle.transformation.origin
    assert_equal 'door', @store.read(handle).dig('intent', 'hostComponentInstanceId')

    rebuilt_meta = @store.read(furniture)
    assert_equal 'fi-project-404', rebuilt_meta.dig('identity', 'furnitureInstanceId')
    assert_equal 'design-404', rebuilt_meta.dig('identity', 'designRef')
    assert_equal @definition['version'], rebuilt_meta.dig('identity', 'sourceRevisionRef')
    assert_equal 'design-revision-7', rebuilt_meta.dig('intent', 'designRevisionId')
    assert_equal({ 'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-18', 'BACK' => 'mat-back-6' },
                 rebuilt_meta.dig('intent', 'materialChoices'))
  end

  def test_body_change_rebuilds_every_body_part_without_changing_front_or_back
    initial_choices = {
      'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-18', 'BACK' => 'mat-back-6'
    }
    insert = @builder.insert_furniture(
      @model, @definition, {}, resolved_layout: native_layout(18, body_thickness: 16),
                               material_choices: initial_choices
    )
    assert insert['success'], insert['error']
    furniture = furniture_instances.first

    result = @builder.update_furniture(
      @model, furniture, @definition, {}, resolved_layout: native_layout(18, body_thickness: 18),
                                          material_choices: { 'BODY' => 'mat-body-18' }
    )
    assert result['success'], result['error']

    by_role = managed_parts(furniture).group_by { |part| material_role(part) }
    assert_equal 2, by_role.fetch('BODY').length
    by_role.fetch('BODY').each { |part| assert_in_delta 18 * MM, local_thickness(part), 1e-9 }
    body_right = by_role.fetch('BODY').find { |part| part.name == 'Body Right' }
    assert_in_delta 582 * MM, body_right.transformation.origin.x, 1e-9
    by_role.fetch('FRONT').each { |part| assert_in_delta 18 * MM, local_thickness(part), 1e-9 }
    assert_in_delta 6 * MM, local_thickness(by_role.fetch('BACK').first), 1e-9

    assert_equal(
      { 'BODY' => 'mat-body-18', 'FRONT' => 'mat-front-18', 'BACK' => 'mat-back-6' },
      @store.read(furniture).dig('intent', 'materialChoices')
    )
  end

  def test_material_change_without_native_resolution_fails_before_opening_an_operation
    @builder.insert_furniture(
      @model, @definition, {}, resolved_layout: native_layout(16),
                               material_choices: { 'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-16' }
    )
    furniture = furniture_instances.first
    before_hierarchy = hierarchy_snapshot(furniture)
    before_meta = @store.read(furniture)
    before_operations = @model.operations.dup

    result = @builder.update_furniture(
      @model, furniture, @definition, {}, resolved_layout: nil,
                                          material_choices: { 'FRONT' => 'mat-front-18' }
    )

    refute result['success']
    assert_includes result['error'], 'composición nativa resuelta'
    assert_equal before_hierarchy, hierarchy_snapshot(furniture)
    assert_equal before_meta, @store.read(furniture)
    assert_equal before_operations, @model.operations
  end

  def test_successful_rebuild_keeps_an_already_unique_top_level_definition
    @builder.insert_furniture(
      @model, @definition, {}, resolved_layout: native_layout(16),
                               material_choices: { 'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-16' }
    )
    furniture = furniture_instances.first
    top_definition = furniture.definition

    result = @builder.update_furniture(
      @model, furniture, @definition, {}, resolved_layout: native_layout(18),
                                          material_choices: { 'FRONT' => 'mat-front-18' }
    )

    assert result['success'], result['error']
    assert_same top_definition, furniture.definition
    assert_equal(1, @model.definitions.count { |candidate| candidate.name.start_with?('Granete · Mueble · ') })
  end

  def test_failure_after_metadata_write_aborts_geometry_definition_isolation_and_metadata
    @builder.insert_furniture(
      @model, @definition, {}, resolved_layout: native_layout(16),
                               material_choices: { 'BODY' => 'mat-body-16', 'FRONT' => 'mat-front-16' }
    )
    furniture = furniture_instances.first
    before_definition = furniture.definition
    sibling = @model.active_entities.add_instance(before_definition, Geom::Transformation.new)
    sibling_hierarchy = hierarchy_snapshot(sibling)
    before_transform = furniture.transformation
    before_hierarchy = hierarchy_snapshot(furniture)
    before_meta = @store.read(furniture)
    before_operations = @model.operations.length

    original_write = @store.method(:write)
    @store.define_singleton_method(:write) do |target, payload|
      written = original_write.call(target, payload)
      if payload['kind'] == 'furnitureInstance' && payload.dig('intent', 'materialChoices', 'FRONT') == 'mat-front-18'
        raise 'metadata persistence explosion'
      end

      written
    end

    result = @builder.update_furniture(
      @model, furniture, @definition, {}, resolved_layout: native_layout(18),
                                          material_choices: { 'FRONT' => 'mat-front-18' }
    )

    refute result['success']
    assert_includes result['error'], 'metadata persistence explosion'
    assert_same before_definition, furniture.definition
    assert_same before_definition, sibling.definition
    assert_equal sibling_hierarchy, hierarchy_snapshot(sibling)
    assert_equal before_transform, furniture.transformation
    assert_equal before_hierarchy, hierarchy_snapshot(furniture)
    assert_equal before_meta, @store.read(furniture)
    assert_equal [[:start, 'Editar Mueble Gabinete Base Estándar', true], :abort],
                 @model.operations.drop(before_operations)
  end

  private

  def native_layout(front_thickness, body_thickness: 16)
    Granete::SketchUpExtension::Library::LayoutContract.parse!(
      layout_body(front_thickness, body_thickness: body_thickness)
    )
  end

  def layout_body(front_thickness, body_thickness:)
    {
      'furnitureDefinitionId' => @definition['furniture_definition_id'],
      'definitionName' => @definition['name'],
      'transformContract' => 'granete.local-basis.v1',
      'dimensionsMm' => [600, 720, 560],
      'components' => [
        board('body-left', 'Body Left', 'BODY', body_thickness, [0, 0, 0]),
        board('body-right', 'Body Right', 'BODY', body_thickness, [600 - body_thickness, 0, 0]),
        board('back', 'Back', 'BACK', 6, [0, 0, 0]),
        board('door', 'Door', 'FRONT', front_thickness, [0, 560, 0]),
        board('drawer-front-1', 'Drawer Front 1', 'FRONT', front_thickness, [0, 560, 240]),
        board('drawer-front-2', 'Drawer Front 2', 'FRONT', front_thickness, [0, 560, 480])
      ],
      'hardware' => [
        {
          'placementId' => 'door-handle', 'hardwareId' => 'handle-160', 'name' => 'Handle',
          'shape' => 'bar-pull', 'hostComponentInstanceId' => 'door', 'anchorFace' => 'front',
          'transform' => { 'translationMm' => [480, front_thickness, 300] },
          'dimensionsMm' => [96, 25, 32]
        }
      ]
    }
  end

  def board(id, name, role, thickness, translation)
    {
      'componentInstanceId' => id, 'componentDefinitionId' => "definition-#{id}",
      'slotId' => id, 'role' => role, 'name' => name, 'kind' => 'board',
      'transform' => { 'translationMm' => translation }, 'dimensionsMm' => [500, thickness, 200],
      'localTransform' => {
        'translationMm' => translation,
        'basis' => { 'x' => [1, 0, 0], 'y' => [0, 1, 0], 'z' => [0, 0, 1] }
      },
      'lengthMm' => 200, 'widthMm' => 500, 'thicknessMm' => thickness,
      'optionRole' => role, 'materialId' => "material-#{role.downcase}-#{thickness}"
    }
  end

  def furniture_instances
    @model.active_entities.instances
  end

  def managed_parts(furniture)
    furniture.definition.entities.instances
  end

  def material_role(part)
    @store.read(part)&.dig('intent', 'materialBindingRole')
  end

  def local_thickness(part)
    part.definition.entities.faces.first.points.map(&:y).max
  end

  def hierarchy_snapshot(furniture)
    managed_parts(furniture).map do |part|
      [part.object_id, part.name, part.definition.object_id, part.transformation.to_a, @store.read(part)]
    end
  end
end
