# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/auth/provider'
require_relative '../../src/granete_for_sketchup/transport/adapter'
require_relative '../../src/granete_for_sketchup/transport/http_adapter'
require_relative '../../src/granete_for_sketchup/library/catalog_parameter_contract'
require_relative '../../src/granete_for_sketchup/library/catalog_provider'

class RemoteCatalogProviderTest < Minitest::Test
  class FakeTransport
    attr_accessor :response
    attr_reader :authorization_header, :last_payload, :requests

    def initialize(response = nil, error: nil)
      @response = response
      @error = error
      @requests = 0
    end

    def configured?
      !@response.nil? || !@error.nil?
    end

    def request(payload, authorization_header: nil)
      @requests += 1
      @last_payload = payload
      @authorization_header = authorization_header
      raise @error if @error

      @response
    end
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
      'Bearer test-session-token'
    end

    def refresh_if_needed
      @refreshed = true
    end
  end

  class FakeLogger
    attr_reader :entries

    def initialize
      @entries = []
    end

    def info(event, details = {})
      @entries << [event, details]
    end
  end

  CONTRACT = {
    'schemaId' => 'granete.workshopFurnitureCatalog.v1',
    'definitions' => {
      '11111111-1111-1111-1111-111111111111' => {
        'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
        'code' => 'BASE-600',
        'name' => 'Módulo Base',
        'category' => 'inferior',
        'version' => '1.0.0',
        'schemaRevision' => 1,
        'definitionHash' => "sha256-#{'1' * 64}",
        'description' => 'Módulo inferior.',
        'parameters' => [
          { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
            'defaultValue' => 600, 'min' => 450, 'max' => 900, 'step' => 10, 'unit' => 'mm',
            'category' => 'dimension', 'required' => true, 'integer' => true,
            'binding' => { 'version' => 1, 'kind' => 'dimensionColumn', 'dimension' => 'widthMm' } },
          { 'name' => 'hasBackPanel', 'label' => 'Respaldo', 'type' => 'boolean',
            'defaultValue' => true, 'category' => 'configuration', 'required' => true,
            'binding' => { 'version' => 1, 'kind' => 'componentCondition', 'componentId' => 'comp-back' } },
          { 'name' => 'customerNote', 'label' => 'Nota', 'type' => 'string',
            'defaultValue' => '', 'category' => 'metadata', 'required' => false, 'maxLength' => 80 }
        ]
      },
      '22222222-2222-2222-2222-222222222222' => {
        'furnitureDefinitionId' => '22222222-2222-2222-2222-222222222222',
        'code' => 'WALL-600',
        'name' => 'Módulo Alto',
        'category' => 'superior',
        'version' => '1.0.0',
        'schemaRevision' => 1,
        'definitionHash' => "sha256-#{'2' * 64}",
        'parameters' => []
      }
    },
    'presets' => [
      { 'presetId' => 'preset-a', 'name' => 'Base 1 puerta izq.',
        'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111', 'parameters' => { 'widthMm' => 600 } }
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
    assert_equal '11111111-1111-1111-1111-111111111111', base['furniture_definition_id']
    assert_equal 'Módulo Base', base['name']
    assert_equal 'inferior', base['category']
    assert_equal 1, base['schemaRevision']
    assert_equal "sha256-#{'1' * 64}", base['definitionHash']
    param = base['parameters'].first
    assert_equal 'widthMm', param['name']
    assert_equal 600, param['defaultValue']
    assert_equal 450, param['min']
    assert_equal 'mm', param['unit']
    assert_equal true, param['required']
    assert_equal true, param['integer']
    assert_equal 'dimension', param['category']
    assert_equal 'dimensionColumn', param.dig('binding', 'kind')
    assert_equal 'componentCondition', base['parameters'][1].dig('binding', 'kind')
    assert_equal 'comp-back', base['parameters'][1].dig('binding', 'componentId')
    assert_equal '', base['parameters'][2]['defaultValue']
    assert_equal 80, base['parameters'][2]['maxLength']
    assert_equal '11111111-1111-1111-1111-111111111111',
                 provider.find_definition('11111111-1111-1111-1111-111111111111')['furniture_definition_id']
    assert_equal 1, provider.all_presets.length
  end

  def test_fetches_workshop_catalog_with_session_authorization
    transport = FakeTransport.new({ 'status' => 200, 'body' => CONTRACT })
    provider = build_provider(transport: transport)

    provider.all_definitions

    assert_equal 1, transport.requests
    assert_equal 'GET', transport.last_payload['method']
    assert_equal '/furniture/definitions', transport.last_payload['path']
    # Workshop scoping is enforced server-side; the provider must forward the
    # authenticated session on every catalog read.
    assert_equal 'Bearer test-session-token', transport.authorization_header
  end

  def test_workshop_without_furniture_is_an_empty_remote_catalog
    provider = build_provider(status: 200, body: { 'definitions' => {}, 'presets' => [] })

    assert_equal [], provider.all_definitions
    assert_equal [], provider.all_presets
    assert_equal 'remote', provider.last_source
  end

  def test_invalid_parameter_definition_retires_the_remote_catalog_with_structured_diagnostic
    invalid = JSON.parse(JSON.generate(CONTRACT))
    invalid['definitions'].values.first['definitionHash'] = ''
    logger = FakeLogger.new
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 200, 'body' => invalid }),
      auth_provider: FakeAuth.new,
      logger: logger
    )

    assert_equal [], provider.all_definitions
    assert_equal 'error', provider.last_source
    event, details = logger.entries.last
    assert_equal 'catalog_parameter_definition_invalid', event
    assert_equal 'PARAMETER_DEFINITION_INVALID', details[:code]
    assert_match(/definitionHash\z/, details[:path])
  end

  def test_license_blocked_returns_empty_catalog_and_flags
    provider = build_provider(status: 403, body: { 'error' => 'tu licencia no está activa' })

    definitions = provider.all_definitions

    assert_equal [], definitions
    assert_equal 'license_blocked', provider.last_source
    assert provider.last_license_blocked
  end

  def test_remote_error_returns_empty_catalog_without_local_fallback
    provider = build_provider(status: 500, body: { 'error' => 'boom' })

    assert_equal [], provider.all_definitions
    assert_equal [], provider.all_presets
    assert_equal 'error', provider.last_source
    refute provider.last_license_blocked
  end

  def test_invalid_session_returns_empty_catalog
    provider = build_provider(status: 401, body: { 'error' => 'invalid token' })

    assert_equal [], provider.all_definitions
    assert_equal 'unauthenticated', provider.last_source
  end

  def test_transport_failure_returns_empty_catalog
    transport = FakeTransport.new(nil, error: Granete::SketchUpExtension::Transport::RequestError.new('down'))
    provider = build_provider(transport: transport)

    assert_equal [], provider.all_definitions
    assert_equal 'error', provider.last_source
  end

  def test_unconfigured_session_returns_empty_catalog
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new(nil), auth_provider: FakeAuth.new(configured: false)
    )

    assert_equal [], provider.all_definitions
    assert_equal 'unauthenticated', provider.last_source
  end

  def test_explicit_fallback_provider_is_served_when_remote_fails
    static = Granete::SketchUpExtension::Library::StaticCatalogProvider.new
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 500, 'body' => {} }),
      auth_provider: FakeAuth.new, fallback_provider: static
    )

    definitions = provider.all_definitions

    assert_equal 'local', provider.last_source
    assert_equal static.all_definitions.length, definitions.length
  end

  def test_reset_forces_refetch_after_login
    provider = build_provider(status: 200, body: CONTRACT)
    provider.all_definitions

    provider.reset
    assert_equal 'unauthenticated', provider.last_source

    definitions = provider.all_definitions
    assert_equal 'remote', provider.last_source
    assert_equal 2, definitions.length
  end

  LAYOUT = {
    'furnitureDefinitionId' => '11111111-1111-1111-1111-111111111111',
    'definitionName' => 'Módulo Base',
    'dimensionsMm' => [600, 720, 560],
    'components' => [
      { 'componentInstanceId' => 'st-side-l', 'slotId' => 'lateral_izquierdo', 'name' => 'Lateral',
        'kind' => 'board', 'transform' => { 'translationMm' => [0, 0, 0] }, 'dimensionsMm' => [18, 560, 684] },
      { 'componentInstanceId' => 'mod-door', 'slotId' => 'puerta', 'name' => 'Puerta',
        'kind' => 'board', 'transform' => { 'translationMm' => [2, 560, 2] }, 'dimensionsMm' => [596, 18, 716] }
    ],
    'hardware' => [
      { 'placementId' => 'mod-door-hw-0', 'hardwareId' => 'hw-handle', 'name' => 'Manija 160',
        'shape' => 'bar-pull', 'transform' => { 'translationMm' => [542, 578, 282] }, 'dimensionsMm' => [32, 25, 160] }
    ]
  }.freeze

  def test_resolved_layout_fetches_the_server_resolution_with_parameters
    transport = FakeTransport.new({ 'status' => 200, 'body' => LAYOUT })
    provider = build_provider(transport: transport)

    layout = provider.resolved_layout('11111111-1111-1111-1111-111111111111',
                                      'widthMm' => 900, 'heightMm' => 720, 'doorSwing' => 'left')

    assert_equal LAYOUT, layout
    assert_equal 'GET', transport.last_payload['method']
    assert_equal '/furniture/definitions/11111111-1111-1111-1111-111111111111/layout?widthMm=900&heightMm=720',
                 transport.last_payload['path']
    assert_equal 'Bearer test-session-token', transport.authorization_header
  end

  def test_resolved_layout_sends_board_choices_as_query_params
    transport = FakeTransport.new({ 'status' => 200, 'body' => LAYOUT })
    provider = build_provider(transport: transport)

    provider.resolved_layout('abc', { 'widthMm' => 600 },
                             'FRENTE' => 'mat-oak', 'LATERAL' => 'mat-white')

    assert_equal '/furniture/definitions/abc/layout?widthMm=600&choice.FRENTE=mat-oak&choice.LATERAL=mat-white',
                 transport.last_payload['path']
  end

  def test_resolved_layout_without_dimension_parameters_hits_the_bare_path
    transport = FakeTransport.new({ 'status' => 200, 'body' => LAYOUT })
    provider = build_provider(transport: transport)

    provider.resolved_layout('abc', {})

    assert_equal '/furniture/definitions/abc/layout', transport.last_payload['path']
  end

  def test_resolved_layout_raises_on_remote_failures
    [401, 403, 422, 500].each do |status|
      provider = build_provider(status: status, body: { 'error' => 'boom' })
      assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError,
                    "status #{status} must raise LayoutResolutionError") do
        provider.resolved_layout('abc', {})
      end
    end

    transport = FakeTransport.new(nil, error: Granete::SketchUpExtension::Transport::RequestError.new('down'))
    provider = build_provider(transport: transport)
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      provider.resolved_layout('abc', {})
    end
  end

  def test_resolved_layout_rejects_bodies_without_components
    provider = build_provider(status: 200, body: { 'error' => 'unexpected' })
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      provider.resolved_layout('abc', {})
    end
  end

  def test_resolved_layout_never_falls_back_to_a_local_guess
    static = Granete::SketchUpExtension::Library::StaticCatalogProvider.new
    provider = Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: FakeTransport.new({ 'status' => 500, 'body' => {} }),
      auth_provider: FakeAuth.new, fallback_provider: static
    )

    # Granete owns resolution truth: a failed resolution raises LayoutResolutionError,
    # never a locally composed layout.
    assert_raises(Granete::SketchUpExtension::Library::LayoutResolutionError) do
      provider.resolved_layout('kitchen-base-standard', {})
    end
  end

  def test_static_providers_do_not_resolve_layouts
    assert_nil Granete::SketchUpExtension::Library::StaticCatalogProvider.new.resolved_layout('x', {})
  end

  def test_definitions_carry_estimated_composition_counts
    contract = JSON.parse(JSON.generate(CONTRACT))
    contract['definitions']['11111111-1111-1111-1111-111111111111']['estimatedPartCount'] = 9
    contract['definitions']['11111111-1111-1111-1111-111111111111']['estimatedHardwareCount'] = 2
    contract['definitions']['11111111-1111-1111-1111-111111111111']['materialRoles'] = [
      { 'role' => 'FRENTE', 'label' => 'Frente / Puertas', 'optionIds' => %w[mat-oak] }
    ]
    contract['materials'] = [
      { 'materialId' => 'mat-oak', 'code' => 'ROBLE-CLARO', 'name' => 'Roble Claro',
        'manufacturer' => 'Arauco', 'categoryId' => 'cat-light',
        'previewColor' => '#c4a574', 'previewTextureUrl' => '/api/media/oak_pbr.jpg',
        'previewTextureTileWidthMm' => 600.0, 'previewRoughness' => 0.65,
        'thicknessMm' => 18, 'grain' => true }
    ]
    provider = build_provider(status: 200, body: contract)

    base = provider.find_definition('11111111-1111-1111-1111-111111111111')

    assert_equal 9, base['estimatedPartCount']
    assert_equal 2, base['estimatedHardwareCount']
    assert_equal [{ 'role' => 'FRENTE', 'label' => 'Frente / Puertas', 'optionIds' => %w[mat-oak] }],
                 base['materialRoles']
    wall = provider.find_definition('22222222-2222-2222-2222-222222222222')
    refute_includes wall, 'estimatedPartCount', 'absent server counts must stay absent'

    materials = provider.all_materials
    assert_equal 1, materials.length
    assert_equal 'mat-oak', materials.first['materialId']
    assert_equal '#c4a574', materials.first['previewColor']
    assert_equal 'Arauco', materials.first['manufacturer']
    assert_equal 'cat-light', materials.first['categoryId']
    assert_equal '/api/media/oak_pbr.jpg', materials.first['previewTextureUrl']
    assert_equal 600.0, materials.first['previewTextureTileWidthMm']
    assert_equal 0.65, materials.first['previewRoughness']
  end

  def test_serves_material_categories_hierarchical_tree
    contract = JSON.parse(JSON.generate(CONTRACT))
    contract['materialCategories'] = [
      { 'id' => 'matcat-wood', 'name' => 'Maderas', 'sortOrder' => 1 },
      { 'id' => 'matcat-light', 'name' => 'Claras', 'parentId' => 'matcat-wood', 'sortOrder' => 1 }
    ]
    provider = build_provider(status: 200, body: contract)

    categories = provider.all_material_categories
    assert_equal 2, categories.length
    assert_equal 'Maderas', categories[0]['name']
    assert_equal 'matcat-wood', categories[1]['parentId']
  end

  def test_static_providers_serve_no_materials_or_material_categories
    static = Granete::SketchUpExtension::Library::StaticCatalogProvider.new
    assert_equal [], static.all_materials
    assert_equal [], static.all_material_categories
  end

  def test_handles_conditional_etag_and_304_not_modified
    transport = FakeTransport.new(
      {
        'status' => 200,
        'headers' => { 'etag' => '"workshop-v1"' },
        'body' => CONTRACT
      }
    )
    provider = build_provider(transport: transport)

    # Initial request fetches and caches contract + etag
    defs = provider.all_definitions
    assert_equal 2, defs.length
    assert_equal 1, transport.requests

    # Second request with force: true sends If-None-Match header and handles 304
    transport.response = { 'status' => 304, 'headers' => { 'etag' => '"workshop-v1"' }, 'body' => '' }
    defs2 = provider.all_definitions(force: true)
    assert_equal 2, defs2.length
    assert_equal 2, transport.requests
    assert_equal({ 'If-None-Match' => '"workshop-v1"' }, transport.last_payload['headers'])
  end

  private

  def build_provider(status: nil, body: nil, transport: nil)
    transport ||= FakeTransport.new({ 'status' => status, 'body' => body })
    Granete::SketchUpExtension::Library::RemoteCatalogProvider.new(
      transport: transport, auth_provider: FakeAuth.new
    )
  end
end
