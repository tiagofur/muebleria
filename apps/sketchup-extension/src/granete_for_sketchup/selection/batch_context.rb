# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Batch context (#471 / sketchup-authoring-interaction-contract §16):
      # a SET of semantic furniture identities — never a selection.first
      # authority and never an implicit first-value fill. Members keep their
      # full individual contexts (identity, capabilities, definition,
      # materialChoices, parameters) so the batch inspector triages
      # common/mixed/unsupported per shared control from already-authoritative
      # data, without re-resolving and without computing manufacturing.
      #
      # Non-furniture entities in the selection are excluded with an honest
      # reason — never silently skipped. The scope origin is explicit and
      # pluggable: 'selection' today; a future #784 Design-scope provider
      # adds its own origin instead of refactoring this contract.
      class BatchContext
        BATCH_MINIMUM = 2

        # Batch operation → the per-member capability it intersects.
        OPERATIONS = {
          'canBatchEditMaterialRoles' => 'canEditMaterialRoles',
          'canBatchEditParameters' => 'canEditParameters'
        }.freeze

        EXCLUSION_REASONS = {
          'part' => 'pieza de un mueble: el lote edita muebles completos',
          'aggregate' => 'conjunto de un mueble: el lote edita muebles completos',
          'hardware' => 'herraje de un mueble: el lote edita muebles completos',
          'unmanaged' => 'geometría no gestionada por Granete'
        }.freeze

        attr_reader :members, :excluded, :origin, :selection_count, :capabilities

        def initialize(members:, others:, selection_count:, origin: 'selection')
          raise ArgumentError, 'batch requires at least two managed furniture' unless members.length >= BATCH_MINIMUM

          # Deterministic presentation order only — identity_key sorting is
          # never a value authority. Duplicate identities (legacy copies
          # sharing one ref) collapse to one member: batch semantics operate
          # on semantic identities, not on entity multiplicity.
          @members = members.uniq(&:identity_key).sort_by(&:identity_key)
          @origin = origin
          @selection_count = selection_count
          @capabilities = batch_capabilities(@members)
          @excluded = others.map { |context| excluded_entry(context) }
        end

        def to_payload
          {
            'kind' => 'batch',
            'origin' => @origin,
            'display' => { 'name' => "#{@members.length} muebles" },
            'furniture' => @members.map(&:to_payload),
            'excluded' => @excluded,
            'capabilities' => @capabilities.to_h,
            'selectionCount' => @selection_count
          }
        end

        private

        def excluded_entry(context)
          {
            'kind' => context.kind,
            'reason' => EXCLUSION_REASONS.fetch(context.kind, 'fuera del alcance del lote')
          }
        end

        # A batch operation is legal only when EVERY member individually
        # supports it; the reason names how many deny it — no arbitrary
        # first-denier authority either.
        def batch_capabilities(members)
          set = CapabilitySet.new
          OPERATIONS.each do |batch_name, member_capability|
            deniers = members.count { |member| !member.capabilities.supported?(member_capability) }
            set.declare(
              batch_name,
              supported: deniers.zero?,
              reason: deniers.zero? ? nil : "#{deniers} de #{members.length} muebles no admiten esta edición"
            )
          end
          set
        end
      end
    end
  end
end
