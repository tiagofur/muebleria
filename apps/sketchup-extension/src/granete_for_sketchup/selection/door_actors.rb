# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Discovers the opening door actors of one managed furniture occurrence
      # from MANAGED METADATA ONLY (#529): part entities whose placement slot
      # is 'puerta' or whose role names a door/front. Hardware siblings are
      # grouped by their structured host binding so the presentation adapter
      # can move hinges/handles solidary with the front. Never inspects
      # display names, geometry or array order for identity.
      #
      # Shared by the Selection::Resolver (publishes doorActors on the
      # furniture payload so the Inspector card can render Abrir/Cerrar plus
      # the per-door hardware list) and by the InspectorBridge (feeds
      # PresentationMotionAdapter and select_hardware navigation). Corrupt
      # metadata on a child fails closed for that child (skipped), never for
      # the scan.
      module DoorActors
        # doors: part entities acting as opening fronts, in slot order.
        # hardware_by_host: host id => raw hardware entities (adapter input).
        # door_payloads: JSON-ready [{slotIndex, hardware: [{id, category}]}].
        DoorActorSet = Struct.new(:doors, :hardware_by_host, :door_payloads)

        module_function

        # catalog_hardware: optional proc hardware_id -> catalog hardware hash
        # (CatalogProvider#find_hardware) used to classify hinge vs handle.
        # Without it every mounted hardware classifies as 'other'.
        def scan(furniture_entity, metadata_store, catalog_hardware: nil)
          doors = []
          hardware_by_host = Hash.new { |h, k| h[k] = [] }
          unless furniture_entity.respond_to?(:definition) &&
                 furniture_entity.definition.respond_to?(:entities)
            return DoorActorSet.new(doors, hardware_by_host, [])
          end

          furniture_entity.definition.entities.each do |child|
            next unless child.respond_to?(:get_attribute)

            meta = read_metadata(metadata_store, child)
            next unless meta

            categorize(meta, child, doors, hardware_by_host)
          end

          payloads = build_payloads(doors, hardware_by_host, metadata_store, catalog_hardware)
          DoorActorSet.new(doors, hardware_by_host, payloads)
        end

        # Locates the raw hardware entity whose managed identity matches
        # hardware_id (instanceRef / hardwarePlacementId) — the select_hardware
        # navigation target. Identity from metadata, never from names.
        def find_hardware_entity(furniture_entity, metadata_store, hardware_id)
          return nil if hardware_id.nil? || hardware_id.to_s.empty?

          return nil unless furniture_entity.respond_to?(:definition) &&
                            furniture_entity.definition.respond_to?(:entities)

          furniture_entity.definition.entities.each do |child|
            next unless child.respond_to?(:get_attribute)

            meta = read_metadata(metadata_store, child)
            next unless meta

            intent = meta['intent'] || {}
            is_hardware = intent['entityClass'] == 'hardware' ||
                          (intent['entityClass'].nil? && intent['hostComponentInstanceId'])
            next unless is_hardware

            identity = meta['identity'] || {}
            child_id = identity['instanceRef'] || identity['hardwarePlacementId']
            return child if child_id == hardware_id
          end
          nil
        end

        def read_metadata(metadata_store, child)
          metadata_store.read(child)
        rescue StandardError
          nil
        end

        def categorize(meta, child, doors, hardware_by_host)
          intent = meta['intent'] || {}
          identity = meta['identity'] || {}
          child_id = identity['instanceRef'] || identity['componentInstanceId'] || identity['hardwarePlacementId']
          entity_class = intent['entityClass'] || (intent['hostComponentInstanceId'] ? 'hardware' : 'component')

          if entity_class == 'hardware'
            host_id = intent['hostComponentInstanceId']
            hardware_by_host[host_id] << child if host_id
          else
            role = (intent['role'] || intent['semanticRole'] || '').to_s.downcase
            placement = (intent['placement'] || '').to_s.downcase
            return unless door_like?(placement, role)

            doors << child
            hardware_by_host["door-comp-#{doors.size - 1}"] = hardware_by_host[child_id] if child_id
          end
        end

        def door_like?(placement, role)
          placement == 'puerta' || role.include?('door') || role.include?('frente') || role.include?('front')
        end

        def build_payloads(doors, hardware_by_host, metadata_store, catalog_hardware)
          doors.each_with_index.map do |_door, slot_index|
            mounted = hardware_by_host["door-comp-#{slot_index}"] || []
            {
              'slotIndex' => slot_index,
              'hardware' => mounted.map { |entity| hardware_payload(entity, metadata_store, catalog_hardware) }
            }
          end
        end

        def hardware_payload(entity, metadata_store, catalog_hardware)
          meta = read_metadata(metadata_store, entity) || {}
          identity = meta['identity'] || {}
          { 'id' => identity['instanceRef'] || identity['hardwarePlacementId'],
            'category' => classify_hardware(meta, catalog_hardware) }
        end

        # Hinge vs handle from the CATALOG category / preview shape — never
        # from names. Unknown or unresolvable hardware stays 'other'.
        def classify_hardware(meta, catalog_hardware)
          hardware_definition_id = (meta['intent'] || {})['hardwareDefinitionId']
          entry = catalog_hardware&.call(hardware_definition_id)
          shape = entry.is_a?(Hash) ? (entry['category'] || entry['previewShape']).to_s.downcase : ''
          return 'hinge' if shape == 'hinge'
          return 'handle' if %w[handle bar-pull cup-pull knob pull].include?(shape)

          'other'
        end
      end
    end
  end
end
