# frozen_string_literal: true

# Selector nativo de acabados: payload inicial, apply, refresh de media.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      module OptionSelectorBridge # rubocop:disable Metrics/ModuleLength
        HARDWARE_CATEGORY_LABELS = {
          'hinge' => 'Bisagras',
          'slide' => 'Correderas',
          'handle' => 'Jaladeras y Tiradores',
          'leg' => 'Patas',
          'fastener' => 'Fijaciones',
          'other' => 'Otros herrajes'
        }.freeze

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
            context: params[:context],
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

        # #1178-inspector: floating hardware model selector matching the
        # visual and UX pattern of the finishes selector (same 960×620 window,
        # search, categories, large preview inspector).
        def handle_open_hardware_selector(dialog, payload_json)
          payload = payload_json.is_a?(String) ? JSON.parse(payload_json) : (payload_json || {})
          params = extract_hardware_params(payload)
          formatted_hardware, raw_hardware = selector_allowed_hardware(params[:allowed_ids])
          categories = selector_hardware_categories(formatted_hardware)

          open_hardware_dialog(dialog, params, formatted_hardware, raw_hardware, categories)
        rescue StandardError => e
          @logger&.error('open_hardware_selector_failed', error: e)
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

          target_role = params[:role].to_s
          from_def = definition_role_material_ids(params[:definition_id], target_role)
          return from_def if from_def

          aggregate_catalog_role_material_ids(target_role)
        end

        def definition_role_material_ids(definition_id, target_role)
          return nil unless definition_id && @catalog_provider.respond_to?(:find_definition)

          definition = @catalog_provider.find_definition(definition_id)
          return nil unless definition

          roles = definition['materialRoles'] || definition[:materialRoles] || []
          entry = roles.find { |r| match_role_names?(r['role'] || r[:role], target_role) }
          ids = entry ? (entry['optionIds'] || entry[:optionIds]) : nil
          ids && !ids.empty? ? ids : nil
        end

        def aggregate_catalog_role_material_ids(target_role)
          return nil unless @catalog_provider.respond_to?(:all_definitions) && !target_role.empty?

          collected = []
          (@catalog_provider.all_definitions || []).each do |defn|
            roles = defn['materialRoles'] || defn[:materialRoles] || []
            roles.each do |role_entry|
              next unless match_role_names?(role_entry['role'] || role_entry[:role], target_role)

              opts = role_entry['optionIds'] || role_entry[:optionIds] || []
              opts.each { |opt| collected << opt unless collected.include?(opt) }
            end
          end
          collected.empty? ? nil : collected
        end

        def match_role_names?(role_a, role_b)
          return false if role_a.nil? || role_b.nil?

          first = role_a.to_s.strip.upcase
          second = role_b.to_s.strip.upcase
          return true if first == second
          return true if (first == 'FRENTE' && second == 'FRENTES') ||
                         (first == 'FRENTES' && second == 'FRENTE')
          return true if (first == 'INTERIOR' && second == 'INTERIORES') ||
                         (first == 'INTERIORES' && second == 'INTERIOR')

          false
        end

        def selector_categories
          @catalog_provider.respond_to?(:all_material_categories) ? @catalog_provider.all_material_categories : []
        end

        def extract_hardware_params(payload)
          code = payload['groupCode'] || payload[:groupCode] || payload['code']
          name = payload['groupName'] || payload[:groupName] || payload['name'] || code
          current_id = payload['currentHardwareId'] || payload[:currentHardwareId]
          allowed = payload['optionIds'] || payload[:optionIds] || []
          {
            group_code: code,
            group_name: name,
            current_id: current_id,
            allowed_ids: allowed,
            context: payload['context']
          }
        end

        def selector_allowed_hardware(allowed_ids)
          all_hw = @catalog_provider.respond_to?(:all_hardware) ? @catalog_provider.all_hardware : []
          raw = if allowed_ids.is_a?(Array) && !allowed_ids.empty?
                  all_hw.select { |hw| allowed_ids.include?(hw['id']) || allowed_ids.include?(hw['code']) }
                else
                  all_hw
                end

          formatted = raw.map do |hw|
            {
              'id' => hw['id'],
              'materialId' => hw['id'],
              'code' => hw['code'],
              'name' => hw['name'] || hw['code'],
              'category' => hw['category'],
              'categoryLabel' => hardware_category_label(hw['category']),
              'unit' => hw['unit'],
              'unitLabel' => hardware_unit_label(hw['unit']),
              'notes' => hw['notes'] || hw['description'],
              'imageUrl' => hw['imageUrl'] || hw['image_url'] || hw['thumbnailUrl'] || hw['previewUrl'],
              'kind' => 'hardware'
            }
          end
          [formatted, raw]
        end

        def open_hardware_dialog(dialog, params, formatted_hardware, raw_hardware, categories)
          option_selector.show_selector(
            role: params[:group_code],
            role_name: params[:group_name],
            current_material_id: params[:current_id],
            allowed_materials: formatted_hardware,
            categories: categories,
            context: params[:context],
            kind: 'hardware',
            title: 'Catálogo de Herrajes — Granete',
            media: media_authorizer.media_payload_for('hardware' => raw_hardware),
            media_refresher: ->(filename) { media_authorizer.refresh_url(filename) },
            on_apply: lambda do |selected_group, selected_hw_id, _scope, _context|
              execute_bridge(dialog, 'onHardwareChoiceApplied', {
                               'groupCode' => selected_group,
                               'hardwareId' => selected_hw_id
                             })
            end
          )
        end

        def hardware_category_label(cat)
          HARDWARE_CATEGORY_LABELS[cat.to_s.downcase] || (cat ? cat.to_s.capitalize : 'Herraje')
        end

        def hardware_unit_label(unit)
          case unit.to_s.downcase
          when 'piece' then 'por unidad'
          when 'set' then 'por juego'
          when 'm' then 'por metro'
          else unit.to_s
          end
        end

        def selector_hardware_categories(hardware_list)
          groups = hardware_list.group_by { |hw| hw['category'] || 'other' }
          return [] if groups.keys.length <= 1

          groups.map do |cat_code, _items|
            {
              'id' => cat_code,
              'name' => hardware_category_label(cat_code),
              'level' => 1
            }
          end
        end
      end

      # Contextual-inspector callback handlers (#476): breadcrumb navigation
      # back to the owning furniture. View state only.
    end
  end
end
