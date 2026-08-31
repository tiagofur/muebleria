# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Migration
      # Batch migrator: turns legacy Group furniture into the native
      # ComponentInstance representation (#416 / SU-ENT-3, native-entity-model
      # §19).
      #
      # Policy (documented in the issue): ONE SketchUp operation for the whole
      # batch, so undo is a single coherent user action.
      #
      # Safety pipeline:
      #   1. pre-flight OUTSIDE any operation: find the catalog definition and
      #      re-resolve the authoritative layout for every ready item. Any
      #      failure demotes the item to requires_review and its legacy Group
      #      is left untouched — there is deliberately NO generic/local
      #      fallback (a migration may only replace geometry Granete itself
      #      resolved);
      #   2. a single operation builds each native replacement (validating it
      #      before its source is erased);
      #   3. any in-operation failure aborts the WHOLE operation: the model
      #      returns to its all-legacy state and the report says so — never a
      #      green batch hiding a per-item failure.
      class Migrator
        REASON_DEFINITION_NOT_FOUND = 'definition-not-found'
        REASON_RESOLVE_UNAVAILABLE = 'resolve-unavailable'
        REASON_RESOLVE_FAILED = 'resolve-failed'
        REASON_ABORTED = 'batch-aborted'

        def initialize(metadata_store:, furniture_builder:, catalog_provider:)
          @metadata_store = metadata_store
          @furniture_builder = furniture_builder
          @catalog_provider = catalog_provider
        end

        # scan_result: a Migration::ScanResult. Returns an honest report:
        # `success` means the batch operation committed — NOT that every
        # detected item migrated. `allMigrated` is the only total-success
        # signal and is false whenever anything stayed legacy.
        def migrate(model, scan_result)
          plan, demoted = build_plan(scan_result.ready)
          # Report entries are ALWAYS plain hashes: the report crosses the
          # HtmlDialog JSON bridge, and a ScannedEntity struct serializes as
          # an opaque "#<struct …>" string (losing reason/instanceRef in the
          # UI). Scanner leftovers keep their own reason.
          requires_review = scan_result.requires_review.map { |item| review_item(item) } + demoted

          if plan.empty?
            return report(committed: false, aborted: false, plan: [],
                          requires_review: requires_review,
                          error: nil)
          end

          migrated_items = []
          model.start_operation(operation_name(plan.length), true)
          begin
            plan.each do |item|
              furniture = @furniture_builder.build_migrated_furniture(
                model, item[:entity], item[:definition], item[:parameters],
                item[:resolved_layout], item[:metadata],
                material_choices: item[:material_choices]
              )
              # The source is erased only AFTER its validated replacement
              # exists, inside the same operation (#416 step 5).
              model.active_entities.erase_entities([item[:entity]])
              migrated_items << item_report(item, furniture)
            end
            model.commit_operation
          rescue StandardError => e
            model.abort_operation
            return report(committed: false, aborted: true, plan: [],
                          requires_review: requires_review, error: e.message)
          end

          report(committed: true, aborted: false, plan: migrated_items,
                 requires_review: requires_review, error: nil)
        end

        private

        # Authoritative re-resolution happens before any host mutation: a
        # network/resolve failure must never leave a half-migrated model.
        def build_plan(ready_items)
          plan = []
          demoted = []
          ready_items.each do |item|
            definition_id = item.furniture_definition_id
            definition = @catalog_provider.find_definition(definition_id)
            if definition.nil?
              demoted << review_item(item, REASON_DEFINITION_NOT_FOUND,
                                     "la definición #{definition_id} ya no está en el catálogo")
              next
            end

            parameters = item.metadata.dig('intent', 'parameters') || {}
            material_choices = item.metadata.dig('intent', 'materialChoices') || {}
            resolved_layout, resolve_error = resolve_layout(definition_id, parameters, material_choices)
            if resolved_layout.nil?
              reason = resolve_error ? REASON_RESOLVE_FAILED : REASON_RESOLVE_UNAVAILABLE
              detail = resolve_error || 'Granete no pudo resolver el layout (sin conexión o catálogo local)'
              demoted << review_item(item, reason, detail)
              next
            end

            plan << { entity: item.entity, metadata: item.metadata, definition: definition,
                      parameters: parameters, material_choices: material_choices,
                      resolved_layout: resolved_layout }
          end
          [plan, demoted]
        end

        # [layout, nil] on success; [nil, message] when the resolution raised;
        # [nil, nil] when the provider cannot resolve at all (offline/static).
        def resolve_layout(definition_id, parameters, material_choices)
          layout = @catalog_provider.resolved_native_layout(definition_id, parameters, material_choices)
          [layout, nil]
        rescue StandardError => e
          [nil, e.message]
        end

        def operation_name(count)
          noun = count == 1 ? 'mueble' : 'muebles'
          "Migrar #{count} #{noun} a representación nativa"
        end

        def item_report(item, _furniture)
          {
            'instanceRef' => item[:metadata].dig('identity', 'instanceRef'),
            'name' => item[:definition]['name'],
            'definitionId' => item[:definition]['furniture_definition_id']
          }
        end

        def review_item(item, reason = nil, detail = nil)
          {
            'instanceRef' => item.instance_ref,
            'name' => item.entity.respond_to?(:name) ? item.entity.name : nil,
            'definitionId' => item.furniture_definition_id,
            'reason' => reason || item.reason || 'requires-review',
            'detail' => detail
          }
        end

        def report(committed:, aborted:, plan:, requires_review:, error:)
          {
            'success' => committed,
            'aborted' => aborted,
            'allMigrated' => committed && requires_review.empty?,
            'migratedCount' => committed ? plan.length : 0,
            'remainingLegacyCount' => requires_review.length,
            'migrated' => committed ? plan : [],
            'requiresReview' => requires_review,
            'error' => error,
            'reason' => aborted ? REASON_ABORTED : nil
          }
        end
      end
    end
  end
end
