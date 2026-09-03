# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Observers
      # #391 / DT-7 EntitiesObserver: detects when managed furniture instances
      # are added to the active model (via Move+Copy or Copy/Paste) and dispatches
      # duplicate resolution to the DuplicateResolver.
      class EntitiesObserver < (defined?(::Sketchup::EntitiesObserver) ? ::Sketchup::EntitiesObserver : Object)
        def initialize(duplicate_resolver:, model_provider: nil)
          super() if defined?(::Sketchup::EntitiesObserver)
          @duplicate_resolver = duplicate_resolver
          @model_provider = model_provider
        end

        def onElementAdded(_entities, entity)
          return unless entity
          return if @duplicate_resolver.suppressed?

          model = @model_provider ? @model_provider.call : (entity.respond_to?(:model) ? entity.model : nil)
          return unless model

          @duplicate_resolver.resolve_observed_addition(model, entity)
        rescue StandardError => _e
          # Observer callbacks must never bubble unhandled exceptions into the SketchUp host.
          nil
        end
      end
    end
  end
end
