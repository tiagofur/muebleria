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
      # ID separation (mandatory):
      #   furnitureInstanceId     — owning FurnitureInstance occurrence;
      #   furnitureDefinitionId   — reusable Granete furniture definition;
      #   componentInstanceId     — the concrete part/aggregate occurrence;
      #   componentDefinitionId   — reusable part authoring definition (#346);
      #   catalogComponentId      — optional catalog reference (own namespace);
      #   hardwarePlacementId     — concrete hardware placement occurrence;
      #   hardwareDefinitionId    — reusable hardware definition;
      #   hostComponentInstanceId — host board occurrence of a hardware;
      #   hostLocator             — technical SketchUp evidence ONLY.
      class SelectionContext
        KINDS = %w[furniture aggregate part hardware unmanaged].freeze
        ATTRIBUTES = %i[furniture_instance_id furniture_definition_id component_instance_id
                        component_definition_id catalog_component_id hardware_placement_id
                        hardware_definition_id host_component_instance_id project_id design_id
                        base_revision_id host_locator semantic_path representation origin
                        display definition parameters material_choices capabilities].freeze

        # JSON name → context attribute; the payload never invents fields.
        PAYLOAD_FIELDS = {
          'furnitureInstanceId' => :furniture_instance_id,
          'furnitureDefinitionId' => :furniture_definition_id,
          'componentInstanceId' => :component_instance_id,
          'componentDefinitionId' => :component_definition_id,
          'catalogComponentId' => :catalog_component_id,
          'hardwarePlacementId' => :hardware_placement_id,
          'hardwareDefinitionId' => :hardware_definition_id,
          'hostComponentInstanceId' => :host_component_instance_id,
          'projectId' => :project_id,
          'designId' => :design_id,
          'baseRevisionId' => :base_revision_id,
          'hostLocator' => :host_locator,
          'semanticPath' => :semantic_path,
          'representation' => :representation,
          'origin' => :origin,
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

        # Identity comparison deliberately ignores display names, host
        # locators and world transforms: rename, move/rotate and host child
        # regeneration must all preserve it.
        def same_identity_as?(other)
          other.is_a?(SelectionContext) && identity_key == other.identity_key
        end

        def identity_key
          [kind, furniture_instance_id, component_instance_id, hardware_placement_id,
           host_component_instance_id, furniture_definition_id, component_definition_id,
           hardware_definition_id]
        end

        def to_payload
          payload = { 'kind' => kind, 'display' => display, 'capabilities' => capabilities.to_h }
          PAYLOAD_FIELDS.each do |json_key, attribute|
            value = public_send(attribute)
            payload[json_key] = value unless value.nil?
          end
          # Compatibility alias kept for the contract's older readers; same
          # value, never a divergent second identity.
          payload['furnitureInstanceRef'] = furniture_instance_id if furniture_instance_id
          payload['selectionCount'] = selection_count if selection_count.to_i > 1
          payload.delete('semanticPath') if payload['semanticPath'] && payload['semanticPath'].empty?
          payload
        end
      end
    end
  end
end
