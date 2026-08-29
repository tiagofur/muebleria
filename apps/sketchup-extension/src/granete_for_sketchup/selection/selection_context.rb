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
                        project_id project_ref design_id design_ref base_revision_id
                        source_revision_ref host_locator semantic_path representation
                        placement_kind owner_recovery display definition parameters
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
          'materialChoices' => :material_choices
        }.freeze

        attr_reader :kind, *ATTRIBUTES
        attr_accessor :selection_count, :capabilities

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
          payload
        end
      end
    end
  end
end
