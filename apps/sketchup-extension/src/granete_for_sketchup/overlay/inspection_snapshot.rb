# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Immutable inspection snapshot derived from ONE accepted authoring
      # resolve (#477) plus its correlation. The overlay treats this as the
      # only machining truth it will ever draw; the manufacturing fingerprint
      # anchors CURRENT vs STALE correlation with the #498 accepted-state
      # lifecycle (PreflightTracker). Nothing here mutates the model.
      class InspectionSnapshot
        attr_reader :scope, :features, :boards, :relationships,
                    :manufacturing_fingerprint, :catalog_revision, :message_id,
                    :issues

        def initialize(scope:, result:, message_id:)
          unless result.respond_to?(:accepted?) && result.accepted?
            raise ArgumentError, 'inspection snapshot requiere un resolve aceptado'
          end

          @scope = scope
          @message_id = message_id
          @manufacturing_fingerprint = result.manufacturing_fingerprint
          @catalog_revision = result.catalog_revision
          @issues = result.issues.to_a
          @features = ManufacturingFeatureView::Factory.from_operations(
            result.operations, conflict_issues
          )
          @boards = result.layout.boards
          @relationships = (result.normalized_snapshot || {})['relationships'] || []
        end

        def board_for(component_instance_id)
          boards.find { |board| board.component_instance_id == component_instance_id }
        end

        def features_for(component_instance_id)
          features.select { |feature| feature.host_component_instance_id == component_instance_id }
        end

        def feature_by_visual_id(visual_id)
          features.find { |feature| feature.visual_id == visual_id }
        end

        def relationship_by_id(relationship_id)
          relationships.find { |relationship| relationship['relationshipId'] == relationship_id }
        end

        private

        def conflict_issues
          issues.select { |issue| issue.respond_to?(:code) && issue.code == 'DRILLING_CONFLICT' }
        end
      end
    end
  end
end
