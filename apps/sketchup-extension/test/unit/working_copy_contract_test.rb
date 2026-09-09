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
        'items' => [item.to_contract_h]
      }

      assert_equal expected, actual, scenario.fetch('id')
    end
  end
end
