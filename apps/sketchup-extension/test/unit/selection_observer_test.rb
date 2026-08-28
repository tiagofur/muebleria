# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'
require_relative '../../src/granete_for_sketchup/model/furniture_builder'
require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative '../../src/granete_for_sketchup/observers/selection_observer'

class SelectionObserverTest < Minitest::Test
  def setup
    SketchupStub.reset!
    @model = Sketchup.active_model
    @store = Granete::SketchUpExtension::Metadata::Store.new(@model)
    @provider = Granete::SketchUpExtension::Library::CatalogProvider.new
    @builder = Granete::SketchUpExtension::Model::FurnitureBuilder.new(metadata_store: @store)

    @last_selected_data = nil
    @observer = Granete::SketchUpExtension::Observers::SelectionObserver.new(
      metadata_store: @store,
      catalog_provider: @provider,
      on_selection_change: ->(data) { @last_selected_data = data }
    )
  end

  def test_top_level_click_identifies_the_furniture
    definition = @provider.find_definition('kitchen-base-standard')
    @builder.insert_furniture(@model, definition, { 'widthMm' => 800, 'shelfCount' => 2 })
    furniture = @model.active_entities.instances.first

    @model.selection.add_observer(@observer)
    @model.selection.add(furniture)

    refute_nil @last_selected_data
    assert_equal 'furniture', @last_selected_data['type']
    assert_equal 'kitchen-base-standard', @last_selected_data['definitionId']
    assert_equal 'Gabinete Base Estándar', @last_selected_data['name']
    assert_equal 800, @last_selected_data['parameters']['widthMm']
  end

  def test_drill_down_reaches_the_semantic_child_and_its_owner_furniture
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition, { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    left_panel = furniture.definition.entities.instances.first

    @model.selection.add_observer(@observer)
    # Insert leaves the new furniture selected (placement assist); picking a
    # child component implies replacing that selection, as a viewport click does.
    @model.selection.clear
    @model.selection.add(left_panel)

    refute_nil @last_selected_data
    assert_equal 'component', @last_selected_data['type']
    assert_equal 'left_side', @last_selected_data['role']
    # The owning furniture stays recoverable from the semantic child (#415):
    # drill-down context without losing the managed unit.
    assert_equal result['instance_id'], @last_selected_data['furnitureInstanceId']
  end

  def test_renamed_entities_keep_resolving_semantic_identity
    definition = @provider.find_definition('kitchen-base-standard')
    result = @builder.insert_furniture(@model, definition, { 'widthMm' => 600 })
    furniture = @model.active_entities.instances.first
    left_panel = furniture.definition.entities.instances.first

    # Names are UX labels; rename must not break selection resolution.
    furniture.name = 'Módulo renombrado'
    left_panel.name = 'Costado renombrado'

    @model.selection.add_observer(@observer)
    @model.selection.clear
    @model.selection.add(left_panel)

    assert_equal 'component', @last_selected_data['type']
    assert_equal result['instance_id'], @last_selected_data['furnitureInstanceId']
  end

  def test_clears_selection_when_empty
    @model.selection.add_observer(@observer)
    @model.selection.clear

    assert_nil @last_selected_data
  end
end
