# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Locates managed entities for the overlay by Granete identity only
      # (namespaced metadata: instanceRef/furnitureInstanceId,
      # componentInstanceId, hardwarePlacementId) — never by SketchUp name,
      # GUID, persistent_id or geometry. Read-only: no selection change, no
      # mutation.
      class EntityLocator
        def initialize(metadata_store_factory:, model_provider:)
          @metadata_store_factory = metadata_store_factory
          @model_provider = model_provider
        end

        def locate_furniture(scope)
          model = @model_provider.call
          return nil unless model.respond_to?(:entities)

          if scope['furnitureInstanceId'] &&
             defined?(Connection::ProjectFurniture::ManagedFurniture) &&
             model.respond_to?(:definitions)
            located = Connection::ProjectFurniture::ManagedFurniture
                      .locate(model, store(model), scope['furnitureInstanceId'])
            return located['entity'] if located && located['entity']
          end

          ref = scope['furnitureInstanceRef']
          return nil unless ref

          # rubocop:disable SketchupSuggestions/ModelEntities
          model.entities.find { |entity| read_identity(entity)&.dig('instanceRef') == ref }
          # rubocop:enable SketchupSuggestions/ModelEntities
        end

        def locate_child(root, child_id)
          return nil unless child_id && root.respond_to?(:definition)

          find_child_recursive(root, child_id)
        end

        private

        def find_child_recursive(entity, child_id)
          return nil unless entity.respond_to?(:definition) && entity.definition.respond_to?(:entities)

          entity.definition.entities.each do |child|
            next unless child.respond_to?(:definition)

            identity = read_identity(child)
            if identity&.dig('componentInstanceId') == child_id ||
               identity&.dig('hardwarePlacementId') == child_id
              return child
            end

            nested = find_child_recursive(child, child_id)
            return nested if nested
          end
          nil
        end

        def read_identity(entity)
          model = entity.respond_to?(:model) && entity.model ? entity.model : @model_provider.call
          store(model).read(entity)&.[]('identity')
        rescue StandardError
          nil
        end

        def store(model)
          @metadata_store_factory.call(model)
        end
      end
    end
  end
end
