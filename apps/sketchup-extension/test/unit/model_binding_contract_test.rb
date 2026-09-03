# frozen_string_literal: true

require 'json'
require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/logging'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/connection/model_binding'

# #388 — shared model binding contract fixture, Ruby parsing side.
#
# The fixture (contracts/sketchupModelBinding.contract.json) is generated
# from the Go handler's own HTTP responses (golden author), so these tests
# exercise the exact wire shape the server serves. Ruby is a consumer: it
# parses every 200 response fail-closed and pins the error rule — a non-200
# response must never write binding metadata.
class ModelBindingContractTest < Minitest::Test
  GOLDEN_PATH = File.expand_path('../../../../contracts/sketchupModelBinding.contract.json', __dir__)

  def fixture
    @fixture ||= JSON.parse(File.read(GOLDEN_PATH))
  end

  def mb
    Granete::SketchUpExtension::Connection::ModelBinding
  end

  def scenario(id)
    fixture['scenarios'].find { |s| s['id'] == id } || raise("missing scenario #{id} in golden")
  end

  def test_fixture_pins_the_canonical_contract_identity
    assert_equal 'POST /api/projects/{projectId}/designs/{designId}/binding:validate', fixture['endpoint']
    assert_equal 'com.granete.project', fixture['modelDictionary']
    assert_equal 'granete.project-binding.v1', fixture['bindingKey']
    assert_equal mb::SCHEMA_VERSION, fixture['serverSchemaVersion']
  end

  def test_parses_every_200_scenario_fail_closed
    fixture['scenarios'].each do |raw|
      next unless raw['responseStatus'] == 200

      validation = mb::Contract.parse!(raw['response'])
      assert_includes mb::Contract::STATES, validation.state
    end
  end

  def test_valid_scenarios_carry_the_authoritative_working_context
    first = mb::Contract.parse!(scenario('01-first-bind-valid')['response'])
    assert_equal 'valid', first.state
    assert first.capabilities['can_edit_working_copy']
    refute_nil first.working_copy['base_revision_id']
    assert_equal 2, first.working_copy['base_revision_number']

    none = mb::Contract.parse!(scenario('05-no-published-revision')['response'])
    assert_equal 'valid', none.state
    assert_nil none.working_copy['base_revision_id']
    assert_nil none.working_copy['base_revision_number']
  end

  def test_archived_scenario_is_a_distinct_state
    archived = mb::Contract.parse!(scenario('03-design-archived')['response'])
    assert_equal 'design_archived', archived.state
    refute archived.capabilities['can_edit_working_copy']
    refute archived.capabilities['can_publish_revision']
  end

  def test_non_200_answers_never_write_binding_metadata
    error = scenario('04-foreign-design-uniform-404')
    refute_equal 200, error['responseStatus']
    # Uniform ApiError envelope — the client must treat it as not_found,
    # never parse a partial context out of it.
    assert_raises(ArgumentError) { mb::Contract.parse!(error['response']) }
    payload = error['response']
    assert_equal 'NOT_FOUND', payload['code']
  end
end
