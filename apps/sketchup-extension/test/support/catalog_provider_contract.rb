# frozen_string_literal: true

# Shared contract for catalog providers: anything served to the dialog and
# the builder must expose all_definitions/find_definition/all_presets and
# return the internal definition shape (snake_case keys, camelCase parameter
# fields). Both StaticCatalogProvider (development/tests) and
# RemoteCatalogProvider (production) are held to it.
module CatalogProviderContract
  def test_responds_to_the_base_catalog_contract
    provider = provider_under_test

    %w[all_definitions find_definition all_presets].each do |message|
      assert_respond_to provider, message, "#{provider.class} must implement ##{message}"
    end
  end

  def test_definitions_use_the_internal_contract_shape
    definitions = provider_under_test.all_definitions

    refute_nil definitions
    ids = definitions.map { |d| d['furniture_definition_id'] }
    assert_equal ids.uniq.length, ids.length, 'definition ids must be unique'

    definitions.each do |definition|
      %w[furniture_definition_id code name category version parameters].each do |key|
        assert_includes definition, key, "definition missing #{key}: #{definition.inspect}"
        refute_nil definition[key], "definition #{key} must not be nil"
      end

      definition['parameters'].each do |param|
        %w[name label type defaultValue].each do |key|
          assert_includes param, key, "parameter missing #{key}: #{param.inspect}"
          refute_nil param[key], "parameter #{key} must not be nil"
        end
      end
    end
  end

  def test_find_definition_round_trips_by_id
    provider = provider_under_test
    definitions = provider.all_definitions

    definitions.each do |definition|
      found = provider.find_definition(definition['furniture_definition_id'])
      assert_equal definition, found
    end

    assert_nil provider.find_definition('does-not-exist')
  end

  def test_presets_reference_known_definitions
    provider = provider_under_test
    ids = provider.all_definitions.map { |d| d['furniture_definition_id'] }

    provider.all_presets.each do |preset|
      assert_includes ids, preset['furnitureDefinitionId'],
                      "preset #{preset['presetId']} references an unknown definition"
    end
  end
end
