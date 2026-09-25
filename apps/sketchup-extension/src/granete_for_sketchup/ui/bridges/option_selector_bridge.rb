# frozen_string_literal: true

# Selector nativo de acabados: payload inicial, apply, refresh de media.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module OptionSelectorBridge
        def handle_open_material_selector(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          params = extract_selector_params(payload)
          allowed_materials = selector_allowed_materials(params)
          categories = selector_categories

          option_selector.show_selector(
            role: params[:role],
            role_name: params[:role_name],
            current_material_id: params[:current_material_id],
            allowed_materials: allowed_materials,
            categories: categories,
            media: media_authorizer.media_payload_for(
              'materials' => allowed_materials, 'categories' => categories
            ),
            media_refresher: ->(filename) { media_authorizer.refresh_url(filename) },
            on_apply: lambda do |selected_role, selected_material_id, scope|
              execute_bridge(dialog, 'onMaterialChoiceApplied', {
                               'role' => selected_role,
                               'materialId' => selected_material_id,
                               'scope' => scope,
                               'context' => params[:context],
                               'instanceId' => params[:instance_id],
                               'definitionId' => params[:definition_id]
                             })
            end
          )
        rescue StandardError => e
          @logger&.error('open_material_selector_failed', error: e)
        end

        private

        def extract_selector_params(payload)
          mat_id = payload['currentMaterialId'] || payload[:currentMaterialId] ||
                   payload['current_material_id'] || payload[:current_material_id]
          allowed_ids = payload['allowedMaterialIds'] || payload[:allowedMaterialIds] ||
                        payload['optionIds'] || payload[:optionIds]
          {
            role: payload['role'] || payload[:role],
            role_name: payload['roleName'] || payload[:roleName] || payload['role_name'] || payload[:role_name],
            current_material_id: mat_id,
            context: payload['context'] || payload[:context],
            instance_id: payload['instanceId'] || payload[:instanceId],
            definition_id: payload['definitionId'] || payload[:definitionId],
            allowed_material_ids: allowed_ids
          }
        end

        def selector_allowed_materials(params)
          all = @catalog_provider.respond_to?(:all_materials) ? @catalog_provider.all_materials : []
          filter_ids = resolve_allowed_material_ids(params)
          return all if filter_ids.nil? || filter_ids.empty?

          all.select do |mat|
            mat_id = mat['materialId'] || mat[:materialId] || mat['id'] || mat[:id]
            filter_ids.include?(mat_id)
          end
        end

        def resolve_allowed_material_ids(params)
          if params[:allowed_material_ids].is_a?(Array) && !params[:allowed_material_ids].empty?
            return params[:allowed_material_ids]
          end

          return nil unless params[:definition_id] && params[:role] && @catalog_provider.respond_to?(:find_definition)

          definition = @catalog_provider.find_definition(params[:definition_id])
          return nil unless definition

          roles = definition['materialRoles'] || definition[:materialRoles] || []
          role_entry = roles.find { |r| (r['role'] || r[:role]) == params[:role] }
          role_entry ? (role_entry['optionIds'] || role_entry[:optionIds]) : nil
        end

        def selector_categories
          @catalog_provider.respond_to?(:all_material_categories) ? @catalog_provider.all_material_categories : []
        end
      end

      # Contextual-inspector callback handlers (#476): breadcrumb navigation
      # back to the owning furniture. View state only.
    end
  end
end
