# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # `Ir al origen` navigation (#470): from a resolved feature's
      # provenance to the responsible authoring context in the model.
      # Location is by Granete semantic identity through namespaced metadata
      # — never by SketchUp name, GUID, persistent_id or geometry. Selecting
      # the target fires the normal SelectionObserver flow, which opens the
      # corresponding inspector (#468 hardware editor for manual placements).
      #
      # Reuses the shared selection model: this is view state only (no
      # operation, no metadata write), the same guarantee
      # Host::SelectionRestore gives a committed mutation.
      class ProvenanceNavigation
        def initialize(locator:, model_provider:)
          @locator = locator
          @model_provider = model_provider
        end

        # Returns a result hash { kind, id, entity } on success, nil when the
        # source cannot be located honestly.
        def navigate_to_source(feature, snapshot)
          case feature.source_kind
          when 'manualHardwarePlacement'
            navigate_hardware_placement(feature, snapshot)
          when 'relationship'
            navigate_relationship(feature, snapshot)
          end
        end

        private

        # manualHardwarePlacement → exact hardware ComponentInstance (#470
        # §15): hardwarePlacementId → metadata identity lookup.
        def navigate_hardware_placement(feature, snapshot)
          placement_id = feature.hardware_placement_id
          return nil unless placement_id

          root = @locator.locate_furniture(snapshot.scope)
          return nil unless root

          entity = @locator.locate_child(root, placement_id)
          return nil unless entity

          select(entity)
          { 'kind' => 'hardware', 'id' => placement_id }
        end

        # relationship → owning source component (#470 §17): the relationship
        # of the normalized snapshot names its source occurrence (e.g. the
        # shelf); selecting it gives the user the semantic owner context.
        # Kind/labels come from the snapshot metadata, never from names.
        def navigate_relationship(feature, snapshot)
          relationship = snapshot.relationship_by_id(feature.relationship_id)
          return nil unless relationship.is_a?(Hash)

          source_id = relationship.dig('source', 'componentInstanceId')
          return nil unless source_id.is_a?(String) && !source_id.empty?

          root = @locator.locate_furniture(snapshot.scope)
          return nil unless root

          entity = @locator.locate_child(root, source_id)
          return nil unless entity

          select(entity)
          { 'kind' => 'part', 'id' => source_id, 'relationshipId' => feature.relationship_id }
        end

        def select(entity)
          model = @model_provider.call
          return unless model.respond_to?(:selection)

          model.selection.clear
          model.selection.add(entity)
        end
      end
    end
  end
end
