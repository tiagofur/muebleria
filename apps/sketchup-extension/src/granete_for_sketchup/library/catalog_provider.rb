# frozen_string_literal: true

require 'json'

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

      # Serves the workshop library from the Granete API when the session is
      # configured, translating the shared contract shape (camelCase,
      # contracts/pilotFurnitureCatalog.json) into the internal form consumed
      # by the dialog and the builder. Falls back to the packaged offline
      # catalog whenever the remote library is unavailable.
      class RemoteCatalogProvider < BaseCatalogProvider
        attr_reader :last_source, :last_license_blocked

        def initialize(transport:, auth_provider: nil, fallback_provider: nil, logger: nil)
          super()
          @transport = transport
          @auth_provider = auth_provider
          @fallback_provider = fallback_provider || StaticCatalogProvider.new
          @logger = logger
          @last_source = 'local'
          @last_license_blocked = false
          @cached_contract = nil
        end

        def all_definitions
          remote = fetch_contract
          return translate_definitions(remote) if remote

          @fallback_provider.all_definitions
        end

        def all_presets
          remote = fetch_contract
          return remote.fetch('presets', []) if remote

          []
        end

        def find_definition(definition_id)
          all_definitions.find { |d| d['furniture_definition_id'] == definition_id }
        end

        # Drops the cached contract so the next read re-fetches with the
        # current session (used right after login/logout).
        def reset
          @cached_contract = nil
          @last_source = 'local'
          @last_license_blocked = false
          nil
        end

        private

        def fetch_contract
          return nil unless @transport&.configured? && @auth_provider&.configured?
          return @cached_contract if @cached_contract

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          response = @transport.request({ 'method' => 'GET', 'path' => '/furniture/definitions' },
                                        authorization_header: @auth_provider.authorization_header)
          case response['status']
          when 200
            body = response['body']
            return nil unless body.is_a?(Hash) && body['definitions'].is_a?(Hash)

            @last_source = 'remote'
            @last_license_blocked = false
            @cached_contract = body
          when 403
            @last_source = 'local'
            @last_license_blocked = true
            @logger&.info('catalog_license_blocked')
            nil
          else
            @last_source = 'local'
            @last_license_blocked = false
            @logger&.info('catalog_remote_unavailable', status: response['status'])
            nil
          end
        rescue Transport::RequestError, Auth::NotConfiguredError => e
          @last_source = 'local'
          @last_license_blocked = false
          @logger&.info('catalog_remote_failed', error: e)
          nil
        end

        # Single translation point from the shared contract (camelCase) to the
        # internal dialog/builder shape (snake_case definition, camelCase
        # parameters preserved as-is).
        def translate_definitions(contract)
          contract.fetch('definitions', {}).map do |_id, definition|
            {
              'furniture_definition_id' => definition['furnitureDefinitionId'],
              'code' => definition['code'],
              'name' => definition['name'],
              'category' => definition['category'],
              'version' => definition['version'],
              'description' => definition['description'],
              'parameters' => translate_parameters(definition['parameters'])
            }
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
