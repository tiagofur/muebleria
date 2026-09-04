# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Semantic selection restore after a rebuild (#498 / authoring contract
      # §14): child persistent_ids and definition GUIDs legitimately change
      # during regeneration, so selection is re-resolved through Granete
      # identity (furnitureInstanceId / instanceRef, then componentInstanceId
      # or hardwarePlacementId from namespaced metadata) — never through
      # persistent_id, entityID, name or geometry. View state only: no
      # SketchUp operation, no metadata write; failures degrade to keeping
      # the current selection instead of failing the committed mutation.
      class SelectionRestore
        def initialize(metadata_store_factory:, model_provider:, logger: nil)
          @metadata_store_factory = metadata_store_factory
          @model_provider = model_provider
          @logger = logger
        end

        # Returns the re-selected entity, the owning furniture when the child
        # is gone, or nil when nothing semantic could be located.
        def restore(semantic_target)
          model = @model_provider.call
          return nil unless model.respond_to?(:selection)

          root = locate_furniture_root(model, semantic_target)
          return nil unless root

          target = locate_child(root, semantic_target) || root
          select(model, target)
          target
        rescue StandardError => e
          @logger&.warn('selection_restore_failed', error: e)
          nil
        end

        private

        def locate_furniture_root(model, target)
          if target['furnitureInstanceId'] && model.respond_to?(:entities)
            located = Connection::ProjectFurniture::ManagedFurniture
                      .locate(model, store(model), target['furnitureInstanceId'])
            return located['entity'] if located['entity']
          end
          return nil unless target['furnitureInstanceRef'] && model.respond_to?(:entities)

          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities.find do |entity|
            read_identity(entity)&.dig('instanceRef') == target['furnitureInstanceRef']
          end
        end

        def locate_child(root, target)
          child_id = target['componentInstanceId'] || target['hardwarePlacementId']
          return nil unless child_id && root.respond_to?(:definition)

          root.definition.entities.find do |child|
            next false unless child.respond_to?(:definition)

            identity = read_identity(child)
            identity&.dig('componentInstanceId') == child_id || identity&.dig('hardwarePlacementId') == child_id
          end
        rescue StandardError
          nil
        end

        def select(model, target)
          model.selection.clear
          model.selection.add(target)
        end

        def read_identity(entity)
          store = store(entity.respond_to?(:model) && entity.model ? entity.model : @model_provider.call)
          store.read(entity)&.[]('identity')
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
