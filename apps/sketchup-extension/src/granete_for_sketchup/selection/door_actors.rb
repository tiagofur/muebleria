# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Discovers the opening actors (doors and drawers) of one managed
      # furniture occurrence from MANAGED METADATA ONLY (#529 / #1377):
      # - Doors: part entities whose placement slot is 'puerta' or whose role
      #   names a door.
      # - Drawers: composed sub-assemblies clustering the drawer front,
      #   fabricated drawer box components (assemblyInstanceId), handles,
      #   and moving slide rails (actorMembership 'actor:drawer'). Fixed rails
      #   (actorMembership 'body') stay with the furniture body.
      # Never inspects display names or visual geometry for identity.
      #
      # Shared by the Selection::Resolver (publishes opening actors on the
      # furniture payload for the Inspector) and by the InspectorBridge (feeds
      # PresentationMotionAdapter). Corrupt child metadata fails closed for
      # that child (skipped), never for the scan.
      module DoorActors # rubocop:disable Metrics/ModuleLength
        # doors: part entities acting as opening fronts, in slot order.
        # hardware_by_host: host id => raw hardware entities (adapter input).
        # drawers: array of DrawerActorData sub-assemblies.
        DoorActorSet = Struct.new(:doors, :hardware_by_host, :drawers) do
          def initialize(doors = [], hardware_by_host = {}, drawers = [])
            super
          end
        end

        DrawerActorData = Struct.new(
          :id, :slot_index, :name, :components, :hardware, :distance_mm, :min_z,
          keyword_init: true
        )

        module_function

        def scan(furniture_entity, metadata_store)
          doors = []
          hardware_by_host = Hash.new { |h, k| h[k] = [] }
          drawer_fronts = []
          drawer_boxes = Hash.new { |h, k| h[k] = { components: [], hardware: [], min_z: Float::INFINITY } }

          has_children = furniture_entity.respond_to?(:definition) &&
                         furniture_entity.definition.respond_to?(:entities)
          return DoorActorSet.new(doors, hardware_by_host, []) unless has_children

          furniture_entity.definition.entities.each do |child|
            next unless child.respond_to?(:get_attribute)

            meta = read_metadata(metadata_store, child)
            next unless meta

            categorize(meta, child, doors, hardware_by_host, drawer_fronts, drawer_boxes)
          end

          drawers = build_drawers(drawer_fronts, drawer_boxes, hardware_by_host)
          DoorActorSet.new(doors, hardware_by_host, drawers)
        end

        def read_metadata(metadata_store, child)
          metadata_store.read(child)
        rescue StandardError
          nil
        end

        def categorize(meta, child, doors, hardware_by_host, drawer_fronts, drawer_boxes)
          intent = meta['intent'] || {}
          identity = meta['identity'] || {}
          child_id = identity['instanceRef'] || identity['componentInstanceId'] || identity['hardwarePlacementId']
          entity_class = intent['entityClass'] || (intent['hostComponentInstanceId'] ? 'hardware' : 'component')
          assembly_id = intent['assemblyInstanceId'] || identity['assemblyInstanceId']

          if entity_class == 'hardware'
            categorize_hardware(intent, identity, child, hardware_by_host, drawer_boxes, assembly_id)
          else
            categorize_component(
              intent, child_id, child, doors, hardware_by_host, drawer_fronts, drawer_boxes, assembly_id
            )
          end
        end

        def categorize_hardware(intent, identity, child, hardware_by_host, drawer_boxes, assembly_id)
          membership = (intent['actorMembership'] || identity['actorMembership']).to_s.strip
          return if membership == 'body'

          if membership == 'actor:drawer' && assembly_id
            box = drawer_boxes[assembly_id]
            box[:hardware] << child
            z = entity_min_z(child)
            box[:min_z] = [box[:min_z], z].min
            return
          end

          host_id = intent['hostComponentInstanceId']
          hardware_by_host[host_id] << child if host_id
        end

        def categorize_component(intent, child_id, child, doors, hardware_by_host,
                                 drawer_fronts, drawer_boxes, assembly_id)
          role = (intent['role'] || intent['semanticRole'] || '').to_s.downcase
          placement = (intent['placement'] || '').to_s.downcase

          if door_like?(placement, role)
            doors << child
            hardware_by_host["door-comp-#{doors.size - 1}"] = hardware_by_host[child_id] if child_id
            return
          end

          if drawer_front_like?(placement, role)
            drawer_fronts << { entity: child, id: child_id, min_z: entity_min_z(child) }
            return
          end

          record_drawer_box_part(drawer_boxes, assembly_id, child) if assembly_id
        end

        def record_drawer_box_part(drawer_boxes, assembly_id, child)
          box = drawer_boxes[assembly_id]
          box[:components] << child
          z = entity_min_z(child)
          box[:min_z] = [box[:min_z], z].min
        end

        def entity_min_z(child)
          if child.respond_to?(:transformation) && child.transformation.respond_to?(:origin)
            return child.transformation.origin.z
          end

          return child.bounds.min.z if child.respond_to?(:bounds) && child.bounds.respond_to?(:min)

          0.0
        rescue StandardError
          0.0
        end

        def build_drawers(drawer_fronts, drawer_boxes, hardware_by_host)
          sorted_fronts = drawer_fronts.sort_by { |f| [f[:min_z], f[:id].to_s] }
          sorted_boxes = drawer_boxes.values.sort_by { |b| [b[:min_z], b[:components].first&.name.to_s] }

          count = [sorted_fronts.size, sorted_boxes.size].max
          return [] if count.zero?

          Array.new(count) do |i|
            build_single_drawer(i, count, sorted_fronts[i], sorted_boxes[i], hardware_by_host)
          end
        end

        def build_single_drawer(idx, total, front_info, box_info, hardware_by_host)
          components = []
          components << front_info[:entity] if front_info
          components.concat(box_info[:components]) if box_info

          hardware = []
          hardware.concat(hardware_by_host[front_info[:id]]) if front_info && front_info[:id]
          hardware.concat(box_info[:hardware]) if box_info

          label = total == 1 ? 'Cajón' : "Cajón #{idx + 1}"
          min_z = if front_info
                    front_info[:min_z]
                  elsif box_info
                    box_info[:min_z]
                  else
                    0.0
                  end

          DrawerActorData.new(
            id: "drawer-slot-#{idx}",
            slot_index: idx,
            name: label,
            components: components.compact.uniq,
            hardware: hardware.compact.uniq,
            distance_mm: 400.0,
            min_z: min_z
          )
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

        def drawer_front_like?(placement, role)
          placement == 'frente_cajon' || role == 'frente_cajon' ||
            (%w[frente frentes].include?(role) && placement.include?('cajon'))
        end
      end
    end
  end
end
