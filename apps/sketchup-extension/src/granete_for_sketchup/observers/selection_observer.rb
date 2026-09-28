# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Observers
      # SketchUp selection bridge over the canonical Selection::Resolver
      # (#476). Every selection change publishes one SelectionContext payload
      # — furniture / aggregate / part / hardware / unmanaged, with stable
      # Granete identity and capability-driven actions — consumed by the
      # contextual inspector and, downstream, by #466/#467/#468/#470/#471.
      # No feature may build a parallel selection model on top of
      # `selection.first` heuristics.
      class SelectionObserver < (defined?(::Sketchup::SelectionObserver) ? ::Sketchup::SelectionObserver : Object)
        def initialize(metadata_store:, catalog_provider:, on_selection_change:, model_provider: nil)
          super() if defined?(::Sketchup::SelectionObserver)
          @resolver = Selection::Resolver.new(
            metadata_store: metadata_store,
            catalog_provider: catalog_provider,
            model_provider: model_provider
          )
          @on_selection_change = on_selection_change
        end

        def onSelectionBulkChange(selection)
          handle_selection(selection)
        end

        def onSelectionCleared(_selection)
          @on_selection_change.call(nil)
        end

        # Central resolution entrypoint (nil entity → nil context). Exposed
        # for the dialog's initial sync and for downstream consumers that
        # need to resolve an entity without waiting for a host event.
        def resolve(entity, selection: nil)
          context = @resolver.resolve(entity)
          return nil if context.nil?

          count = selection_count(selection)
          context.selection_count = count if count
          context
        end

        private

        def handle_selection(selection)
          context = resolve_selection(selection)
          @on_selection_change.call(context&.to_payload)
        end

        # #471: a multi-selection of two or more managed furniture resolves
        # to a BatchContext — a SET of semantic identities, never
        # selection.first authority. Any other multi-selection keeps the
        # historical single-context payload of the first entity (with its
        # honest selectionCount), so existing lanes do not change.
        def resolve_selection(selection)
          entities = selection_entities(selection)
          return nil if entities.empty?
          unless entities.length >= Selection::BatchContext::BATCH_MINIMUM
            return resolve(entities.first, selection: selection)
          end

          contexts = entities.map { |entity| @resolver.resolve(entity) }.compact
          furniture_contexts = contexts.select { |context| context.kind == 'furniture' }
          members = furniture_contexts.uniq(&:identity_key)
          unless members.length >= Selection::BatchContext::BATCH_MINIMUM
            return resolve(entities.first, selection: selection)
          end

          Selection::BatchContext.new(
            members: members,
            others: contexts - furniture_contexts,
            selection_count: entities.length
          )
        end

        def selection_entities(selection)
          return [] unless selection

          selection.respond_to?(:to_a) ? selection.to_a : []
        end

        def selection_count(selection)
          return nil unless selection

          if selection.respond_to?(:length)
            selection.length
          elsif selection.respond_to?(:items)
            selection.items.length
          end
        end
      end
    end
  end
end
