# frozen_string_literal: true

# Observers de selección/entidades y su ciclo de attach/detach.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module ObserverBridge
        def handle_host_model_event(event, model)
          return unless model.equal?(active_model)

          rebind_model(model) if event == :model_changed && @dialog&.visible?
          push_host_save_awareness(@dialog) if @dialog&.visible?
          refresh_binding_status if event == :saved && @dialog&.visible?
          refresh_project_furniture if event == :saved
        rescue StandardError => e
          @logger.error('host_model_event_failed', error: e)
        end

        def push_host_save_awareness(dialog)
          return unless @save_awareness && dialog&.visible?

          execute_bridge(dialog, 'onHostSaveAwareness', @save_awareness.projection(active_model))
        end

        def handle_selection_change(context)
          return unless @dialog&.visible?

          payload = context.respond_to?(:to_payload) ? context.to_payload : context
          execute_bridge(@dialog, 'onSelectionChange', payload)
          # #470: a live inspection overlay follows the selection — a part
          # change re-scopes it, an unmanaged selection clears it honestly.
          rescope_overlay_from_selection(payload)
        rescue StandardError => e
          @logger.error('selection_change_failed', error: e)
        end

        def check_current_selection(dialog)
          selection = (@observed_model || active_model)&.selection
          context = @selection_observer.resolve(selection&.first, selection: selection)
          execute_bridge(dialog, 'onSelectionChange', context && context.to_payload)
        end

        def attach_selection_observer
          @observed_model = active_model
          attach_model_observers(@observed_model)
          attach_app_observer
        end

        def detach_selection_observer
          detach_model_observers(@observed_model)
          @observed_model = nil
          detach_app_observer
        end

        def rebind_model(new_model)
          return if @observed_model.equal?(new_model)

          detach_model_observers(@observed_model)
          @observed_model = new_model
          attach_model_observers(@observed_model)
          @builder_model = nil
          check_current_selection(@dialog) if @dialog&.visible?
          refresh_binding_status
          # The Project Furniture panel follows the binding of whichever
          # model is active (#389): switching documents refreshes its rows.
          refresh_project_furniture
          offer_migration_if_legacy(new_model)
          @duplicate_resolver&.rescan_and_resolve(new_model)
        end

        def attach_model_observers(target_model)
          return unless target_model

          target_model.selection&.add_observer(@selection_observer)
          target_model.entities&.add_observer(@entities_observer) if @entities_observer
          @position_sync_coordinator&.rebind(target_model)
        end

        def detach_model_observers(target_model)
          return unless target_model

          target_model.selection&.remove_observer(@selection_observer)
          target_model.entities&.remove_observer(@entities_observer) if @entities_observer
          @position_sync_coordinator&.detach
        end

        def attach_app_observer
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:add_observer)
          return if @app_observer

          @app_observer = AppModelObserver.new(on_model_change: method(:rebind_model))
          ::Sketchup.add_observer(@app_observer)
        end

        def detach_app_observer
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:remove_observer) && @app_observer

          ::Sketchup.remove_observer(@app_observer)
          @app_observer = nil
        end
      end

      # Read-only manufacturing inspection bridge (#470 / SU-VIS-1): the
      # `Ver fabricación` mode. Commands arrive through the versioned
      # inspection channel (CommandContract manufacturing_command) and state
      # leaves through manufacturing_state envelopes. The overlay itself is
      # view state only — no operation, no entity, no metadata write — and
      # its only machining truth is the accepted authoring resolve.
    end
  end
end
