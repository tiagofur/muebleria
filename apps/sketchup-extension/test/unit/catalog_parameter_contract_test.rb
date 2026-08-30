# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_parameter_contract'

class CatalogParameterContractTest < Minitest::Test
  Contract = Granete::SketchUpExtension::Library::CatalogParameterContract
  CORPUS_PATH = File.expand_path('../../../../contracts/furnitureParameterDefinitions.invalid.json', __dir__)

  def test_accepts_typed_parameters_and_reserved_dimensions
    definition = valid_definition
    definition['parameters'] << {
      'name' => 'style', 'label' => 'Style', 'type' => 'enum',
      'defaultValue' => 'plain', 'required' => false, 'category' => 'metadata',
      'options' => %w[plain framed]
    }

    assert_same definition, Contract.validate_definition!(definition, 'definition')
  end

  def test_rejects_unknown_type_duplicate_bad_enum_default_and_reserved_dimension
    invalid_parameters = [
      [valid_parameter.merge('type' => 'object'), '.type'],
      [metadata_parameter('type' => 'enum', 'options' => %w[plain framed], 'defaultValue' => 'other'),
       '.defaultValue'],
      [metadata_parameter('type' => 'string', 'defaultValue' => 600), '.defaultValue'],
      [metadata_parameter('name' => 'widthMm', 'type' => 'string', 'defaultValue' => '600'),
       'parameters[0]']
    ]

    invalid_parameters.each do |parameter, expected_path|
      definition = valid_definition.merge('parameters' => [parameter])
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(definition, 'definition')
      end
      assert_equal Contract::ERROR_CODE, error.code
      assert_includes error.path, expected_path
    end

    duplicate = valid_definition
    duplicate['parameters'] << valid_parameter
    error = assert_raises(Contract::ContractError) do
      Contract.validate_definition!(duplicate, 'definition')
    end
    assert_equal 'definition.parameters[1].name', error.path
  end

  def test_rejects_missing_or_malformed_definition_hash
    [nil, '', 'sha256-not-a-digest'].each do |hash|
      definition = valid_definition.merge('definitionHash' => hash)
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(definition, 'definition')
      end
      assert_equal 'definition.definitionHash', error.path
    end
  end

  def test_rejects_parameter_and_option_size_limits
    too_many = valid_definition.merge(
      'parameters' => 65.times.map do |index|
        valid_parameter.merge('name' => "p#{index}", 'category' => 'configuration', 'unit' => nil,
                              'required' => false, 'integer' => false)
      end
    )
    error = assert_raises(Contract::ContractError) do
      Contract.validate_definition!(too_many, 'definition')
    end
    assert_equal 'definition.parameters', error.path

    enum = {
      'name' => 'style', 'label' => 'Style', 'type' => 'enum', 'defaultValue' => 'v0',
      'required' => false, 'category' => 'style', 'options' => 65.times.map { |index| "v#{index}" }
    }
    error = assert_raises(Contract::ContractError) do
      Contract.validate_definition!(valid_definition.merge('parameters' => [enum]), 'definition')
    end
    assert_equal 'definition.parameters[0].options', error.path
  end

  def test_closed_shapes_reject_unknown_definition_parameter_and_binding_fields
    mutations = [
      [valid_definition.merge('futureField' => true), 'definition.futureField'],
      [valid_definition.merge('parameters' => [valid_parameter.merge('defautValue' => 600)]),
       'definition.parameters[0].defautValue'],
      [valid_definition.merge('parameters' => [valid_parameter.merge(
        'binding' => valid_parameter['binding'].merge('futureField' => true)
      )]), 'definition.parameters[0].binding.futureField']
    ]

    mutations.each do |definition, expected_path|
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(definition, 'definition')
      end
      assert_equal expected_path, error.path
    end
  end

  def test_closed_relationship_shapes_and_component_condition_parity
    relationship = {
      'kind' => 'shelfSupport', 'sourceRole' => 'shelf',
      'targets' => [{ 'componentId' => 'side-1', 'role' => 'left' }]
    }
    quantity = {
      'name' => 'shelfCount', 'label' => 'Shelves', 'type' => 'number', 'defaultValue' => 1,
      'required' => true, 'unit' => 'count', 'category' => 'configuration', 'min' => 0,
      'max' => 8, 'step' => 1, 'integer' => true,
      'binding' => { 'version' => 1, 'kind' => 'componentQuantity', 'componentId' => 'shelf-1',
                     'relationship' => relationship }
    }
    condition = {
      'name' => 'hasBackPanel', 'label' => 'Back panel', 'type' => 'boolean', 'defaultValue' => false,
      'required' => true, 'category' => 'configuration',
      'binding' => { 'version' => 1, 'kind' => 'componentCondition', 'componentId' => 'back-1' }
    }
    definition = valid_definition.merge('parameters' => [quantity, condition])
    assert_same definition, Contract.validate_definition!(definition, 'definition')

    relationship['futureField'] = true
    error = assert_raises(Contract::ContractError) { Contract.validate_definition!(definition, 'definition') }
    assert_equal 'definition.parameters[0].binding.relationship.futureField', error.path
    relationship.delete('futureField')
    relationship['targets'][0]['futureField'] = true
    error = assert_raises(Contract::ContractError) { Contract.validate_definition!(definition, 'definition') }
    assert_equal 'definition.parameters[0].binding.relationship.targets[0].futureField', error.path
  end

  def test_string_max_length_is_required_bounded_and_applies_to_defaults
    definition = valid_definition.merge('parameters' => [metadata_parameter])
    assert_same definition, Contract.validate_definition!(definition, 'definition')

    [nil, 0, 513, 2.5].each do |max_length|
      parameter = metadata_parameter('maxLength' => max_length)
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(valid_definition.merge('parameters' => [parameter]), 'definition')
      end
      assert_equal 'definition.parameters[0].maxLength', error.path
    end

    too_long = metadata_parameter('maxLength' => 4, 'defaultValue' => 'abcde')
    error = assert_raises(Contract::ContractError) do
      Contract.validate_definition!(valid_definition.merge('parameters' => [too_long]), 'definition')
    end
    assert_equal 'definition.parameters[0].defaultValue', error.path
  end

  def test_shared_invalid_corpus_fails_closed_at_the_published_ruby_boundary
    corpus = JSON.parse(File.read(CORPUS_PATH))
    assert_equal 1, corpus['schemaVersion']

    corpus['cases'].each do |entry|
      next if entry['boundary'] == 'persisted'

      error = assert_raises(Contract::ContractError, entry['id']) do
        if entry['rawDefinitionJson']
          Contract.validate_definition!(JSON.parse(entry['rawDefinitionJson']), 'definitions')
        elsif entry['rawJson']
          Contract.parse_parameter_definitions!(entry['rawJson'])
        else
          Contract.validate_parameter_definitions!(entry['definitions'])
        end
      end
      assert_equal entry['expectedCode'], error.code, entry['id']
      assert entry['expectedFields'].any? { |field| error.path.include?(field) },
             "#{entry['id']} failed at unexpected field #{error.path}"
    end
  end

  private

  def valid_definition
    {
      'furnitureDefinitionId' => 'module-1',
      'schemaRevision' => 1,
      'definitionHash' => "sha256-#{'a' * 64}",
      'parameters' => [valid_parameter]
    }
  end

  def valid_parameter
    {
      'name' => 'widthMm', 'label' => 'Width', 'type' => 'number', 'defaultValue' => 600,
      'required' => true, 'unit' => 'mm', 'category' => 'dimension', 'min' => 300,
      'max' => 1200, 'step' => 10, 'integer' => true,
      'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'widthMm' }
    }
  end

  def metadata_parameter(overrides = {})
    parameter = {
      'name' => 'note', 'label' => 'Note', 'type' => 'string', 'defaultValue' => 'plain',
      'required' => false, 'category' => 'metadata', 'maxLength' => 128
    }.merge(overrides)
    parameter.delete('maxLength') if overrides.key?('type') && overrides['type'] != 'string' &&
                                     !overrides.key?('maxLength')
    parameter
  end
end
