# frozen_string_literal: true

# Selección → payload canónico del Inspector (resolve + context).
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module InspectorBridge
        FURNITURE_KINDS = %w[furnitureInstance bootstrapIntent].freeze

        def handle_select_furniture(dialog, raw_payload = nil)
          payload = parse_payload(raw_payload)
          # The breadcrumb locates the host by its LOCAL ref — never by the
          # future server business ID (#384), which nothing owns yet.
          instance_ref = payload['furnitureInstanceRef'] || payload['instanceId']
          model = active_model
          target = instance_ref && search_entities_for_instance(instance_ref)

          if model && target && furniture_metadata?(model, target)
            select_entity(model, target)
            # Review #847: selecting alone can leave the panel in Biblioteca
            # (activeLibDef preserves the configurator). The explicit intent
            # of "editar en el panel" carries its own tab activation.
            execute_bridge(dialog, 'activateInspectorTab', {})
            @logger.info('inspector_select_furniture', instance_ref: instance_ref)
          else
            @logger.warn('inspector_select_furniture_rejected',
                         instance_ref: instance_ref)
          end
        rescue StandardError => e
          @logger.error('inspector_select_furniture_failed', error: e)
        end

        private

        def parse_payload(raw_payload)
          if raw_payload.is_a?(String) && !raw_payload.strip.empty?
            JSON.parse(raw_payload)
          else
            raw_payload || {}
          end
        end

        # Only a furniture occurrence may be selected as furniture: a part or
        # hardware id must never retarget the breadcrumb as its own owner.
        def furniture_metadata?(model, target)
          store = @metadata_store_factory.call(model)
          metadata = store.read(target)
          FURNITURE_KINDS.include?(metadata && metadata['kind'])
        rescue Metadata::InvalidMetadataError
          false
        end

        # Selecting is viewport view state: no SketchUp operation, no
        # metadata mutation — the selection observer then publishes the
        # furniture SelectionContext.
        def select_entity(model, target)
          selection = model.selection
          selection.clear
          selection.add(target)
        end
      end

      # Observes SketchUp application events (new, open, activate model) to re-bind
      # selection observers when the user switches documents.
    end
  end
end
