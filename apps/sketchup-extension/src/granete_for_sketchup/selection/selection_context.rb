# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # The one canonical semantic selection contract (#476 /
      # sketchup-authoring-interaction-contract §3). It identifies WHAT is
      # selected in SketchUp through stable Granete identity — never name,
      # GUID, persistent_id, dimensions or geometry — and carries the
      # capability set that drives the contextual inspector. Downstream
      # excellence features (#466/#467/#468/#470/#471) consume this payload
      # instead of defining parallel selection models.
      #
      # ID namespaces stay strictly separated — none may alias another:
      #   furnitureInstanceId     — server-owned Project FurnitureInstance (#384);
      #   furnitureInstanceRef    — local SketchUp locator ref (metadata instanceRef);
      #   furnitureDefinitionId   — reusable Granete furniture definition;
      #   componentInstanceId     — concrete part/aggregate occurrence;
      #   componentDefinitionId   — reusable part authoring definition (#346);
      #   catalogComponentId      — optional catalog reference (own namespace);
      #   hardwarePlacementId     — concrete hardware placement occurrence;
      #   hardwareDefinitionId    — reusable hardware definition;
      #   hostComponentInstanceId — host board occurrence of a hardware;
      #   projectId/designId/baseRevisionId — server Digital Thread IDs (#384);
      #   projectRef/designRef/sourceRevisionRef — local companion refs;
      #   hostLocator             — technical SketchUp evidence ONLY.
      class SelectionContext
        KINDS = %w[furniture aggregate part hardware unmanaged].freeze
        # Hardware placement provenance vocabulary (#350): 'manual' for
        # placements authored on component-instance overrides, 'derived' for
        # relationship/union-generated ones. 'unknown' is fail-closed — the
        # context never guesses derived.
        PLACEMENT_KINDS = %w[manual derived unknown].freeze
        OWNER_RECOVERIES = %w[path scan ambiguous none].freeze

        ATTRIBUTES = %i[furniture_instance_id furniture_instance_ref furniture_definition_id
                        component_instance_id component_definition_id catalog_component_id
                        hardware_placement_id hardware_definition_id host_component_instance_id
                        anchor_face offset_mm
                        project_id project_ref design_id design_ref base_revision_id
                        source_revision_ref host_locator semantic_path representation
                        placement_kind owner_recovery display definition parameters
                        component_placement assembly_translation_mm authoring_capability
                        material_choices capabilities].freeze

        # JSON name → context attribute; the payload never invents fields and
        # never copies one namespace's value into another.
        PAYLOAD_FIELDS = {
          'furnitureInstanceId' => :furniture_instance_id,
          'furnitureInstanceRef' => :furniture_instance_ref,
          'furnitureDefinitionId' => :furniture_definition_id,
          'componentInstanceId' => :component_instance_id,
          'componentDefinitionId' => :component_definition_id,
          'catalogComponentId' => :catalog_component_id,
          'hardwarePlacementId' => :hardware_placement_id,
          'hardwareDefinitionId' => :hardware_definition_id,
          'hostComponentInstanceId' => :host_component_instance_id,
          'anchorFace' => :anchor_face,
          'offsetMm' => :offset_mm,
          'projectId' => :project_id,
          'projectRef' => :project_ref,
          'designId' => :design_id,
          'designRef' => :design_ref,
          'baseRevisionId' => :base_revision_id,
          'sourceRevisionRef' => :source_revision_ref,
          'hostLocator' => :host_locator,
          'semanticPath' => :semantic_path,
          'representation' => :representation,
          'placementKind' => :placement_kind,
          'ownerRecovery' => :owner_recovery,
          'definition' => :definition,
          'parameters' => :parameters,
          'componentPlacement' => :component_placement,
          'assemblyTranslationMm' => :assembly_translation_mm,
          'authoringCapability' => :authoring_capability,
          'materialChoices' => :material_choices
        }.freeze

        attr_reader :kind, *ATTRIBUTES
        attr_accessor :selection_count
        attr_writer :capabilities
        # #529: door-swing placements (arrays of raw placement hashes with
        # doorAffinity). Carried outside ATTRIBUTES so the ATTRIBUTES contract
        # stays stable; the resolver sets this when the Go layout produces
        # doorAffinity data. Nil and [] both produce doorAccessories: [].
        attr_writer :door_hardware_placements

        def initialize(kind:, **fields)
          raise ArgumentError, "kind must be one of #{KINDS.join(', ')}" unless KINDS.include?(kind)

          unknown = fields.keys - ATTRIBUTES
          raise ArgumentError, "unknown SelectionContext fields: #{unknown.join(', ')}" unless unknown.empty?

          @kind = kind
          ATTRIBUTES.each { |attribute| instance_variable_set("@#{attribute}", fields[attribute]) }
          @display ||= {}
          @capabilities ||= CapabilitySet.new
          @selection_count = nil
        end

        # Occurrence identity per kind: the owning furniture id/ref plus the
        # concrete occurrence id of the selected entity. Reusable definition
        # IDs and host bindings are deliberately excluded — sharing a
        # componentDefinitionId must never collapse two occurrences, and
        # rename/move/regeneration must never change this key.
        def same_identity_as?(other)
          other.is_a?(SelectionContext) && identity_key == other.identity_key
        end

        def identity_key
          owner = [furniture_instance_id, furniture_instance_ref]
          case kind
          when 'furniture'
            ['furniture'] + owner
          when 'part', 'aggregate'
            [kind] + owner + [component_instance_id]
          when 'hardware'
            ['hardware'] + owner + [hardware_placement_id]
          else
            ['unmanaged']
          end
        end

        def to_payload
          payload = { 'kind' => kind, 'display' => display, 'capabilities' => capabilities.to_h }
          PAYLOAD_FIELDS.each do |json_key, attribute|
            value = public_send(attribute)
            payload[json_key] = value unless value.nil?
          end
          payload['selectionCount'] = selection_count if selection_count.to_i > 1
          payload.delete('semanticPath') if payload['semanticPath'] && payload['semanticPath'].empty?
          # #529: door-swing accessories grouped by door slot. The Go resolver
          # will populate doorAffinity on hardware placements when it produces
          # door-swing data; until then the array is always empty (no Go output
          # for doorAffinity yet in this worktree).
          payload['doorAccessories'] = door_accessories_payload if kind == 'furniture'
          payload
        end

        private

        # #529: groups the furniture's hardware placements by door slot using
        # the doorAffinity annotation the Go resolver will publish per
        # placement. Until Go produces doorAffinity, every placement lacks the
        # field and the result is always []. When Go starts emitting it, each
        # entry carries:
        #   doorSlotIndex — 0-based door index within the furniture
        #   doorLabel     — human label from Go (e.g. "Puerta izquierda")
        #   swingSide     — anchorFace of the hinge group (the bisagra side)
        #   hinges        — array of hinge placement hashes
        #   handle        — the jaladera placement hash, or nil
        # Callers must treat a missing/empty array as "no door data yet".
        def door_accessories_payload
          placements = @door_hardware_placements || []
          with_affinity = placements.select do |p|
            p[:doorAffinity] || p['doorAffinity']
          end
          return [] if with_affinity.empty?

          grouped = with_affinity.group_by do |p|
            aff = p[:doorAffinity] || p['doorAffinity']
            aff[:doorSlotIndex] || aff['doorSlotIndex']
          end
          grouped.sort_by { |slot_idx, _| slot_idx }.map do |slot_idx, ps|
            affinity_key = ps.first[:doorAffinity] ? :doorAffinity : 'doorAffinity'
            face_key     = ps.first[:anchorFace]   ? :anchorFace   : 'anchorFace'
            first_aff    = ps.first[affinity_key]
            hinges = ps.select do |p|
              role = p[affinity_key][:accessoryRole] || p[affinity_key]['accessoryRole']
              role == 'hinge'
            end
            handle = ps.find do |p|
              role = p[affinity_key][:accessoryRole] || p[affinity_key]['accessoryRole']
              role == 'handle'
            end
            {
              'doorSlotIndex' => slot_idx,
              'doorLabel'     => first_aff[:doorLabel] || first_aff['doorLabel'],
              'swingSide'     => (hinges.first || {})[face_key],
              'hinges'        => hinges,
              'handle'        => handle
            }
          end
        end
      end
    end
  end
end
