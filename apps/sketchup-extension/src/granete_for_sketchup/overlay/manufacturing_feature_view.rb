# frozen_string_literal: true

module Granete
  module SketchUpExtension
    # Read-only 3D inspection overlay of Granete-resolved ManufacturingFeatures
    # (#470 / SU-VIS-1). The overlay VISUALIZES the authoritative machining the
    # backend resolved in the authoring contract (#477); it never derives,
    # recomputes or persists manufacturing truth. Everything here is view
    # state: no SketchUp operations, no metadata writes, no entity creation.
    module Overlay
      # Neutral view model of ONE resolved hole of the machining contract.
      # Built exclusively from the accepted AuthoringResolveResult; the only
      # added field is `visual_id`, a DETERMINISTIC VISUALIZATION identity
      # (operationId + stable index of the hole inside the immutable
      # operation). It exists so the viewport/dialog can address a drawn
      # marker for selection — it is NEVER a business/manufacturing identity
      # and never re-enters authoring state.
      class ManufacturingFeatureView
        KIND_HOLE = 'hole'

        FACE_LABELS_ES = {
          'front' => 'frontal', 'back' => 'trasera', 'left' => 'izquierda',
          'right' => 'derecha', 'top' => 'superior', 'bottom' => 'inferior'
        }.freeze

        TYPE_LABELS_ES = {
          'hinge' => 'Bisagra', 'dowel' => 'Taquete', 'minifix' => 'Minifix',
          'screw' => 'Tornillo', 'pilot' => 'Piloto', 'shelf' => 'Soporte de entrepaño'
        }.freeze

        attr_reader :visual_id, :operation_id, :kind, :host_component_instance_id,
                    :face, :face_label, :x_mm, :y_mm, :diameter_mm, :depth_mm,
                    :hole_type, :type_label, :provenance, :conflict_issue

        def initialize(visual_id:, operation_id:, kind:, host_component_instance_id:,
                       face:, x_mm:, y_mm:, diameter_mm:, depth_mm:, hole_type:,
                       provenance:, conflict_issue: nil)
          @visual_id = visual_id
          @operation_id = operation_id
          @kind = kind
          @host_component_instance_id = host_component_instance_id
          @face = face
          @face_label = FACE_LABELS_ES.fetch(face, face)
          @x_mm = x_mm
          @y_mm = y_mm
          @diameter_mm = diameter_mm
          @depth_mm = depth_mm
          @hole_type = hole_type
          @type_label = TYPE_LABELS_ES.fetch(hole_type, hole_type)
          @provenance = provenance
          @conflict_issue = conflict_issue
        end

        # Provenance is REQUIRED and unambiguous (#470 §13): the wire parser
        # already fails closed on ambiguous provenance; the view asserts the
        # same invariant so a future parser change cannot silently blur it.
        def source_kind
          provenance['sourceKind']
        end

        def relationship_id
          provenance['relationshipId']
        end

        def hardware_placement_id
          provenance['hardwarePlacementId']
        end

        def catalog_rule_id
          provenance['catalogRuleId']
        end

        def source_label_es
          case source_kind
          when 'manualHardwarePlacement'
            hardware_placement_id.to_s
          when 'relationship'
            relationship_id.to_s
          else
            ''
          end
        end

        def conflict?
          !conflict_issue.nil?
        end

        # Dialog payload. Values only; copy in Spanish where it is display
        # data (labels), raw contract values where it is behavior data.
        def to_payload
          {
            'visualId' => visual_id,
            'operationId' => operation_id,
            'kind' => kind,
            'hostComponentInstanceId' => host_component_instance_id,
            'face' => face,
            'faceLabel' => face_label,
            'xMm' => x_mm,
            'yMm' => y_mm,
            'diameterMm' => diameter_mm,
            'depthMm' => depth_mm,
            'type' => hole_type,
            'typeLabel' => type_label,
            'provenance' => provenance.dup,
            'sourceLabel' => source_label_es,
            'conflict' => conflict? ? conflict_payload : nil
          }.compact
        end

        # Builds the flat feature list of an accepted resolve: one view per
        # hole, keyed by deterministic visual identity. DRILLING_CONFLICT
        # issues (backend-decided pairs, details.operationId1/2) attach to
        # the participating operations — Ruby never rebuilds a conflict from
        # proximity.
        module Factory
          module_function

          def from_operations(operations, issues = [])
            conflict_index = conflict_index_for(issues)
            operations.flat_map do |operation|
              ensure_provenance!(operation)
              operation.holes.each_with_index.map do |hole, hole_index|
                ManufacturingFeatureView.new(
                  visual_id: "#{operation.operation_id}#h#{hole_index}",
                  operation_id: operation.operation_id,
                  kind: KIND_HOLE,
                  host_component_instance_id: operation.host_component_instance_id,
                  face: hole['face'],
                  x_mm: hole['xMm'].to_f,
                  y_mm: hole['yMm'].to_f,
                  diameter_mm: hole['diameterMm'].to_f,
                  depth_mm: hole['depthMm'].to_f,
                  hole_type: hole['type'],
                  provenance: operation.provenance.dup,
                  conflict_issue: conflict_index[operation.operation_id]
                )
              end
            end
          end

          # operationId → conflict issue (first wins; a pair of operations in
          # conflict may share several issues — display keeps one).
          def conflict_index_for(issues)
            issues.each_with_object({}) do |issue, index|
              next unless issue.respond_to?(:code) && issue.code == 'DRILLING_CONFLICT'

              details = issue.details || {}
              %w[operationId1 operationId2].each do |key|
                op_id = details[key]
                index[op_id] ||= issue if op_id.is_a?(String) && !op_id.empty?
              end
            end
          end

          def ensure_provenance!(operation)
            source_kind = operation.provenance['sourceKind']
            return if %w[relationship manualHardwarePlacement].include?(source_kind)

            raise ArgumentError,
                  "operación #{operation.operation_id} sin provenance resuelta; " \
                  'el overlay nunca adivina el origen de una operación'
          end
        end

        private

        def conflict_payload
          issue = conflict_issue
          details = issue.details || {}
          {
            'code' => issue.code,
            'message' => issue.message,
            'remediation' => issue.remediation,
            'otherOperationId' => other_conflicting_operation_id(details)
          }.compact
        end

        def other_conflicting_operation_id(details)
          return details['operationId2'] if details['operationId1'] == operation_id
          return details['operationId1'] if details['operationId2'] == operation_id

          details['operationId2'] || details['operationId1']
        end
      end
    end
  end
end
