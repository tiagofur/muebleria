# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Observers
      class SelectionObserver < (defined?(::Sketchup::SelectionObserver) ? ::Sketchup::SelectionObserver : Object)
        def initialize(metadata_store:, catalog_provider:, on_selection_change:)
          super() if defined?(::Sketchup::SelectionObserver)
          @metadata_store = metadata_store
          @catalog_provider = catalog_provider
          @on_selection_change = on_selection_change
        end

        def onSelectionBulkChange(selection)
          handle_selection(selection)
        end

        def onSelectionCleared(_selection)
          @on_selection_change.call(nil)
        end

        def inspect_entity(entity)
          return nil if entity.nil? || !entity.respond_to?(:get_attribute)

          meta = @metadata_store.read(entity)
          return nil if meta.nil?

          kind = meta['kind']
          case kind
          when 'furnitureInstance', 'bootstrapIntent'
            def_id = meta.dig('intent', 'furnitureDefinitionId')
            definition = @catalog_provider.find_definition(def_id)
            {
              'type' => 'furniture',
              'instanceId' => meta.dig('identity', 'instanceRef'),
              'definitionId' => def_id,
              'definition' => definition,
              'name' => if definition
                          definition['name']
                        else
                          (entity.respond_to?(:name) ? entity.name : 'Mueble')
                        end,
              'parameters' => meta.dig('intent', 'parameters') || {}
            }
          when 'componentInstance'
            {
              'type' => 'component',
              'instanceId' => meta.dig('identity', 'instanceRef'),
              'role' => meta.dig('intent', 'semanticRole'),
              'name' => entity.respond_to?(:name) ? entity.name : 'Componente'
            }
          end
        end

        private

        def handle_selection(selection)
          first = selection&.first
          data = inspect_entity(first)
          @on_selection_change.call(data)
        end
      end
    end
  end
end
