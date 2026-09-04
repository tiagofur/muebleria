# frozen_string_literal: true

require 'stringio'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../support/host_runtime'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'

# #498 selection restoration: after a rebuild the selection is re-resolved
# through Granete semantic identity (furnitureInstanceId / instanceRef, then
# componentInstanceId or hardwarePlacementId from namespaced metadata) —
# never through persistent_id, entityID, name or geometry.
class HostSelectionRestoreTest < Minitest::Test
  HOST = Granete::SketchUpExtension::Host

  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @restore = HOST::SelectionRestore.new(
      metadata_store_factory: ->(_model) { @store },
      model_provider: -> { @model },
      logger: Granete::SketchUpExtension::SafeLogger.new(sink: StringIO.new)
    )
  end

  def furniture_with_children(instance_ref, server_id: nil)
    definition = @model.definitions.add("Granete · Mueble · #{instance_ref}")
    furniture = @model.active_entities.add_instance(definition, Geom::Transformation.identity)
    identity = server_id ? { server: true, project_id: nil, design_id: nil } : nil
    Granete::SketchUpExtension::Model::MetadataWriter.write_furniture(
      @store, furniture, instance_ref, { 'furniture_definition_id' => 'def-1' }, {}, identity: identity
    )

    shelf_definition = @model.definitions.add('Granete · Parte · Entrepaño · shelf-01')
    shelf = definition.entities.add_instance(shelf_definition, Geom::Transformation.identity)
    Granete::SketchUpExtension::Model::ChildMetadataWriter.write_part(
      @store, shelf, 'shelf-01', 'shelf_1', furniture_ref: instance_ref
    )

    hinge_definition = @model.definitions.add('Granete · Herraje · Bisagra · hp-hinge-01')
    hinge = definition.entities.add_instance(hinge_definition, Geom::Transformation.identity)
    Granete::SketchUpExtension::Model::ChildMetadataWriter.write_hardware(
      @store, hinge, 'hp-hinge-01', furniture_ref: instance_ref
    )
    furniture
  end

  def test_restores_the_furniture_root_by_local_ref
    furniture = furniture_with_children('inst-a')
    selected = @restore.restore('furnitureInstanceRef' => 'inst-a')
    assert_same furniture, selected
    assert_equal [furniture], @model.selection.items
  end

  def test_restores_the_furniture_root_by_server_identity
    furniture = furniture_with_children('fi-server-9', server_id: true)
    selected = @restore.restore('furnitureInstanceId' => 'fi-server-9')
    assert_same furniture, selected
  end

  def test_restores_a_child_part_by_component_instance_id_not_by_name
    furniture = furniture_with_children('inst-b')
    selected = @restore.restore('furnitureInstanceRef' => 'inst-b', 'componentInstanceId' => 'shelf-01')
    refute_same furniture, selected
    assert_equal 'Granete · Parte · Entrepaño · shelf-01', selected.definition.name
    assert_equal [selected], @model.selection.items
  end

  def test_restores_a_hardware_occurrence_by_hardware_placement_id
    furniture_with_children('inst-c')
    selected = @restore.restore('furnitureInstanceRef' => 'inst-c', 'hardwarePlacementId' => 'hp-hinge-01')
    refute_nil selected
    assert_equal 'Granete · Herraje · Bisagra · hp-hinge-01', selected.definition.name
  end

  def test_falls_back_to_the_owning_furniture_when_the_child_is_gone
    furniture = furniture_with_children('inst-d')
    furniture.definition.entities.clear!
    selected = @restore.restore('furnitureInstanceRef' => 'inst-d', 'componentInstanceId' => 'shelf-01')
    assert_same furniture, selected
  end

  def test_unknown_target_returns_nil_without_touching_selection
    @model.selection.clear
    selected = @restore.restore('furnitureInstanceRef' => 'missing')
    assert_nil selected
    assert_empty @model.selection.items
  end

  def test_unmanaged_root_metadata_is_never_selected_as_furniture
    plain = @model.active_entities.add_instance(
      @model.definitions.add('Plain'), Geom::Transformation.identity
    )
    assert_nil @restore.restore('furnitureInstanceRef' => 'whatever')
    refute_includes @model.selection.items, plain
  end
end
