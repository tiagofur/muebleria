# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../support/catalog_provider_contract'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'

# Contract parity between the offline catalog (development/tests) and the
# remote workshop catalog (production): the dialog and the builder must not
# care which provider is wired.
class StaticCatalogProviderContractTest < Minitest::Test
  include CatalogProviderContract

  def setup
    SketchupStub.reset!
  end

  private

  def provider_under_test
    Granete::SketchUpExtension::Library::StaticCatalogProvider.new
  end
end

class RemoteCatalogProviderContractTest < Minitest::Test
  include CatalogProviderContract

  class FakeTransport
    def initialize(response)
      @response = response
    end

    def configured?
      true
    end

    def request(*)
      @response
    end
  end

  class FakeAuth
    def configured?
      true
    end

    def authorization_header
      'Bearer test'
    end
  end

  CONTRACT = {
    'definitions' => {
      '11111111-1111-1111-1111-111111111111' => {
        'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
        'code' => 'BASE-600',
        'name' => 'Módulo Base',
        'category' => 'inferior',
        'version' => '1.0.0',
        'schemaRevision' => 1,
        'definitionHash' => "sha256-#{'1' * 64}",
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
            'defaultValue' => 600, 'min' => 450, 'max' => 900, 'step' => 10, 'unit' => 'mm',
            'category' => 'dimension', 'required' => true, 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'widthMm' } }
        ]
      }
    },
    'presets' => [
      { 'presetId' => 'preset-a', 'name' => 'Base estándar',
        'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
        'parameters' => { 'widthMm' => 600 } }
    ]
  }.freeze

  def setup
    SketchupStub.reset!
  end

  private

  def provider_under_test
    Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 200, 'body' => CONTRACT }),
      auth_provider: FakeAuth.new
    )
  end
end
