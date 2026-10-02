# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/transform_contract'
require_relative '../../src/granete_for_sketchup/connection/project_furniture_contract'

class WorkingCopyContractTest < Minitest::Test
  FIXTURE_PATH = File.expand_path('../../../../contracts/sketchupWorkingCopyUpdate.contract.json', __dir__)
  PF = Granete::SketchUpExtension::Connection::ProjectFurniture
  Entity = Struct.new(:transformation)

  def test_ruby_payload_matches_shared_generated_contract_boundary
    fixture = JSON.parse(File.read(FIXTURE_PATH))
    entity = Entity.new(Geom::Transformation.new)
    locator = { 'kind' => 'sketchup_persistent_id', 'value' => '4242' }

    fixture.fetch('scenarios').each do |scenario|
      expected = scenario.fetch('request')
      expected_item = expected.fetch('items').first
      item = PF::WorkingCopyMerger.new_working_item(
        expected_item.fetch('furniture_instance_id'), entity, scenario.fetch('intent'), locator
      )
      actual = {
        'base_revision_id' => expected.fetch('base_revision_id'),
        'expected_working_version' => expected.fetch('expected_working_version'),
        'items' => [item.to_contract_h]
      }
      # #784 R2/R3: the caller-side merge may carry the durable Design
      # defaults — the boundary echoes them verbatim when present.
      actual['authoring_defaults'] = expected['authoring_defaults'] if expected.key?('authoring_defaults')

      assert_equal expected, actual, scenario.fetch('id')
    end
  end

  def test_working_item_material_choice_modes_enforces_full_key_parity_with_material_choices
    item = PF::Contract::WorkingItem.new(
      furniture_instance_id: 'fi-1',
      material_choices: { 'INTERIOR' => 'mat-1', 'FRENTES' => 'mat-2' },
      material_choice_modes: { 'INTERIOR' => 'design' }
    )
    contract_h = item.to_contract_h
    assert_equal({ 'INTERIOR' => 'design', 'FRENTES' => 'override' }, contract_h['material_choice_modes'])

    # Absent or empty modes do not emit the key: the backend preserves
    # the persisted lineage when the statement is absent entirely.
    item.material_choice_modes = nil
    refute item.to_contract_h.key?('material_choice_modes')

    item.material_choice_modes = {}
    refute item.to_contract_h.key?('material_choice_modes')

    # Obsolete roles in modes not in material_choices are pruned
    item.material_choice_modes = { 'INTERIOR' => 'override', 'DELETED_ROLE' => 'design' }
    assert_equal({ 'INTERIOR' => 'override', 'FRENTES' => 'override' }, item.to_contract_h['material_choice_modes'])
  end
end
