# frozen_string_literal: true

module Granete
  module SketchUpExtension
    # Legacy Group → native ComponentInstance representation migration
    # (#416 / SU-ENT-3, native-entity-model §19).
    #
    # Classification is deterministic and metadata-driven: a managed entity is
    # whatever carries the namespaced Granete dictionary — display names,
    # geometry, dimensions and host locators are NEVER consulted as identity.
    # Legacy and native metadata share the same dictionary/kind; the ONLY
    # discriminator is the host entity class (Group vs ComponentInstance).
    module Migration
      TAXONOMY_NATIVE = 'native_component_model'
      TAXONOMY_LEGACY = 'legacy_group_model'
      TAXONOMY_UNSUPPORTED = 'unsupported_or_corrupt'
      TAXONOMY_UNMANAGED = 'unmanaged_geometry'

      STATE_READY = 'ready'
      STATE_REQUIRES_REVIEW = 'requires_review'

      REASON_MISSING_DEFINITION_ID = 'missing-furniture-definition-id'
      REASON_CORRUPT_METADATA = 'corrupt-metadata'
      REASON_ROOT_KIND_NOT_FURNITURE = 'root-kind-not-furniture'

      # One classified top-level entity. `state` only applies to the legacy
      # taxonomy (ready vs requires_review); native/unmanaged carry none.
      ScannedEntity = Struct.new(:entity, :taxonomy, :state, :reason, :metadata,
                                 keyword_init: true) do
        def legacy?
          taxonomy == TAXONOMY_LEGACY
        end

        def ready?
          legacy? && state == STATE_READY
        end

        def instance_ref
          metadata&.dig('identity', 'instanceRef')
        end

        def furniture_definition_id
          metadata&.dig('intent', 'furnitureDefinitionId')
        end
      end

      # Aggregate classification of one model. Counts drive the review
      # workflow (#416): detected/ready/requires_review refer to LEGACY
      # furniture only — native and unmanaged entities never enter the batch.
      class ScanResult
        attr_reader :entities

        def initialize(entities)
          @entities = entities
        end

        def legacy
          entities.select(&:legacy?)
        end

        def ready
          entities.select(&:ready?)
        end

        def requires_review
          entities.select { |entity| entity.legacy? && entity.state == STATE_REQUIRES_REVIEW }
        end

        def unsupported
          entities.select { |entity| entity.taxonomy == TAXONOMY_UNSUPPORTED }
        end

        def any_legacy?
          !legacy.empty?
        end

        def counts
          {
            'detected' => legacy.length,
            'ready' => ready.length,
            'requiresReview' => requires_review.length,
            'unsupported' => unsupported.length,
            'unmanaged' => entities.count { |entity| entity.taxonomy == TAXONOMY_UNMANAGED }
          }
        end
      end

      # Scans top-level model entities and classifies each Granete-marked one
      # into the #416 taxonomy. Legacy furniture nested inside user container
      # groups is out of scope for V1 (the review only batch-migrates
      # top-level units, matching the resolver's root ownership scan).
      class Scanner
        def initialize(metadata_store:)
          @metadata_store = metadata_store
        end

        def scan(model)
          entities = (model.respond_to?(:active_entities) ? model.active_entities : []).to_a
          classified = entities.filter_map { |entity| classify(entity) }
          ScanResult.new(classified)
        end

        private

        # Only host container entities participate: loose faces/edges at the
        # root are unmanaged geometry by definition and are skipped without
        # reading metadata.
        def classify(entity)
          group_like = entity.is_a?(::Sketchup::Group) || entity.is_a?(::Sketchup::ComponentInstance)
          return ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_UNMANAGED) unless group_like

          metadata, error = safe_read(entity)
          # nil metadata without error = no Granete dictionary at all: the
          # entity is user geometry and never enters the review.
          return ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_UNMANAGED) if metadata.nil? && error.nil?
          return corrupt(entity, error) if error

          case metadata['kind']
          when 'furnitureInstance'
            classify_furniture(entity, metadata)
          else
            # Granete-marked but not a furniture root (orphaned child,
            # bootstrap marker at root): never silently converted.
            ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_UNSUPPORTED,
                              reason: REASON_ROOT_KIND_NOT_FURNITURE, metadata: metadata)
          end
        end

        def classify_furniture(entity, metadata)
          if entity.is_a?(::Sketchup::ComponentInstance)
            ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_NATIVE, metadata: metadata)
          else
            classify_legacy(entity, metadata)
          end
        end

        def classify_legacy(entity, metadata)
          definition_id = metadata.dig('intent', 'furnitureDefinitionId')
          if definition_id.is_a?(String) && !definition_id.strip.empty?
            ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_LEGACY,
                              state: STATE_READY, metadata: metadata)
          else
            # Without the catalog definition id Granete cannot re-resolve the
            # furniture; the item is exposed for review instead of guessed.
            ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_LEGACY,
                              state: STATE_REQUIRES_REVIEW,
                              reason: REASON_MISSING_DEFINITION_ID, metadata: metadata)
          end
        end

        # [metadata, nil] on success, [nil, error] when the Granete-marked
        # entity carries metadata that does not validate.
        def safe_read(entity)
          [@metadata_store.read(entity), nil]
        rescue Metadata::InvalidMetadataError => e
          [nil, e]
        end

        def corrupt(entity, error)
          ScannedEntity.new(entity: entity, taxonomy: TAXONOMY_UNSUPPORTED,
                            reason: REASON_CORRUPT_METADATA,
                            metadata: { 'error' => error.message })
        end
      end
    end
  end
end
