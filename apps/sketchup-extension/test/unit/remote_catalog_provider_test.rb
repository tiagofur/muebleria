# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'

class RemoteCatalogProviderTest < Minitest::Test
  class FakeTransport
    attr_accessor :response

    def initialize(response = nil)
      @response = response
    end

    def configured?
      !@response.nil?
    end

    def request(_payload, authorization_header: nil)
      @authorization_header = authorization_header
      @response
    end

    attr_reader :authorization_header
  end

  class FakeAuth
    attr_accessor :refreshed

    def initialize(configured: true)
      @configured = configured
    end

    def configured?
      @configured
    end

    def authorization_header
      'Bearer test'
    end

    def refresh_if_needed
      @refreshed = true
    end
  end

  CONTRACT = {
    'schemaId' => 'granete.pilotFurnitureCatalog.v1',
    'definitions' => {
      'furniture-base-door' => {
        'furnitureDefinitionId' => 'furniture-base-door',
        'code' => 'BASE-600',
        'name' => 'Módulo Base',
        'category' => 'kitchen_base',
        'version' => '1.0.0',
        'description' => 'Módulo inferior.',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
            'defaultValue' => 600, 'min' => 300, 'max' => 1200, 'step' => 50, 'unit' => 'mm',
            'category' => 'dimension' }
        ]
      },
      'furniture-wall-door' => {
        'furnitureDefinitionId' => 'furniture-wall-door',
        'code' => 'WALL-600',
        'name' => 'Módulo Alto',
        'category' => 'kitchen_wall',
        'version' => '1.0.0',
        'parameters' => []
      }
    },
    'presets' => [
      { 'presetId' => 'base-1-door-left', 'name' => 'Base 1 puerta izq.',
        'furnitureDefinitionId' => 'furniture-base-door', 'parameters' => { 'widthMm' => 600 } }
    ]
  }.freeze

  def setup
    SketchupStub.reset!
  end

  def test_serves_remote_definitions_translated_to_internal_shape
    provider = build_provider(status: 200, body: CONTRACT)

    definitions = provider.all_definitions

    assert_equal 'remote', provider.last_source
    refute provider.last_license_blocked
    assert_equal 2, definitions.length
    base = definitions.first
    assert_equal 'furniture-base-door', base['furniture_definition_id']
    assert_equal 'Módulo Base', base['name']
    assert_equal 'kitchen_base', base['category']
    param = base['parameters'].first
    assert_equal 'widthMm', param['name']
    assert_equal 600, param['defaultValue']
    assert_equal 300, param['min']
    assert_equal 'mm', param['unit']
    assert_equal 'furniture-base-door', provider.find_definition('furniture-base-door')['furniture_definition_id']
    assert_equal 1, provider.all_presets.length
  end

  def test_license_blocked_falls_back_and_flags
    provider = build_provider(status: 403, body: { 'error' => 'tu licencia no está activa' })

    definitions = provider.all_definitions

    assert_equal 'local', provider.last_source
    assert provider.last_license_blocked
    assert_equal 4, definitions.length
  end

  def test_remote_failure_falls_back_silently
    provider = build_provider(status: 500, body: { 'error' => 'boom' })

    assert_equal 4, provider.all_definitions.length
    assert_equal 'local', provider.last_source
    refute provider.last_license_blocked
  end

  def test_unconfigured_session_uses_offline_catalog
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new(nil), auth_provider: FakeAuth.new(configured: false)
    )

    assert_equal 4, provider.all_definitions.length
    assert_equal 'local', provider.last_source
  end

  def test_reset_forces_refetch_after_login
    provider = build_provider(status: 200, body: CONTRACT)
    provider.all_definitions

    provider.reset
    assert_equal 'local', provider.last_source

    definitions = provider.all_definitions
    assert_equal 'remote', provider.last_source
    assert_equal 2, definitions.length
  end

  private

  def build_provider(status:, body:)
    transport = FakeTransport.new({ 'status' => status, 'body' => body })
    Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: transport, auth_provider: FakeAuth.new
    )
  end
end
