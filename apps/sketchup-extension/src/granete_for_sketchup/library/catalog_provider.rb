# frozen_string_literal: true

require 'json'
require 'uri'

module Granete
  module SketchUpExtension
    module Library
      class LayoutResolutionError < StandardError
        attr_reader :status

        def initialize(message, status: nil)
          super(message)
          @status = status
        end
      end

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

        # Workshop material categories tree (id, name, parentId, sortOrder)
        # for hierarchical material filtering; empty for providers without
        # material categories.
        def all_material_categories
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

        # Resolves the layout AND parses the authoritative board-local
        # transform contract (#414 / ADR-0004 §9). Fails safely —
        # LayoutContract::ContractError, a LayoutResolutionError — when the
        # server publishes a missing or unknown transform contract; there is
        # deliberately no AABB/slot fallback. nil = this provider cannot
        # resolve layouts (generic authoring path).
        def resolved_native_layout(definition_id, parameters = {}, choices = {})
          body = resolved_layout(definition_id, parameters, choices)
          body && LayoutContract.parse!(body)
        end

        # #477 — stateless rich authoring resolve: submits the semantic
        # authoring intent (a granete.sketchup-authoring-resolve.v1 request
        # envelope built by AuthoringResolveContract.build_request) and
        # returns the parsed authoritative result. nil = this provider cannot
        # resolve authoring (no local guess ever replaces the server).
        def resolve_authoring(_request_payload)
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
          @cached_etag = nil
        end

        def all_definitions(force: false)
          remote = fetch_contract(force: force)
          return translate_definitions(remote) if remote

          serve_from_fallback(&:all_definitions) || []
        end

        def all_presets(force: false)
          remote = fetch_contract(force: force)
          return remote.fetch('presets', []) if remote

          serve_from_fallback(&:all_presets) || []
        end

        def all_categories(force: false)
          remote = fetch_contract(force: force)
          return remote.fetch('categories', []) if remote

          serve_from_fallback(&:all_categories) || []
        end

        def all_material_categories(force: false)
          remote = fetch_contract(force: force)
          return remote.fetch('materialCategories', []) if remote

          serve_from_fallback(&:all_material_categories) || []
        end

        def all_materials(force: false)
          remote = fetch_contract(force: force)
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
          path = "/furniture/definitions/#{definition_id}/layout#{RemoteLayoutTransport.layout_query(parameters,
                                                                                                     choices)}"
          response = @transport.request({ 'method' => 'GET', 'path' => path },
                                        authorization_header: @auth_provider.authorization_header)
          RemoteLayoutTransport.interpret(response, logger: @logger)
        rescue Transport::RequestError => e
          @logger&.info('layout_remote_failed', error: e)
          raise LayoutResolutionError, "Error de conexión al resolver composición: #{e.message}"
        end

        # #477 — submits the versioned authoring resolve request and parses
        # the authoritative result. The intent rides the POST body by
        # contract; this transport never appends authoring query parameters.
        # Rejections arrive as structured issue codes (AuthoringResolveError
        # carries them) — callers branch on codes, not message substrings.
        def resolve_authoring(request_payload)
          return nil unless @transport&.configured? && @auth_provider&.configured?

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          response = @transport.request(
            { 'method' => 'POST', 'path' => '/furniture/authoring/resolve', 'body' => request_payload },
            authorization_header: @auth_provider.authorization_header
          )
          AuthoringResolveTransport.interpret(response, expected_request: request_payload, logger: @logger)
        rescue Transport::RequestError => e
          @logger&.info('authoring_resolve_remote_failed', error: e)
          raise AuthoringResolveError, "Error de conexión al resolver autoría: #{e.message}"
        end

        # Drops the cached contract so the next read re-fetches with the
        # current session (used right after login/logout).
        def reset
          @cached_contract = nil
          @cached_etag = nil
          @last_source = SOURCE_UNAUTHENTICATED
          @last_license_blocked = false
          nil
        end

        private

        def fetch_contract(force: false)
          unless @transport&.configured? && @auth_provider&.configured?
            mark_unavailable(SOURCE_UNAUTHENTICATED)
            return nil
          end
          return @cached_contract if @cached_contract && !force

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          headers = {}
          headers['If-None-Match'] = @cached_etag if @cached_etag
          response = @transport.request(
            { 'method' => 'GET', 'path' => '/furniture/definitions', 'headers' => headers },
            authorization_header: @auth_provider.authorization_header
          )
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
            etag = response.dig('headers', 'etag')
            cache_contract(response['body'], etag: etag)
          when 304
            @last_source = SOURCE_REMOTE
            @last_license_blocked = false
            @cached_contract
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

        def cache_contract(body, etag: nil)
          unless body.is_a?(Hash) && body['definitions'].is_a?(Hash)
            mark_unavailable(SOURCE_ERROR)
            @logger&.info('catalog_remote_invalid_body')
            return nil
          end

          begin
            CatalogParameterContract.validate_catalog!(body)
          rescue CatalogParameterContract::ContractError => e
            mark_unavailable(SOURCE_ERROR)
            @logger&.info('catalog_parameter_definition_invalid', code: e.code, path: e.path, error: e.message)
            return nil
          end

          @last_source = SOURCE_REMOTE
          @last_license_blocked = false
          @cached_etag = etag
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

        def translate_definitions(contract)
          contract.fetch('definitions', {}).map do |_id, defn|
            item = {
              'furniture_definition_id' => defn['furnitureDefinitionId'],
              'code' => defn['code'], 'name' => defn['name'],
              'category' => defn['category'], 'version' => defn['version'],
              'description' => defn['description'],
              'parameters' => translate_parameters(defn['parameters'])
            }
            item['schemaRevision'] = defn['schemaRevision'] unless defn['schemaRevision'].nil?
            item['definitionHash'] = defn['definitionHash'] if defn['definitionHash']
            image_url = defn['imageUrl'] || defn['thumbnailUrl'] || defn['previewUrl']
            item['imageUrl'] = image_url if image_url
            item['categoryId'] = defn['categoryId'] if defn['categoryId']
            ESTIMATED_COUNT_KEYS.each { |key| item[key] = defn[key] if defn[key] }
            item['materialRoles'] = defn['materialRoles'] if defn['materialRoles'].is_a?(Array)
            item
          end
        end

        def translate_parameters(parameters)
          (parameters || []).map do |param|
            translated = {
              'name' => param['name'], 'label' => param['label'],
              'type' => param['type'], 'defaultValue' => param['defaultValue']
            }
            %w[min max step unit options required integer category sortOrder binding].each do |key|
              translated[key] = param[key] unless param[key].nil?
            end
            translated
          end
        end
      end

      # Default Factory
      class CatalogProvider < StaticCatalogProvider
      end

      # Transport mapping for the layout endpoint (GET): HTTP status → body
      # or LayoutResolutionError. Extracted from RemoteCatalogProvider so the
      # provider class stays focused on catalog state (#477 followed the same
      # shape for the authoring resolve transport).
      module RemoteLayoutTransport
        module_function

        def interpret(response, logger: nil)
          status = response['status']
          case status
          when 200
            body = response['body']
            unless body.is_a?(Hash) && body['components'].is_a?(Array)
              raise LayoutResolutionError.new('Respuesta de composición inválida del servidor', status: 200)
            end

            body
          when 401
            logger&.info('layout_session_invalid')
            raise LayoutResolutionError.new('Sesión inválida o expirada', status: 401)
          when 403
            logger&.info('layout_license_blocked')
            raise LayoutResolutionError.new('Licencia requerida para composición 3D', status: 403)
          when 422
            msg = response.dig('body', 'error') || 'Composición no resoluble para los parámetros seleccionados'
            logger&.info('layout_resolution_unprocessable', error: msg)
            raise LayoutResolutionError.new(msg, status: 422)
          else
            msg = response.dig('body', 'error') || "Error del servidor al resolver composición (HTTP #{status})"
            logger&.info('layout_remote_unavailable', status: status)
            raise LayoutResolutionError.new(msg, status: status)
          end
        end

        def layout_query(parameters, choices = {})
          segments = RemoteCatalogProvider::LAYOUT_QUERY_PARAMS.filter_map do |name|
            value = parameters[name]
            next if value.nil? || value.to_s.empty?

            "#{name}=#{URI.encode_www_form_component(value.to_s)}"
          end
          choices.each do |role, material_id|
            next if role.to_s.empty? || material_id.to_s.empty?

            segments << "choice.#{role}=#{URI.encode_www_form_component(material_id.to_s)}"
          end
          segments.empty? ? '' : "?#{segments.join('&')}"
        end
      end
    end
  end
end
