# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_parameter_contract'

class CatalogParameterContractTest < Minitest::Test
  Contract = Granete::SketchUpExtension::Library::CatalogParameterContract
  CORPUS_PATH = File.expand_path('../../../../contracts/furnitureParameterDefinitions.invalid.json', __dir__)
  CROSS_SURFACE_FIXTURE_PATH = File.expand_path(
    '../../../../contracts/furnitureAuthoringCrossSurface.fixture.json', __dir__
  )

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

  # #529 regression (production smoke 2026-10-03): the served catalog now
  # carries optionLabels on enum parameters; the missing key here failed the
  # closed shape and marked the WHOLE catalog unavailable on the plugin.
  def test_accepts_option_labels_string_map_on_enum_parameters
    definition = valid_definition
    definition['parameters'] << {
      'name' => 'doorSwing', 'label' => 'Apertura', 'type' => 'enum',
      'defaultValue' => 'left', 'required' => false, 'category' => 'metadata',
      'options' => %w[left right pair],
      'optionLabels' => { 'left' => 'Izquierda', 'right' => 'Derecha', 'pair' => 'Doble (batiente)' }
    }

    assert_same definition, Contract.validate_definition!(definition, 'definition')
  end

  def test_rejects_malformed_option_labels
    mutations = [
      ['not-a-map', 'must be a string map'],
      [{ 'left' => 5 }, 'must be a string map'],
      [[], 'must be a string map'],
      [nil, 'must be a string map']
    ]

    mutations.each do |labels, message|
      definition = valid_definition
      definition['parameters'] << {
        'name' => 'doorSwing', 'label' => 'Apertura', 'type' => 'enum',
        'defaultValue' => 'left', 'required' => false, 'category' => 'metadata',
        'options' => %w[left right pair], 'optionLabels' => labels
      }
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(definition, 'definition')
      end
      assert_equal 'definition.parameters[1].optionLabels', error.path
      assert_includes error.message, message
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

  # #1044 regression (production 2026-10-03): the perforaciones demo
  # definition publishes structureRelationship bindings; the missing kind
  # here failed the closed shape and marked the WHOLE catalog unavailable on
  # the plugin.
  def test_accepts_structure_relationship_with_station_families_and_faces
    definition = valid_definition
    definition['parameters'] = [structure_relationship_parameter]

    assert_same definition, Contract.validate_definition!(definition, 'definition')
  end

  # #1065 / #874: the Go/TS wire gate publishes station.maxSpacingMm (strictly
  # positive), relationship recipes, and the back-panel kind (face-verified
  # like fixed-shelf-side); the Ruby mirror must accept the same shapes.
  def test_accepts_structure_relationship_with_max_spacing_and_back_panel
    definition = valid_definition
    parameter = structure_relationship_parameter_with(
      'relationship' => {
        'kind' => 'back-panel', 'sourceRole' => 'back-perimeter',
        'targets' => [
          { 'componentId' => 'side-left', 'role' => 'side', 'face' => 'front' },
          { 'componentId' => 'side-right', 'role' => 'side', 'face' => 'back' }
        ],
        'station' => { 'startMarginMm' => 50, 'endMarginMm' => 50, 'maxSpacingMm' => 300 }
      }
    )
    definition['parameters'] = [parameter]

    assert_same definition, Contract.validate_definition!(definition, 'definition')
  end

  def test_accepts_relationship_binding_with_recipes_key
    definition = valid_definition
    parameter = structure_relationship_parameter_with(
      'relationship' => structure_relationship_parameter.fetch('binding').fetch('relationship').merge(
        'recipes' => [{ 'contactId' => 'contact-1', 'recipeId' => 'rec-1', 'recipeRevision' => 'r1' }]
      )
    )
    definition['parameters'] = [parameter]

    assert_same definition, Contract.validate_definition!(definition, 'definition')
  end

  def test_rejects_structure_relationship_mutations_at_go_parity_fields
    valid_relationship = structure_relationship_parameter.fetch('binding').fetch('relationship')
    mutations = [
      [structure_relationship_parameter.tap do |parameter|
         parameter.merge!('type' => 'string', 'maxLength' => 8)
         %w[min max step unit integer].each { |key| parameter.delete(key) }
       end, '.binding.kind'],
      [structure_relationship_parameter('integer' => false, 'unit' => 'mm'), '.binding.kind'],
      [structure_relationship_parameter_with('relationship' => nil), '.binding.relationship'],
      [structure_relationship_parameter_with('dimension' => 'widthMm'), '.binding.dimension'],
      [structure_relationship_parameter_with('componentId' => ''), '.binding.componentId'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('targets' => [{ 'componentId' => 'comp-side', 'role' => 'side' }])
      ), '.targets[0].face'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('targets' => [
                                                     { 'componentId' => 'comp-side', 'role' => 'side',
                                                       'face' => 'front' },
                                                     { 'componentId' => 'comp-side', 'role' => 'opposite',
                                                       'face' => 'back' }
                                                   ])
      ), '.targets'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('sourceFace' => 'diagonal')
      ), '.sourceFace'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('station' => { 'startMarginMm' => -5, 'endMarginMm' => 30 })
      ), '.station.startMarginMm'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('station' => { 'startMarginMm' => 30, 'futureField' => true })
      ), '.station.futureField'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('station' => { 'maxSpacingMm' => 0 })
      ), '.station.maxSpacingMm'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('station' => { 'maxSpacingMm' => -10 })
      ), '.station.maxSpacingMm'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('families' => [{ 'familyId' => 'f1', 'count' => 1 }])
      ), '.families[0].count'],
      [structure_relationship_parameter_with(
        'relationship' => valid_relationship.merge('families' => [
                                                     { 'familyId' => 'f1', 'count' => 2 },
                                                     { 'familyId' => 'f1', 'count' => 3 }
                                                   ])
      ), '.families']
    ]

    mutations.each do |parameter, expected_path|
      definition = valid_definition.merge('parameters' => [parameter])
      error = assert_raises(Contract::ContractError) do
        Contract.validate_definition!(definition, 'definition')
      end
      assert_includes error.path, expected_path,
                      "expected #{expected_path} in #{error.path}"
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

  def structure_relationship_parameter(overrides = {})
    {
      'name' => 'tornillosPiso', 'label' => 'Tornillos por contacto', 'type' => 'number',
      'defaultValue' => 4, 'required' => false, 'unit' => 'count', 'category' => 'hardware',
      'min' => 2, 'max' => 8, 'step' => 1, 'integer' => true,
      'binding' => {
        'version' => 1, 'kind' => 'structureRelationship', 'componentId' => 'comp-shelf',
        'relationship' => {
          'kind' => 'fixed-shelf-side', 'sourceRole' => 'shelf',
          'targets' => [{ 'componentId' => 'comp-side', 'role' => 'side', 'face' => 'front' }],
          'station' => { 'startMarginMm' => 30, 'endMarginMm' => 50 },
          'families' => [{ 'familyId' => 'pilotos', 'count' => 2, 'startMarginMm' => 10 }]
        }
      }
    }.merge(overrides)
  end

  def structure_relationship_parameter_with(binding_overrides)
    parameter = structure_relationship_parameter
    parameter['binding'] = parameter['binding'].merge(binding_overrides)
    parameter
  end

  # #497 T8 — the extension's catalog contract accepts the EXACT published
  # definition the Go chain served (golden fixture): the downloaded catalog a
  # real workshop edit produced passes the SketchUp-side gate with no
  # transformation, including the projected dimensions, both behavioral
  # bindings and the explicit false / empty-string defaults.
  def test_accepts_cross_surface_golden_published_definition
    fixture = JSON.parse(File.read(CROSS_SURFACE_FIXTURE_PATH))
    published = fixture.fetch('expected').fetch('publishedParameters')
    definition = {
      'furnitureDefinitionId' => fixture.fetch('moduleWrite').fetch('id'),
      'schemaRevision' => 1,
      'definitionHash' => fixture.fetch('expected').fetch('definitionHash'),
      'parameters' => published
    }

    assert_same definition, Contract.validate_definition!(definition, 'definition')

    names = published.map { |parameter| parameter.fetch('name') }
    assert_includes names, 'widthMm'
    assert_includes names, 'softClose'
    soft_close = published.find { |parameter| parameter['name'] == 'softClose' }
    assert_equal false, soft_close.fetch('defaultValue')
    client_note = published.find { |parameter| parameter['name'] == 'clientNote' }
    assert_equal '', client_note.fetch('defaultValue')
    shelf = published.find { |parameter| parameter['name'] == 'shelfCount' }
    assert_equal 'componentQuantity', shelf.fetch('binding').fetch('kind')
  end
end
