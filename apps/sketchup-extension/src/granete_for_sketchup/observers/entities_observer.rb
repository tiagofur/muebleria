# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Observers
      # #391 / DT-7 EntitiesObserver: detects when managed furniture instances
      # are added to the active model (via Move+Copy or Copy/Paste) and dispatches
      # duplicate resolution to the DuplicateResolver.
      class EntitiesObserver < (defined?(::Sketchup::EntitiesObserver) ? ::Sketchup::EntitiesObserver : Object)
        attr_writer :on_working_copy_committed, :on_host_inventory_changed

        def initialize(duplicate_resolver:, model_provider: nil, on_working_copy_committed: nil,
                       on_host_inventory_changed: nil)
          super() if defined?(::Sketchup::EntitiesObserver)
          @duplicate_resolver = duplicate_resolver
          @model_provider = model_provider
          @on_working_copy_committed = on_working_copy_committed
          @on_host_inventory_changed = on_host_inventory_changed
          @inventory_refresh_pending = false
        end

        def onElementAdded(_entities, entity)
          return unless entity
          return if @duplicate_resolver.suppressed?

          model = if @model_provider
                    @model_provider.call
                  else
                    (entity.respond_to?(:model) ? entity.model : nil)
                  end
          return unless model

          result = @duplicate_resolver.resolve_observed_addition(model, entity)
          @on_working_copy_committed&.call if result.is_a?(Hash) && result['ok']
        rescue StandardError => _e
          # Observer callbacks must never bubble unhandled exceptions into the SketchUp host.
          nil
        end

        # SketchUp supplies only the removed entity id here, after its
        # metadata is no longer safely readable. Reconcile the whole bounded
        # top-level inventory instead of guessing which business id changed.
        def onElementRemoved(_entities, _entity_id)
          return if @inventory_refresh_pending

          @inventory_refresh_pending = true
          if defined?(::UI) && ::UI.respond_to?(:start_timer)
            ::UI.start_timer(0, false) { dispatch_inventory_change }
          else
            dispatch_inventory_change
          end
        rescue StandardError
          @inventory_refresh_pending = false
          nil
        end

        private

        def dispatch_inventory_change
          @on_host_inventory_changed&.call
        ensure
          @inventory_refresh_pending = false
        end
      end
    end
  end
end
