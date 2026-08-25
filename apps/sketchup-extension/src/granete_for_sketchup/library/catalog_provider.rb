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

      class RemoteCatalogProvider < BaseCatalogProvider
        def initialize(transport:, fallback_provider: nil)
          super()
          @transport = transport
          @fallback_provider = fallback_provider || StaticCatalogProvider.new
        end

        def all_definitions
          if @transport&.configured?
            # When remote API is available, fetch definitions from backend endpoint
          end
          @fallback_provider.all_definitions
        end

        def find_definition(definition_id)
          all_definitions.find { |d| d['furniture_definition_id'] == definition_id }
        end
      end

      # Default Factory
      class CatalogProvider < StaticCatalogProvider
      end
    end
  end
end
