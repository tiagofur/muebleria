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

  def test_shared_invalid_corpus_fails_closed_at_the_published_ruby_boundary
    corpus = JSON.parse(File.read(CORPUS_PATH))
    assert_equal 1, corpus['schemaVersion']

    corpus['cases'].each do |entry|
      next if entry['boundary'] == 'persisted'

      error = assert_raises(Contract::ContractError, entry['id']) do
        if entry['rawJson']
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
    {
      'name' => 'note', 'label' => 'Note', 'type' => 'string', 'defaultValue' => 'plain',
      'required' => false, 'category' => 'metadata'
    }.merge(overrides)
  end
end
