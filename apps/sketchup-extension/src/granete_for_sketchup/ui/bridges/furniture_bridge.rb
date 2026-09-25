# frozen_string_literal: true

# CRUD de muebles: insert/update/delete + menú contextual de selección gestionada.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module FurnitureBridge
        # Shared texture cache for furniture builders: lives in the bridge so
        # the controller class stays within its length budget (file pattern).
        def texture_cache
          return @texture_cache if @texture_cache

          transport = @session&.transport
          auth_provider = @session
          @texture_cache = Assets::TextureCache.new(
            transport: transport,
            auth_provider: auth_provider
          )
        end

        def handle_insert(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : payload_json
          definition = @catalog_provider.find_definition(payload['definitionId'])

          result = if definition.nil?
                     { 'success' => false, 'error' => 'Definición no encontrada' }
                   elsif active_model
                     furniture_builder_for(active_model).insert_furniture(
                       active_model, definition, payload['parameters'] || {},
                       resolved_layout: resolve_layout_for(definition, payload['parameters'],
                                                           payload['materialChoices']),
                       material_choices: payload['materialChoices']
                     )
                   else
                     mock_result(definition['name'], payload['parameters'])
                   end

          execute_bridge(dialog, 'onInsertionResult', result)
          log_operation_result('furniture_inserted', payload['definitionId'], result)
        rescue StandardError => e
          @logger.error('furniture_insert_failed', error: e)
          payload = e.respond_to?(:issues) ? authoring_error_payload(e) : { 'success' => false, 'error' => e.message }
          execute_bridge(dialog, 'onInsertionResult', payload)
        end

        def handle_update(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          execute_coordinated_update(dialog, payload, command_message_id: payload['messageId'])
        end

        # A selector changes one role, while the server must resolve the whole
        # furniture with the complete accepted authoring intent. Preserve every
        # persisted role that was not included in this edit; never make an omitted
        # role silently fall back to nominal geometry.
        def merged_material_choices(target_entity, payload)
          store = @metadata_store_factory.call(active_model)
          persisted = store.read(target_entity)&.dig('intent', 'materialChoices') || {}
          requested = payload['materialChoices'] || payload[:materialChoices] || {}
          unless persisted.is_a?(Hash) && requested.is_a?(Hash)
            raise ArgumentError, 'materialChoices debe ser un objeto role → materialId'
          end

          persisted.merge(requested)
        end

        def find_target_furniture_entity(instance_id)
          return nil unless active_model

          first = active_model.selection&.first
          if instance_id
            if first
              meta = @metadata_store_factory.call(active_model).read(first)
              return first if meta&.dig('identity', 'instanceRef') == instance_id
            end
            return search_entities_for_instance(instance_id)
          end

          first
        end

        def search_entities_for_instance(instance_id)
          return nil unless instance_id && active_model.respond_to?(:entities)

          store = @metadata_store_factory.call(active_model)
          active_model.entities.find do |entity|
            meta = store.read(entity)
            meta&.dig('identity', 'instanceRef') == instance_id
          end
        end

        def log_operation_result(event, definition_id, result)
          ctx = {
            definition_id: definition_id,
            success: result['success'],
            components: result['component_count']
          }
          ctx[:error] = result['error'] unless result['success']
          @logger.info(event, ctx)
        end

        # Fetches the server-resolved composition for a definition at the
        # dialog's current parameters and board choices (role → material id),
        # parsed through the authoritative #414 transform contract. Granete
        # resolves the real furniture (boards + hardware); nil falls back to
        # the generic authoring path (offline/static catalogs). A server body
        # the contract parser rejects fails loudly — never a local AABB guess.
        def resolve_layout_for(definition, parameters, material_choices = nil)
          return nil unless @catalog_provider.respond_to?(:resolved_native_layout)

          @catalog_provider.resolved_native_layout(definition['furniture_definition_id'],
                                                   parameters || {}, material_choices || {})
        end

        def mock_result(name, params, instance_id = 'mock-inst-01')
          { 'success' => true, 'instance_id' => instance_id, 'name' => name,
            'parameters' => params }
        end

        def authoring_error_payload(error)
          issues = error.issues.map do |issue|
            {
              'code' => issue.code,
              'message' => issue.message,
              'severity' => issue.severity,
              'path' => issue.path,
              'details' => issue.details
            }.compact
          end
          { 'success' => false, 'error' => error.message, 'issues' => issues }
        end
      end # rubocop:enable Metrics/ModuleLength

      # Material finish picker bridge for opening the dedicated floating dialog.
    end
  end
end
