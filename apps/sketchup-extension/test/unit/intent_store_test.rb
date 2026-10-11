# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/project_furniture'

# #1272 — the pending create-and-place intent is the SAME authority the
# working-copy merger builds new items from (the position sync can run ahead
# of confirm): it must carry the placement's definition, never a partial
# entry that materializes a NULL-definition item.
class IntentStoreTest < Minitest::Test
  PF = Granete::SketchUpExtension::Connection::ProjectFurniture

  def test_store_carries_definition_and_version
    store = PF::IntentStore.new
    store.store('fi-1', parameters: { 'widthMm' => 600 },
                        material_choices: { 'FRENTES' => 'mat-1' },
                        furniture_definition_id: 'def-1', definition_version: 4)

    entry = store.fetch('fi-1')
    assert_equal({ 'parameters' => { 'widthMm' => 600 },
                   'material_choices' => { 'FRENTES' => 'mat-1' },
                   'furnitureDefinitionId' => 'def-1',
                   'definitionVersion' => 4 }, entry)
  end

  def test_store_omits_absent_definition_keys
    store = PF::IntentStore.new
    store.store('fi-1', parameters: {}, material_choices: {})

    entry = store.fetch('fi-1')
    refute entry.key?('furnitureDefinitionId')
    refute entry.key?('definitionVersion')
  end

  def test_store_ignores_blank_definition_ids
    store = PF::IntentStore.new
    store.store('fi-1', parameters: {}, material_choices: {},
                        furniture_definition_id: '   ', definition_version: nil)

    entry = store.fetch('fi-1')
    refute entry.key?('furnitureDefinitionId')
    refute entry.key?('definitionVersion')
  end
end
