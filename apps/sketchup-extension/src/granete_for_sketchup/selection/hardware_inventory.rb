# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Project hardware inventory (#1046 S2): what hardware REALLY exists in
      # the model, grouped by catalog definition and furniture occurrence.
      # The Inspector's no-selection lane lists ONLY this — never the whole
      # catalog (owner rule: no correderas in a project without drawers).
      #
      # Discovered from MANAGED METADATA ONLY, the same contract as
      # DoorActors.scan: children whose intent entityClass is 'hardware'
      # inside managed furniture occurrences. Corrupt metadata on a child or
      # a furniture occurrence fails closed for that entity (skipped), never
      # for the scan. An entry without a catalog hardwareDefinitionId stays
      # out (no identity → no selectable row); each entry carries ONE sample
      # occurrence (furniture ref + placement id) so the UI can select it.
      module HardwareInventory
        # Member names deliberately avoid Struct built-ins (:count/:entries
        # would override Struct#count/#entries — rubocop Lint/StructNewOverride).
        Entry = Struct.new(:hardware_definition_id, :furniture_instance_ref,
                           :hardware_placement_id, :occurrences, keyword_init: true)
        InventorySet = Struct.new(:items)

        module_function

        def scan(model, metadata_store)
          entries = []
          return InventorySet.new(entries) unless model.active_entities.respond_to?(:each)

          seen = {}
          # model.entities on purpose: the inventory reads the model ROOT
          # occurrences (managed furniture is inserted at root), never the
          # active editing path. The cop's suggestion is noted and declined.
          model.entities.each do |entity| # rubocop:disable SketchupSuggestions/ModelEntities
            furniture_ref = managed_furniture_ref(metadata_store, entity)
            next unless furniture_ref

            scan_furniture_children(metadata_store, entity, furniture_ref, entries, seen)
          end
          entries.sort_by! { |e| [e.hardware_definition_id.to_s, e.furniture_instance_ref.to_s] }
          InventorySet.new(entries)
        end

        def read_metadata(metadata_store, entity)
          metadata_store.read(entity)
        rescue StandardError
          nil
        end

        # Only a managed furniture occurrence hosts inventory. The kind
        # vocabulary mirrors InspectorBridge::FURNITURE_KINDS; the ref is the
        # local instanceRef locator (the same contract the breadcrumb uses —
        # never a server business id).
        def managed_furniture_ref(metadata_store, entity)
          return nil unless entity.respond_to?(:definition) &&
                            entity.definition.respond_to?(:entities)

          meta = read_metadata(metadata_store, entity)
          return nil unless meta
          return nil unless %w[furnitureInstance bootstrapIntent].include?(meta['kind'])

          identity = meta['identity'] || {}
          identity['instanceRef']
        end

        # #1046 S3 + #1258: hardware option groups ONE furniture offers in
        # the mueble card — the UNION of two sources:
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
        def groups_for_furniture(metadata_store, entity, definition_roles: [], item_choices: {})
          placed = scan_placed_groups(metadata_store, entity)
          out = role_group_rows(Array(definition_roles), placed, item_choices)
          out.concat(placed_only_rows(placed, out.map { |row| row['code'] }))
        end

        # Managed-children scan: code => { 'chosenHardwareId' => first placed
        # concrete, 'count' => occurrences }. Corrupt metadata fails closed
        # per child (the group stays out), never for the whole scan.
        def scan_placed_groups(metadata_store, entity)
          placed = {}
          return placed unless entity.respond_to?(:definition) && entity.definition.respond_to?(:entities)

          entity.definition.entities.each do |child|
            child_meta = read_metadata(metadata_store, child)
            next unless child_meta

            intent = child_meta['intent'] || {}
            next unless intent['entityClass'] == 'hardware'

            code = intent['optionRole'].to_s.strip
            hardware_id = intent['hardwareDefinitionId'].to_s.strip
            next if code.empty? || hardware_id.empty?

            group = (placed[code] ||= { 'chosenHardwareId' => hardware_id, 'count' => 0 })
            group['count'] += 1
          end
          placed
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
          (placed.keys - listed_codes).sort.map do |code|
            { 'code' => code,
              'chosenHardwareId' => placed[code]['chosenHardwareId'],
              'count' => placed[code]['count'] }
          end
        end

        def scan_furniture_children(metadata_store, entity, furniture_ref, entries, seen)
          entity.definition.entities.each do |child|
            child_meta = read_metadata(metadata_store, child)
            next unless child_meta

            intent = child_meta['intent'] || {}
            next unless intent['entityClass'] == 'hardware'

            hardware_id = intent['hardwareDefinitionId'].to_s.strip
            next if hardware_id.empty?

            identity = child_meta['identity'] || {}
            placement_id = identity['hardwarePlacementId'] || identity['instanceRef']
            key = [hardware_id, furniture_ref]
            if seen[key]
              seen[key].occurrences += 1
            else
              entry = Entry.new(hardware_definition_id: hardware_id,
                                furniture_instance_ref: furniture_ref,
                                hardware_placement_id: placement_id,
                                occurrences: 1)
              seen[key] = entry
              entries << entry
            end
          end
        end
      end
    end
  end
end
