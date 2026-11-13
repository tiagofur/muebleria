# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Discovers the opening actors (doors and drawers) of one managed
      # furniture occurrence from MANAGED METADATA ONLY (#529 / #1377):
      # - Doors: part entities whose placement slot is 'puerta' or whose role
      #   names a door.
      # - Drawers: composed sub-assemblies clustering the drawer front,
      #   fabricated drawer box components, handles, and slide rails.
      #
      # Grouping keys, in order of authority (#1468):
      #   1. Explicit `assemblyInstanceId` on the child metadata (rails carry
      #      it from the layout contract; box boards too since the engine
      #      seals it on agregado-expanded components).
      #   2. Legacy layouts emit the agregado-expanded drawer box boards as
      #      top-level components WITHOUT assemblyInstanceId, but the server
      #      embeds the assembly instance id inside the board's own
      #      componentInstanceId (`agr-<agrId>-instance-<asmId>-u<idx>-…`).
      #      Those boards join the rail group whose assemblyInstanceId is a
      #      substring of their componentInstanceId. Cabinet structure boards
      #      (`st-…` ids) never match.
      #
      # Hardware membership: 'actor:drawer' rides the drawer; 'body' stays
      # with the furniture body; a MISSING membership (legacy metadata) is
      # treated as drawer hardware best-effort — a fresh re-sync writes the
      # explicit membership and the fixed rails stay behind again.
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
          drawer_groups = Hash.new { |h, k| h[k] = { components: [], hardware: [], min_z: Float::INFINITY } }
          unassigned_box_boards = []

          has_children = furniture_entity.respond_to?(:definition) &&
                         furniture_entity.definition.respond_to?(:entities)
          return DoorActorSet.new(doors, hardware_by_host, []) unless has_children

          furniture_entity.definition.entities.each do |child|
            next unless child.respond_to?(:get_attribute)

            meta = read_metadata(metadata_store, child)
            next unless meta

            categorize(meta, child, doors, hardware_by_host, drawer_fronts,
                       drawer_groups, unassigned_box_boards)
          end

          assign_legacy_box_boards(drawer_groups, unassigned_box_boards)
          drawers = build_drawers(drawer_fronts, drawer_groups, hardware_by_host)
          DoorActorSet.new(doors, hardware_by_host, drawers)
        end

        def read_metadata(metadata_store, child)
          metadata_store.read(child)
        rescue StandardError
          nil
        end

        def categorize(meta, child, doors, hardware_by_host, drawer_fronts,
                       drawer_groups, unassigned_box_boards)
          intent = meta['intent'] || {}
          identity = meta['identity'] || {}
          child_id = identity['instanceRef'] || identity['componentInstanceId'] || identity['hardwarePlacementId']
          entity_class = intent['entityClass'] || (intent['hostComponentInstanceId'] ? 'hardware' : 'component')
          assembly_id = intent['assemblyInstanceId'] || identity['assemblyInstanceId']

          if entity_class == 'hardware'
            categorize_hardware(intent, identity, child, hardware_by_host,
                                drawer_groups, assembly_id)
          else
            categorize_component(intent, child_id, child, doors, hardware_by_host,
                                 drawer_fronts, drawer_groups, unassigned_box_boards,
                                 assembly_id)
          end
        end

        def categorize_hardware(intent, identity, child, hardware_by_host,
                                drawer_groups, assembly_id)
          membership = (intent['actorMembership'] || identity['actorMembership']).to_s.strip
          return if membership == 'body'

          # #1613: accessory-choice assemblies (`<bayId>-acc-<group>`, #1555)
          # are ATTACHMENTS to the bay's drawer — the chosen Galería/Boxcap/
          # Boxcover strips ride the bay's own actor. Grouping them under
          # their own assembly id emitted a phantom extra «Cajón» (hardware
          # without front is not inert by the #1573 gate) and shifted the
          # front↔box pairing by one.
          if assembly_id.to_s.include?('-acc-')
            base_assembly = assembly_id.split('-acc-', 2).first
            unless base_assembly.to_s.strip.empty?
              assembly_id = base_assembly
            end
          end

          # #1468: moving slide rails ride the drawer's assembly group. Legacy
          # metadata without an explicit membership but WITH an assembly id is
          # grouped best-effort (a fresh re-sync restores the explicit
          # membership and fixed rails stay behind again).
          if assembly_id && (membership == 'actor:drawer' || membership.empty?)
            group = drawer_groups[assembly_id]
            group[:hardware] << child
            group[:min_z] = [group[:min_z], entity_min_z(child)].min
            return
          end

          host_id = intent['hostComponentInstanceId']
          hardware_by_host[host_id] << child if host_id
        end

        def categorize_component(intent, child_id, child, doors, hardware_by_host,
                                 drawer_fronts, drawer_groups, unassigned_box_boards,
                                 assembly_id)
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

          # Drawer box board: explicit assembly id when present; otherwise
          # deferred — the assembly instance id may be embedded in the board's
          # own componentInstanceId by the server contract (legacy layouts).
          return unless assembly_id || child_id

          if assembly_id
            record_drawer_box_part(drawer_groups, assembly_id, child)
          else
            unassigned_box_boards << { entity: child, component_id: child_id.to_s, min_z: entity_min_z(child) }
          end
        end

        def record_drawer_box_part(drawer_groups, assembly_id, child)
          group = drawer_groups[assembly_id]
          group[:components] << child
          group[:min_z] = [group[:min_z], entity_min_z(child)].min
        end

        def entity_min_z(child)
          # #1464 seguimiento: el borde visual REAL, nunca el origen de la
          # transformación. Los tableros de la caja llegan rotados (traseras
          # rotateY 90, laterales rotZ 90) y su origen puede caer por encima o
          # por debajo del cajón — ordenar cajas por origen emparejaba cada
          # frente con la caja del cajón equivocado (apertura cruzada).
          return child.bounds.min.z if child.respond_to?(:bounds) && child.bounds.respond_to?(:min)
          if child.respond_to?(:transformation) && child.transformation.respond_to?(:origin)
            return child.transformation.origin.z
          end

          0.0
        rescue StandardError
          0.0
        end

        # Legacy layouts (#1468): asigna cada pieza de caja sin
        # assemblyInstanceId al grupo cuyo assemblyInstanceId está embebido
        # en su componentInstanceId (contrato de ids del server:
        # agr-<agrId>-instance-<asmId>-u<idx>-…). Piezas que no casan con
        # ningún grupo (estructura del mueble, ids `st-…`) quedan fuera —
        # fail-closed, nunca se adivina.
        def assign_legacy_box_boards(drawer_groups, unassigned_box_boards)
          return if unassigned_box_boards.empty? || drawer_groups.empty?

          unassigned_box_boards.each do |record|
            group = drawer_groups.find do |asm_id, _|
              record[:component_id].to_s.include?(asm_id)
            end
            next unless group

            group[1][:components] << record[:entity]
            group[1][:min_z] = [group[1][:min_z], record[:min_z]].min
          end
        end

        def build_drawers(drawer_fronts, drawer_groups, hardware_by_host)
          sorted_fronts = drawer_fronts.sort_by { |f| [f[:min_z], f[:id].to_s] }
          sorted_groups = drawer_groups.values.sort_by { |g| [g[:min_z], g[:components].first&.name.to_s] }

          count = [sorted_fronts.size, sorted_groups.size].max
          return [] if count.zero?

          # #1573: only pairs that can actually OPEN emit an actor — a
          # drawer front, or drawer-group hardware (routed here by actor
          # membership: rails). A group of bare boards with no front and no
          # hardware is cabinet content (entrepaño agregados), never a
          # drawer; emitting it produced the ghost «Cajón» whose Abrir slid
          # fixed shelves across the workshop.
          Array.new(count) do |i|
            front_info = sorted_fronts[i]
            group_info = sorted_groups[i]
            next if front_info.nil? && group_info.nil?
            next if front_info.nil? && inert_group?(group_info)

            build_single_drawer(i, count, front_info, group_info, hardware_by_host)
          end.compact
        end

        def inert_group?(group_info)
          group_info.nil? || group_info[:hardware].empty?
        end

        def build_single_drawer(idx, total, front_info, group_info, hardware_by_host)
          components = []
          components << front_info[:entity] if front_info
          components.concat(group_info[:components]) if group_info

          hardware = []
          hardware.concat(hardware_by_host[front_info[:id]]) if front_info && front_info[:id]
          hardware.concat(group_info[:hardware]) if group_info

          label = total == 1 ? 'Cajón' : "Cajón #{idx + 1}"
          min_z = if front_info
                    front_info[:min_z]
                  elsif group_info
                    group_info[:min_z]
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
