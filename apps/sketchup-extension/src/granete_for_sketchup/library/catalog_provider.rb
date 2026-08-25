# frozen_string_literal: true

require 'json'
require 'uri'

module Granete
  module SketchUpExtension
    module Library
      class BaseCatalogProvider
        def all_definitions
          raise NotImplementedError
        end

        def find_definition(definition_id)
          raise NotImplementedError
        end

        # Presets of the catalog in the shared contract shape. Providers
        # without preset support return an empty list so callers can rely on
        # a single contract.
        def all_presets
          []
        end

        # Category tree in the shared contract shape; empty for providers
        # without a workshop category tree.
        def all_categories
          []
        end

        # Workshop board materials in the shared contract shape; empty for
        # providers without a workshop material list.
        def all_materials
          []
        end

        # Resolved furniture layout (complete composition: boards + visible
        # hardware) for a definition at concrete parameters and board choices
        # (role == option group code → material id). nil = this provider
        # cannot resolve layouts (callers fall back to their generic
        # authoring path).
        def resolved_layout(_definition_id, _parameters = {}, _choices = {})
          nil
        end
      end

      class StaticCatalogProvider < BaseCatalogProvider
        DEFINITIONS = [
          {
            'furniture_definition_id' => 'kitchen-base-standard',
            'code' => 'KITCHEN-BASE-600',
            'name' => 'Gabinete Base Estándar',
            'category' => 'kitchen_base',
            'version' => '1.0.0',
            'description' => 'Módulo inferior de cocina con entrepaños y puertas configurables.',
            'parameters' => [
              { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
                'defaultValue' => 600, 'min' => 300, 'max' => 1200, 'step' => 50, 'unit' => 'mm' },
              { 'name' => 'heightMm', 'label' => 'Alto (mm)', 'type' => 'number',
                'defaultValue' => 720, 'min' => 600, 'max' => 900, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'depthMm', 'label' => 'Fondo (mm)', 'type' => 'number',
                'defaultValue' => 590, 'min' => 300, 'max' => 700, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number',
                'defaultValue' => 1, 'min' => 0, 'max' => 4, 'step' => 1, 'unit' => 'count' },
              { 'name' => 'doorCount', 'label' => 'Puertas', 'type' => 'number',
                'defaultValue' => 1, 'min' => 0, 'max' => 2, 'step' => 1, 'unit' => 'count' },
              { 'name' => 'joinerySystemId', 'label' => 'Sistema de Unión', 'type' => 'enum',
                'defaultValue' => 'minifix-dowel', 'options' => %w[minifix-dowel dowel-only] }
            ]
          },
          {
            'furniture_definition_id' => 'kitchen-wall-standard',
            'code' => 'KITCHEN-WALL-600',
            'name' => 'Gabinete Superior / Alacena',
            'category' => 'kitchen_wall',
            'version' => '1.0.0',
            'description' => 'Módulo aéreo de cocina para colgar en muro.',
            'parameters' => [
              { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
                'defaultValue' => 600, 'min' => 300, 'max' => 1200, 'step' => 50, 'unit' => 'mm' },
              { 'name' => 'heightMm', 'label' => 'Alto (mm)', 'type' => 'number',
                'defaultValue' => 600, 'min' => 400, 'max' => 900, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'depthMm', 'label' => 'Fondo (mm)', 'type' => 'number',
                'defaultValue' => 350, 'min' => 250, 'max' => 450, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number',
                'defaultValue' => 1, 'min' => 0, 'max' => 3, 'step' => 1, 'unit' => 'count' },
              { 'name' => 'doorCount', 'label' => 'Puertas', 'type' => 'number',
                'defaultValue' => 1, 'min' => 0, 'max' => 2, 'step' => 1, 'unit' => 'count' }
            ]
          },
          {
            'furniture_definition_id' => 'closet-tower-open',
            'code' => 'CLOSET-TOWER-800',
            'name' => 'Torre de Closet / Vestidor',
            'category' => 'closet',
            'version' => '1.0.0',
            'description' => 'Torre modular para closet con entrepaños ajustables.',
            'parameters' => [
              { 'name' => 'widthMm', 'label' => 'Ancho (mm)', 'type' => 'number',
                'defaultValue' => 800, 'min' => 400, 'max' => 1200, 'step' => 50, 'unit' => 'mm' },
              { 'name' => 'heightMm', 'label' => 'Alto (mm)', 'type' => 'number',
                'defaultValue' => 2100, 'min' => 1800, 'max' => 2600, 'step' => 50, 'unit' => 'mm' },
              { 'name' => 'depthMm', 'label' => 'Fondo (mm)', 'type' => 'number',
                'defaultValue' => 500, 'min' => 350, 'max' => 650, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'shelfCount', 'label' => 'Entrepaños', 'type' => 'number',
                'defaultValue' => 4, 'min' => 0, 'max' => 8, 'step' => 1, 'unit' => 'count' }
            ]
          },
          {
            'furniture_definition_id' => 'workstation-desk-01',
            'code' => 'DESK-1200',
            'name' => 'Escritorio de Trabajo',
            'category' => 'desk',
            'version' => '1.0.0',
            'description' => 'Mesa de trabajo modular con cubierta y patas de panel.',
            'parameters' => [
              { 'name' => 'widthMm', 'label' => 'Largo (mm)', 'type' => 'number',
                'defaultValue' => 1200, 'min' => 800, 'max' => 2000, 'step' => 50, 'unit' => 'mm' },
              { 'name' => 'heightMm', 'label' => 'Alto (mm)', 'type' => 'number',
                'defaultValue' => 750, 'min' => 650, 'max' => 850, 'step' => 10, 'unit' => 'mm' },
              { 'name' => 'depthMm', 'label' => 'Fondo (mm)', 'type' => 'number',
                'defaultValue' => 600, 'min' => 450, 'max' => 900, 'step' => 10, 'unit' => 'mm' }
            ]
          }
        ].freeze

        def all_definitions
          DEFINITIONS
        end

        def find_definition(definition_id)
          DEFINITIONS.find { |d| d['furniture_definition_id'] == definition_id }
        end
      end

      # Serves the workshop library from the Granete API using the
      # authenticated session, translating the shared contract shape
      # (camelCase, furniture/definitions envelope) into the internal form
      # consumed by the dialog and the builder. Granete is the source of
      # truth: when the remote catalog cannot be served the provider returns
      # an empty catalog and reports why through +last_source+ — it never
      # silently substitutes the packaged offline definitions. An explicit
      # +fallback_provider+ (development/tests) is the only path back to a
      # local catalog.
      class RemoteCatalogProvider < BaseCatalogProvider
        SOURCE_REMOTE = 'remote'
        SOURCE_UNAUTHENTICATED = 'unauthenticated'
        SOURCE_LICENSE_BLOCKED = 'license_blocked'
        SOURCE_ERROR = 'error'
        SOURCE_LOCAL = 'local'

        # Dimension parameters the layout endpoint understands; anything else
        # the dialog may carry is ignored server-side anyway.
        LAYOUT_QUERY_PARAMS = %w[widthMm heightMm depthMm].freeze

        # Server-resolved composition counts passed through verbatim.
        ESTIMATED_COUNT_KEYS = %w[estimatedPartCount estimatedHardwareCount].freeze

        attr_reader :last_source, :last_license_blocked

        def initialize(transport:, auth_provider: nil, fallback_provider: nil, logger: nil)
          super()
          @transport = transport
          @auth_provider = auth_provider
          @fallback_provider = fallback_provider
          @logger = logger
          @last_source = SOURCE_UNAUTHENTICATED
          @last_license_blocked = false
          @cached_contract = nil
        end

        def all_definitions
          remote = fetch_contract
          return translate_definitions(remote) if remote

          serve_from_fallback(&:all_definitions) || []
        end

        def all_presets
          remote = fetch_contract
          return remote.fetch('presets', []) if remote

          serve_from_fallback(&:all_presets) || []
        end

        # Category tree of the workshop catalog (contract shape: categoryId,
        # name, parentId, sortOrder) for cascading L1/L2/L3 filters; empty for
        # providers without a workshop category tree.
        def all_categories
          remote = fetch_contract
          return remote.fetch('categories', []) if remote

          serve_from_fallback(&:all_categories) || []
        end

        # Workshop board materials (contract shape: materialId, code, name,
        # previewColor, imageUrl, thicknessMm, grain) for client material
        # selectors; empty for providers without a workshop material list.
        def all_materials
          remote = fetch_contract
          return remote.fetch('materials', []) if remote

          serve_from_fallback(&:all_materials) || []
        end

        def find_definition(definition_id)
          all_definitions.find { |d| d['furniture_definition_id'] == definition_id }
        end

        # Resolves the definition's COMPLETE layout server-side (every board of
        # its structure/agregados plus visible hardware) at the given
        # parameters and board choices. Granete owns resolution truth: this
        # never falls back to a local guess — nil means "insert with the
        # generic authoring path". Choices map option group code (== component
        # optionRole) to material id, the same shape the React app stores on
        # project items.
        def resolved_layout(definition_id, parameters = {}, choices = {})
          return nil unless @transport&.configured? && @auth_provider&.configured?

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          path = "/furniture/definitions/#{definition_id}/layout#{layout_query(parameters, choices)}"
          response = @transport.request({ 'method' => 'GET', 'path' => path },
                                        authorization_header: @auth_provider.authorization_header)
          interpret_layout_response(response)
        rescue Transport::RequestError, Auth::NotConfiguredError => e
          @logger&.info('layout_remote_failed', error: e)
          nil
        end

        # Drops the cached contract so the next read re-fetches with the
        # current session (used right after login/logout).
        def reset
          @cached_contract = nil
          @last_source = SOURCE_UNAUTHENTICATED
          @last_license_blocked = false
          nil
        end

        private

        def fetch_contract
          unless @transport&.configured? && @auth_provider&.configured?
            mark_unavailable(SOURCE_UNAUTHENTICATED)
            return nil
          end
          return @cached_contract if @cached_contract

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          response = @transport.request({ 'method' => 'GET', 'path' => '/furniture/definitions' },
                                        authorization_header: @auth_provider.authorization_header)
          interpret_response(response)
        rescue Transport::RequestError, Auth::NotConfiguredError => e
          mark_unavailable(SOURCE_ERROR)
          @logger&.info('catalog_remote_failed', error: e)
          nil
        end

        # Maps the transport response onto the provider state, returning the
        # cached-able contract body on success and nil on any failure.
        def interpret_response(response)
          case response['status']
          when 200
            cache_contract(response['body'])
          when 401
            mark_unavailable(SOURCE_UNAUTHENTICATED)
            @logger&.info('catalog_session_invalid')
            nil
          when 403
            mark_unavailable(SOURCE_LICENSE_BLOCKED)
            @last_license_blocked = true
            @logger&.info('catalog_license_blocked')
            nil
          else
            mark_unavailable(SOURCE_ERROR)
            @logger&.info('catalog_remote_unavailable', status: response['status'])
            nil
          end
        end

        def cache_contract(body)
          unless body.is_a?(Hash) && body['definitions'].is_a?(Hash)
            mark_unavailable(SOURCE_ERROR)
            @logger&.info('catalog_remote_invalid_body')
            return nil
          end

          @last_source = SOURCE_REMOTE
          @last_license_blocked = false
          @cached_contract = body
        end

        def mark_unavailable(source)
          @last_source = source
          @last_license_blocked = false
        end

        # The explicit fallback (development/tests) is the only sanctioned
        # local catalog; when it serves, the reported source must say so.
        def serve_from_fallback
          return nil unless @fallback_provider

          result = yield @fallback_provider
          @last_source = SOURCE_LOCAL
          @last_license_blocked = false
          result
        end

        # Maps a layout response onto the layout body (or nil on any failure).
        def interpret_layout_response(response)
          case response['status']
          when 200
            body = response['body']
            body.is_a?(Hash) && body['components'].is_a?(Array) ? body : nil
          when 401
            @logger&.info('layout_session_invalid')
            nil
          when 403
            @logger&.info('layout_license_blocked')
            nil
          else
            @logger&.info('layout_remote_unavailable', status: response['status'])
            nil
          end
        end

        def layout_query(parameters, choices = {})
          segments = LAYOUT_QUERY_PARAMS.filter_map do |name|
            value = parameters[name]
            next if value.nil? || value.to_s.empty?

            "#{name}=#{URI.encode_www_form_component(value.to_s)}"
          end
          # Board choices ride as choice.ROLE=<materialId> — GET-only surface
          # for the read-only extension token.
          choices.each do |role, material_id|
            next if role.to_s.empty? || material_id.to_s.empty?

            segments << "choice.#{role}=#{URI.encode_www_form_component(material_id.to_s)}"
          end
          segments.empty? ? '' : "?#{segments.join('&')}"
        end

        # Single translation point from the shared contract (camelCase) to the
        # internal dialog/builder shape (snake_case definition, camelCase
        # parameters preserved as-is).
        def translate_definitions(contract)
          contract.fetch('definitions', {}).map do |_id, definition|
            item = {
              'furniture_definition_id' => definition['furnitureDefinitionId'],
              'code' => definition['code'],
              'name' => definition['name'],
              'category' => definition['category'],
              'version' => definition['version'],
              'description' => definition['description'],
              'parameters' => translate_parameters(definition['parameters'])
            }
            image_url = definition['imageUrl'] || definition['thumbnailUrl'] || definition['previewUrl']
            item['imageUrl'] = image_url if image_url
            item['categoryId'] = definition['categoryId'] if definition['categoryId']
            ESTIMATED_COUNT_KEYS.each { |key| item[key] = definition[key] if definition[key] }
            item['materialRoles'] = definition['materialRoles'] if definition['materialRoles'].is_a?(Array)
            item
          end
        end

        def translate_parameters(parameters)
          (parameters || []).map do |param|
            translated = {
              'name' => param['name'],
              'label' => param['label'],
              'type' => param['type'],
              'defaultValue' => param['defaultValue']
            }
            %w[min max step unit].each { |key| translated[key] = param[key] unless param[key].nil? }
            translated['options'] = param['options'] if param['options']
            translated
          end
        end
      end

      # Default Factory
      class CatalogProvider < StaticCatalogProvider
      end
    end
  end
end
