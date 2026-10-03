# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Discovers the opening door actors of one managed furniture occurrence
      # from MANAGED METADATA ONLY (#529): part entities whose placement slot
      # is 'puerta' or whose role names a door/front. Hardware siblings are
      # grouped by their structured host binding so the presentation adapter
      # can move hinges/handles solidary with the front — the card never
      # lists them (owner decision: this view is doors + pose only). Never
      # inspects display names, geometry or array order for identity.
      #
      # Shared by the Selection::Resolver (publishes doorActors slot indexes
      # on the furniture payload so the Inspector card can render Abrir /
      # Cerrar) and by the InspectorBridge (feeds PresentationMotionAdapter).
      # Corrupt metadata on a child fails closed for that child (skipped),
      # never for the scan.
      module DoorActors
        # doors: part entities acting as opening fronts, in slot order.
        # hardware_by_host: host id => raw hardware entities (adapter input).
        DoorActorSet = Struct.new(:doors, :hardware_by_host)

        module_function

        def scan(furniture_entity, metadata_store)
          doors = []
          hardware_by_host = Hash.new { |h, k| h[k] = [] }
          has_children = furniture_entity.respond_to?(:definition) &&
                         furniture_entity.definition.respond_to?(:entities)
          return DoorActorSet.new(doors, hardware_by_host) unless has_children

          furniture_entity.definition.entities.each do |child|
            next unless child.respond_to?(:get_attribute)

            meta = read_metadata(metadata_store, child)
            next unless meta

            categorize(meta, child, doors, hardware_by_host)
          end

          DoorActorSet.new(doors, hardware_by_host)
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

        # A door actor is EXACTLY a door slot — placement 'puerta' (local
        # vocabulary) or 'door' (pilot vocabulary), or the explicit door role.
        # Substring matching is forbidden: 'FRENTE_CAJON' and 'FRENTE' contain
        # 'frente' but a drawer front / plain front must NEVER become a door
        # actor (over-detection also shifts slot indexes and flips the swing
        # convention of the real doors).
        def door_like?(placement, role)
          %w[puerta door].include?(placement) || role == 'door'
        end
      end
    end
  end
end
