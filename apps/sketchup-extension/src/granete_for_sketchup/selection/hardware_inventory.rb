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
