# frozen_string_literal: true

# Selección → payload canónico del Inspector (resolve + context).
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      # rubocop:disable-next Metrics/ModuleLength
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

        # #1261 — clears the host selection so the Inspector transitions to
        # the Design Inspector (handleNoSelection lane) where opening/defaults
        # can be configured directly from the furniture view.
        def handle_clear_selection(_dialog = nil)
          model = active_model
          model.selection.clear if model.respond_to?(:selection)
          @logger.info('inspector_clear_selection')
        rescue StandardError => e
          @logger.error('inspector_clear_selection_failed', error: e)
        end

        def handle_toggle_door_motion(dialog, raw_payload = nil)
          payload = parse_payload(raw_payload)
          slot_index = (payload['doorSlotIndex'] || 0).to_i
          instance_ref = payload['furnitureInstanceRef'] || payload['instanceId']
          swing_side = payload['swingSide'] || 'left'
          open_angle_deg = (payload['openAngleDeg'] || 110.0).to_f

          model = active_model
          target_furniture = (instance_ref && search_entities_for_instance(instance_ref)) ||
                             model&.selection&.first

          unless target_furniture && furniture_metadata?(model, target_furniture)
            @logger.warn('toggle_door_motion_no_furniture', instance_ref: instance_ref)
            execute_bridge(dialog, 'onDoorMotionFailed',
                           { 'message' => 'No se encontró el mueble; volvé a seleccionarlo en el ambiente.' })
            return
          end

          adapter = presentation_motion_adapter_for(target_furniture, open_angle_deg)
          motion_id = "door-slot-#{slot_index}"
          if adapter.motions.empty?
            @logger.warn('toggle_door_motion_no_doors', slot_index: slot_index)
            execute_bridge(dialog, 'onDoorMotionFailed',
                           { 'message' => 'Este mueble no tiene puertas para abrir.' })
            return
          end
          # The per-door side arrives with EVERY toggle (card convention /
          # authored data) — the cached adapter never freezes a side.
          is_open = adapter.toggle_motion(motion_id, swing_side)

          execute_bridge(dialog, 'onDoorMotionToggled', {
                           'doorSlotIndex' => slot_index,
                           'isOpen' => is_open
                         })
          @logger.info('toggle_door_motion_executed', slot_index: slot_index, isOpen: is_open)
        rescue StandardError => e
          @logger.error('toggle_door_motion_failed', error: e)
          execute_bridge(dialog, 'onDoorMotionFailed',
                         { 'message' => 'La apertura no se aplicó; se reconstruyó la vista. Probá de nuevo.' })
        end

        def handle_close_all_doors(dialog, _raw_payload = nil)
          any_failed = false
          (@motion_adapters || {}).each do |key, adapter|
            any_failed = true if close_all_adapter_safely(key, adapter)
          end
          if any_failed
            # Partial failure: the doors that did close stay closed, but the
            # open ones keep their real pose — announcing onAllDoorsClosed
            # would desync the JS buttons from the model. The existing door
            # motion failure callback shows the Spanish toast.
            execute_bridge(dialog, 'onDoorMotionFailed',
                           { 'message' => 'No todas las puertas se cerraron; probá de nuevo.' })
            return
          end
          execute_bridge(dialog, 'onAllDoorsClosed', {})
          @logger.info('close_all_doors_executed')
        rescue StandardError => e
          @logger.error('close_all_doors_failed', error: e)
          execute_bridge(dialog, 'onDoorMotionFailed',
                         { 'message' => 'No se pudieron cerrar las puertas; probá de nuevo.' })
        end

        private

        # One adapter's exception must not abort the rest of the sweep:
        # the remaining adapters still close, and the caller hears back
        # either way. Returns true when the adapter failed.
        def close_all_adapter_safely(_key, adapter)
          adapter.close_all if adapter.entities_valid?
          false
        rescue StandardError => e
          @logger.error('close_all_doors_adapter_failed', error: e)
          true
        end

        def presentation_motion_adapter_for(furniture_entity, open_angle_deg)
          @motion_adapters ||= {}
          key = furniture_key(furniture_entity)
          adapter = @motion_adapters[key]
          # A rebuild (Inspector apply, #1387) deletes the door entities the
          # cached adapter tracks: reuse only a cache over living entities.
          return adapter if adapter&.entities_valid?

          door_entities, hardware_by_host = inspect_furniture_door_actors(furniture_entity)
          motions = []
          component_map = {}

          door_entities.each_with_index do |door, idx|
            motion_id = "door-slot-#{idx}"
            comp_id = "door-comp-#{idx}"
            component_map[comp_id] = door

            motions << {
              'id' => motion_id,
              'doorSlotIndex' => idx,
              'componentInstanceIds' => [comp_id],
              'motion' => {
                'kind' => 'rotate',
                'openAngleDeg' => open_angle_deg,
                'axisLocal' => { 'x' => 0, 'y' => 0, 'z' => 1 }
              }
            }
          end

          adapter = Motion::PresentationMotionAdapter.new(motions, component_map, hardware_by_host)
          @motion_adapters[key] = adapter
          adapter
        end

        def furniture_key(furniture_entity)
          furniture_entity.respond_to?(:persistent_id) ? furniture_entity.persistent_id : furniture_entity.object_id
        end

        def inspect_furniture_door_actors(furniture_entity)
          scanned = Selection::DoorActors.scan(furniture_entity, @metadata_store_factory.call(active_model))
          [scanned.doors, scanned.hardware_by_host]
        end

        def parse_payload(raw_payload)
          if raw_payload.is_a?(String) && !raw_payload.strip.empty?
            JSON.parse(raw_payload)
          else
            raw_payload || {}
          end
        end

        # The sample hardware occurrence of one inventory row: the child of
        # the named furniture occurrence whose managed identity carries the
        # hardwarePlacementId. Metadata only — never names or geometry.
        def find_hardware_child(furniture_entity, placement_id)
          return nil unless placement_id && furniture_entity.respond_to?(:definition) &&
                            furniture_entity.definition.respond_to?(:entities)

          store = @metadata_store_factory.call(active_model)
          furniture_entity.definition.entities.find do |child|
            meta = store.read(child)
            identity = meta&.dig('identity') || {}
            identity['hardwarePlacementId'] == placement_id
          rescue StandardError
            false
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
