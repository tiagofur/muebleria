# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # #1046 S3 + #1258 + #1482: hardware option groups ONE furniture offers
      # in the mueble card — the UNION of two sources:
      #   - definition_roles: the definition's consumed hardware roles (the
      #     same workshop projection the Configurator offers pre-insert).
      #     A group stays selectable even when nothing is placed in the
      #     model: cost-only hardware (no preview shape/asset) renders
      #     nothing but still demands a choice.
      #   - the managed children scan: each hardware child whose intent
      #     carries optionRole contributes its group, the placed concrete
      #     hardwareDefinitionId and the real occurrence count. Corrupt
      #     metadata fails closed per child (the group stays out), never
      #     for the whole scan.
      # chosenHardwareId is the item's explicit choice (it rides the same
      # materialChoices map, #1153), falling back to the placed concrete.
      # Roles render in projection order; placed-only groups (stale or
      # manual roles the projection no longer lists) follow sorted by code.
      # Result rows are presentation hashes for the SelectionContext
      # payload: { 'code' => code, 'chosenHardwareId' => id, 'count' => n }.
      module HardwareOptionGroups
        module_function

        def groups_for_furniture(metadata_store, entity, definition_roles: [], item_choices: {})
          placed = scan_placed_groups(metadata_store, entity)
          match_agregado_roles!(placed, definition_roles)

          out = role_group_rows(Array(definition_roles), placed, item_choices)
          out.concat(placed_only_rows(placed, out.map { |row| row['code'] }))
        end

        # Match placed agregados with definition agregado roles (#1482): a
        # definition role adopts the placed agregado group's concrete choice
        # and instance count under the role's own code.
        def match_agregado_roles!(placed, definition_roles)
          Array(definition_roles).each do |role|
            next unless role.is_a?(Hash)

            code = role['code'].to_s.strip
            next if code.empty? || placed.key?(code)

            allowed = Array(role['optionIds'])
            matched_key = allowed.map { |id| "__agr__#{id}" }.find { |k| placed.key?(k) }
            next unless matched_key

            agr_info = placed[matched_key]
            placed[code] = {
              'chosenHardwareId' => agr_info['chosenHardwareId'],
              'count' => agr_info['instances'] ? agr_info['instances'].size : 1
            }
          end
        end

        # Managed-children scan: code => { 'chosenHardwareId' => first placed
        # concrete, 'count' => occurrences }. Corrupt metadata fails closed
        # per child (the group stays out), never for the whole scan.
        def scan_placed_groups(metadata_store, entity)
          placed = {}
          return placed unless entity.respond_to?(:definition) && entity.definition.respond_to?(:entities)

          entity.definition.entities.each do |child|
            child_meta = HardwareInventory.read_metadata(metadata_store, child)
            next unless child_meta

            scan_hardware_group(placed, child_meta)
            scan_agregado_group(placed, child_meta)
          end
          placed
        end

        def scan_hardware_group(placed, child_meta)
          intent = child_meta['intent'] || {}
          return unless intent['entityClass'] == 'hardware'

          code = intent['optionRole'].to_s.strip
          hardware_id = intent['hardwareDefinitionId'].to_s.strip
          return if code.empty? || hardware_id.empty?

          group = (placed[code] ||= { 'chosenHardwareId' => hardware_id, 'count' => 0 })
          group['count'] += 1
        end

        # Agregado assembly children (#1482): carry agregadoId and assemblyInstanceId.
        def scan_agregado_group(placed, child_meta)
          intent = child_meta['intent'] || {}
          identity = child_meta['identity'] || {}
          agr_id = (intent['agregadoId'] || identity['agregadoId']).to_s.strip
          asm_id = (intent['assemblyInstanceId'] || identity['assemblyInstanceId']).to_s.strip
          return if agr_id.empty? || asm_id.empty?

          agr_group = (placed["__agr__#{agr_id}"] ||= { 'chosenHardwareId' => agr_id, 'instances' => {} })
          agr_group['instances'][asm_id] = true
        end

        # One row per consumed definition role, in projection order. The
        # chosen hardware is the item's explicit choice (#1153) with the
        # placed concrete as fallback; the count is the placed reality.
        def role_group_rows(definition_roles, placed, item_choices)
          seen = {}
          definition_roles.filter_map do |role|
            next unless role.is_a?(Hash)

            code = role['code'].to_s.strip
            next if code.empty? || seen.key?(code)

            seen[code] = true
            chosen = item_choices[code].to_s.strip
            chosen = placed[code] ? placed[code]['chosenHardwareId'] : '' if chosen.empty?
            row = { 'code' => code }
            row['chosenHardwareId'] = chosen unless chosen.empty?
            row['count'] = placed[code]['count'] if placed[code]
            row
          end
        end

        # Placed groups the definition projection no longer lists (stale or
        # manual roles) stay visible, sorted by code — fail-visible, never
        # silently dropped from the card.
        def placed_only_rows(placed, listed_codes)
          (placed.keys - listed_codes).reject { |k| k.start_with?('__') }.sort.map do |code|
            { 'code' => code,
              'chosenHardwareId' => placed[code]['chosenHardwareId'],
              'count' => placed[code]['count'] }
          end
        end
      end
    end
  end
end
