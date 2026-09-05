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
      # rubocop:disable-next Metrics/ModuleLength
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
            part_capabilities(context, set)
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
          # #466 review / #470 inspection: managed furniture with an
          # authoritative resolve; legacy groups carry none to review.
          legacy_reason = legacy ? CapabilityReasons::LEGACY_MIGRATION.call : nil
          set.declare('canReviewPreflight', supported: definition_available,
                                            reason: legacy_reason || CapabilityReasons::DEFINITION_MISSING.call)
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

        # #467 direct internal authoring: only occurrences whose published
        # domain placement (layout slotId, stored as part intent `placement`)
        # is `interno` are movable internals. Structural/agregado templates
        # keep the definition-driven pose; a missing placement (metadata from
        # before #467) fails closed. This is an affordance over server-published
        # data — Granete's resolve stays the sole authority for every
        # manufacturing consequence.
        def part_capabilities(context, set)
          movable = context.component_placement == Library::MOVABLE_INTERNAL_PLACEMENT
          reason = if movable
                     nil
                   elsif context.component_placement.nil?
                     CapabilityReasons::PART_PLACEMENT_UNKNOWN.call
                   else
                     CapabilityReasons::PART_STRUCTURAL.call
                   end

          set.declare('canMoveWithinConstraint', supported: movable, reason: reason)
          set.declare('canDuplicate', supported: movable, reason: reason)
          set.declare('canAddRelated', supported: movable, reason: reason)
          set.declare('canRemove', supported: movable, reason: reason)
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
