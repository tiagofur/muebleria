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

          target = locate_target(model, semantic_target)
          return nil unless target

          select(model, target)
          target
        rescue StandardError => e
          @logger&.warn('selection_restore_failed', error: e)
          nil
        end

        # #471 batch restore: ONE clear, then every target located by the
        # SAME semantic identity rules as #restore (rebuilds legitimately
        # replace wrappers, so identity — never persistent_id, entityID,
        # name or position — is the only locator). View state only: a
        # member that cannot be located is skipped with a warn and never
        # fails the committed batch; the honest subset is re-selected.
        def restore_many(semantic_targets)
          model = @model_provider.call
          return [] unless model.respond_to?(:selection)

          targets = Array(semantic_targets).filter_map { |target| locate_target(model, target) }
          return [] if targets.empty?

          model.selection.clear
          targets.each { |target| model.selection.add(target) }
          targets
        rescue StandardError => e
          @logger&.warn('batch_selection_restore_failed', error: e)
          []
        end

        private

        def locate_target(model, semantic_target)
          root = locate_furniture_root(model, semantic_target)
          return nil unless root

          locate_child(root, semantic_target) || root
        end

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

          find_child_recursive(root, child_id)
        rescue StandardError
          nil
        end

        def find_child_recursive(entity, child_id)
          return nil unless entity.respond_to?(:definition) && entity.definition.respond_to?(:entities)

          entity.definition.entities.each do |child|
            next unless child.respond_to?(:definition)

            identity = read_identity(child)
            if identity&.dig('componentInstanceId') == child_id || identity&.dig('hardwarePlacementId') == child_id
              return child
            end

            nested = find_child_recursive(child, child_id)
            return nested if nested
          end
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
