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
          set.declare('canInspectManufacturing',
                      supported: false, reason: CapabilityReasons::INSPECT_MANUFACTURING.call)
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
          set.declare('canInspectManufacturing',
                      supported: false, reason: CapabilityReasons::INSPECT_MANUFACTURING.call)
        end

        # Provenance-aware (#350): only a real contract discriminator decides
        # which explanation applies — 'unknown' fails closed with its own
        # remediation instead of being treated as derived or manual.
        def hardware_capabilities(context, set)
          move_reason = case context.placement_kind
                        when 'manual' then CapabilityReasons::HARDWARE_MANUAL_EDIT.call
                        when 'derived' then CapabilityReasons::HARDWARE_DERIVED_EDIT.call
                        else CapabilityReasons::HARDWARE_UNKNOWN_EDIT.call
                        end
          set.declare('canMove', supported: false, reason: move_reason)
          set.declare('canRotate', supported: false, reason: move_reason)
          set.declare('canChangeHandedness', supported: false, reason: move_reason)
          set.declare('canReplaceDefinition',
                      supported: false, reason: CapabilityReasons::HARDWARE_REPLACE.call)
          set.declare('canInspectMachining',
                      supported: false, reason: CapabilityReasons::INSPECT_MACHINING.call)
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
