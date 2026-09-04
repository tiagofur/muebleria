# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Single authority that derives the legal actions of a SelectionContext
      # from semantic context + definition/domain capability
      # (sketchup-authoring-interaction-contract §4). It never inspects
      # furniture/piece names, slot ids or roles to decide legality, and it
      # only declares capabilities the plugin actually supports today:
      # unsupported ones stay present-but-disabled with a Spanish explanation
      # of how to resolve them. Downstream issues (#466/#467/#468/#470/#471)
      # extend or consume this policy — they must not re-derive legality.
      module CapabilityPolicy
        module_function

        def compute(context)
          set = CapabilitySet.new
          case context.kind
          when 'furniture'
            furniture_capabilities(context, set)
          when 'aggregate'
            aggregate_capabilities(set)
          when 'part'
            part_capabilities(set)
          when 'hardware'
            hardware_capabilities(context, set)
          end
          set
        end

        def furniture_capabilities(context, set)
          legacy = context.representation == 'legacy-group'
          definition_available = !legacy && context.definition.is_a?(Hash)

          set.declare('canEditParameters',
                      supported: definition_available,
                      reason: if legacy
                                CapabilityReasons::LEGACY_MIGRATION.call
                              else
                                CapabilityReasons::DEFINITION_MISSING.call
                              end)
          set.declare('canEditMaterialRoles',
                      supported: definition_available && material_roles?(context),
                      reason: material_roles_reason(legacy, definition_available))
          set.declare('canEditHighLevelHardware',
                      supported: false, reason: CapabilityReasons::HIGH_LEVEL_HARDWARE.call)
          set.declare('canDuplicate',
                      supported: false, reason: CapabilityReasons::FURNITURE_DUPLICATE.call)
          set.declare('canDelete',
                      supported: !legacy,
                      reason: legacy ? CapabilityReasons::LEGACY_MIGRATION.call : nil)
          set.declare('canReviewPreflight',
                      supported: false, reason: CapabilityReasons::TECHNICAL_REVIEW.call)
          # #470 read-only manufacturing inspection: the resolved machining
          # overlay is available for managed furniture. Legacy group
          # representation carries no authoritative resolve to inspect.
          set.declare('canInspectManufacturing',
                      supported: !legacy,
                      reason: legacy ? CapabilityReasons::LEGACY_MIGRATION.call : nil)
        end

        def aggregate_capabilities(set)
          set.declare('canMoveWithinConstraint',
                      supported: false, reason: CapabilityReasons::AGGREGATE_MOVE.call)
          set.declare('canRemove',
                      supported: false, reason: CapabilityReasons::AGGREGATE_REMOVE.call)
          set.declare('canInspectManufacturing',
                      supported: false, reason: CapabilityReasons::INSPECT_MANUFACTURING.call)
        end

        def part_capabilities(set)
          set.declare('canMoveWithinConstraint',
                      supported: false, reason: CapabilityReasons::PART_MOVE.call)
          set.declare('canDuplicate',
                      supported: false, reason: CapabilityReasons::PART_DUPLICATE.call)
          set.declare('canAddRelated',
                      supported: false, reason: CapabilityReasons::PART_ADD_RELATED.call)
          set.declare('canRemove',
                      supported: false, reason: CapabilityReasons::PART_REMOVE.call)
          set.declare('canChangeJoinery',
                      supported: false, reason: CapabilityReasons::PART_CHANGE_JOINERY.call)
          # #470: board-level inspection of Granete-resolved machining is
          # the primary read-only flow (`Ver fabricación`).
          set.declare('canInspectManufacturing',
                      supported: true, reason: nil)
        end

        # Provenance-aware (#350, #468): manual placements are editable and
        # substitutable; derived placements are controlled by definition rules
        # and locked against manual edits. Unknown fails closed.
        def hardware_capabilities(context, set)
          is_manual = context.placement_kind == 'manual'
          is_derived = context.placement_kind == 'derived'

          move_reason = if is_derived
                          CapabilityReasons::HARDWARE_DERIVED_EDIT.call
                        elsif !is_manual
                          CapabilityReasons::HARDWARE_UNKNOWN_EDIT.call
                        end
          replace_reason = if is_derived
                             CapabilityReasons::HARDWARE_DERIVED_EDIT.call
                           elsif !is_manual
                             CapabilityReasons::HARDWARE_UNKNOWN_EDIT.call
                           end

          rotate_reason = move_reason || 'La rotación de herrajes se deriva automáticamente.'
          handedness_reason = move_reason || 'La mano del herraje se deriva automáticamente.'

          set.declare('canMove', supported: is_manual, reason: move_reason)
          set.declare('canRotate', supported: false, reason: rotate_reason)
          set.declare('canChangeHandedness', supported: false, reason: handedness_reason)
          set.declare('canReplaceDefinition', supported: is_manual, reason: replace_reason)
          set.declare('canInspectMachining', supported: false, reason: CapabilityReasons::INSPECT_MACHINING.call)
        end

        def material_roles_reason(legacy, definition_available)
          if legacy
            CapabilityReasons::LEGACY_MIGRATION.call
          elsif definition_available
            CapabilityReasons::NO_MATERIAL_ROLES.call
          else
            CapabilityReasons::MATERIALS_WITHOUT_DEFINITION.call
          end
        end

        def material_roles?(context)
          roles = context.definition['materialRoles'] || context.definition[:materialRoles]
          roles.is_a?(Array) && !roles.empty?
        end
      end
    end
  end
end
