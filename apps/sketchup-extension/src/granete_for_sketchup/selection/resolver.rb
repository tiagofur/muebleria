# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Resolves a SketchUp selection entity into the canonical
      # SelectionContext (#476). Resolution is metadata-driven: Granete
      # identity comes exclusively from the namespaced semantic metadata
      # written by the builder; host locators (persistent_id/InstancePath)
      # are captured as technical evidence only and names are display
      # labels. Entities without Granete metadata — including arbitrary user
      # Groups/ComponentInstances — resolve to kind=unmanaged, never to a
      # guessed Granete part.
      #
      # ID namespaces are never collapsed: the server-owned Digital Thread
      # IDs (furnitureInstanceId/projectId/designId/baseRevisionId, #384)
      # are only read from their OWN metadata keys; until that binding
      # exists they stay nil while the local refs (instanceRef/projectRef/
      # sourceRevisionRef) carry the locator truth.
      class Resolver
        FURNITURE_METADATA_KINDS = %w[furnitureInstance bootstrapIntent].freeze
        CHILD_METADATA_KINDS = %w[componentInstance partInstance].freeze
        LEGACY_HARDWARE_SIGNAL = 'hostComponentInstanceId'
        ENTITY_CLASSES = %w[part hardware aggregate].freeze

        def initialize(metadata_store:, catalog_provider: nil, model_provider: nil)
          @metadata_store = metadata_store
          @catalog_provider = catalog_provider
          @model_provider = model_provider || default_model_provider
        end

        # entity nil (no selection) resolves to nil; any host entity resolves
        # to a SelectionContext, including kind=unmanaged.
        def resolve(entity)
          return nil if entity.nil?

          return with_capabilities(unmanaged_context(entity, 'none')) unless entity.respond_to?(:get_attribute)

          metadata = read_metadata(entity)
          return with_capabilities(unmanaged_context(entity, 'none')) if metadata.nil?

          kind = metadata['kind']
          context = if FURNITURE_METADATA_KINDS.include?(kind)
                      furniture_context(entity, metadata)
                    elsif CHILD_METADATA_KINDS.include?(kind)
                      child_context(entity, metadata)
                    else
                      unmanaged_context(entity, 'none')
                    end
          with_capabilities(context)
        end

        private

        def default_model_provider
          lambda do
            defined?(Sketchup) && Sketchup.respond_to?(:active_model) ? Sketchup.active_model : nil
          end
        end

        # Corrupt stored metadata fails closed to unmanaged with an honest
        # note — it is never interpreted as a managed identity.
        def read_metadata(entity)
          @metadata_store.read(entity)
        rescue Metadata::InvalidMetadataError
          nil
        end

        def furniture_context(entity, metadata)
          identity = metadata['identity'] || {}
          intent = metadata['intent'] || {}
          definition_id = intent['furnitureDefinitionId']
          definition = find_definition(definition_id)

          SelectionContext.new(
            kind: 'furniture',
            furniture_instance_id: identity['furnitureInstanceId'],
            furniture_instance_ref: identity['instanceRef'],
            furniture_definition_id: definition_id,
            project_id: identity['projectId'],
            project_ref: identity['projectRef'],
            design_id: identity['designId'],
            design_ref: identity['designRef'],
            base_revision_id: identity['baseRevisionId'],
            source_revision_ref: identity['sourceRevisionRef'],
            representation: native_component_instance?(entity) ? 'native' : 'legacy-group',
            host_locator: host_locator(entity),
            semantic_path: [display_name(entity, definition)],
            display: { 'name' => display_name(entity, definition) },
            definition: definition,
            parameters: intent['parameters'] || {},
            material_choices: intent['materialChoices'] || {}
          )
        end

        def child_context(entity, metadata)
          identity = metadata['identity'] || {}
          intent = metadata['intent'] || {}
          entity_class = resolve_entity_class(intent)
          owner_ref = identity['furnitureInstanceRef']
          recovery, owner_entity = owner_recovery(entity, owner_ref)

          common = {
            furniture_instance_ref: owner_ref,
            host_locator: host_locator(entity, owner_entity),
            semantic_path: semantic_path(entity, owner_entity),
            display: child_display(entity, intent),
            owner_recovery: recovery
          }

          case entity_class
          when 'hardware'
            hardware_context(metadata, common)
          when 'aggregate'
            SelectionContext.new(kind: 'aggregate', component_instance_id: identity['instanceRef'],
                                 **common)
          else
            SelectionContext.new(
              kind: 'part',
              component_instance_id: identity['instanceRef'],
              component_definition_id: identity['componentDefinitionId'],
              catalog_component_id: identity['catalogComponentId'],
              **common
            )
          end
        end

        def hardware_context(metadata, common)
          identity = metadata['identity'] || {}
          intent = metadata['intent'] || {}
          placement_id = identity['hardwarePlacementId'] || identity['instanceRef']

          SelectionContext.new(
            kind: 'hardware',
            hardware_placement_id: placement_id,
            hardware_definition_id: intent['hardwareDefinitionId'],
            host_component_instance_id: intent[LEGACY_HARDWARE_SIGNAL],
            anchor_face: intent['anchorFace'],
            offset_mm: intent['offsetMm'],
            # Real #350 provenance from the layout contract; anything absent
            # or unrecognized stays 'unknown' and fails closed — the context
            # never guesses 'derived'.
            placement_kind: placement_kind(intent['placementKind']),
            **common
          )
        end

        def placement_kind(kind)
          case kind
          when 'manual', 'derived' then kind
          else 'unknown'
          end
        end

        # Explicit entityClass wins. Metadata written before #476 has no
        # discriminator, so the legacy read uses the structured hardware host
        # binding — never names — until #416's migration refreshes it.
        def resolve_entity_class(intent)
          entity_class = intent['entityClass']
          return entity_class if ENTITY_CLASSES.include?(entity_class)

          intent[LEGACY_HARDWARE_SIGNAL] ? 'hardware' : 'part'
        end

        def unmanaged_context(entity, recovery)
          SelectionContext.new(
            kind: 'unmanaged',
            host_locator: host_locator(entity),
            display: { 'name' => display_name(entity) },
            owner_recovery: recovery
          )
        end

        def find_definition(definition_id)
          return nil if definition_id.nil? || !@catalog_provider.respond_to?(:find_definition)

          @catalog_provider.find_definition(definition_id)
        end

        # Owning-furniture recovery for a nested child, by descending trust:
        #
        #   path    — the host's real active editing path (Model#active_path,
        #             openable via Model#active_path= since SU 2020) roots at
        #             the furniture the user is actually inside: the selected
        #             child belongs to that editing context (active_entities),
        #             so the path root IS the owner — pre-#391 copies sharing
        #             definition and metadata are disambiguated by it;
        #   scan    — exactly ONE root entity carries the child's ref;
        #   ambiguous — several root entities carry the same ref (native
        #             copy/paste before #391): NEVER silently pick the first;
        #   none    — no root entity carries the ref (owner deleted, etc.).
        #
        # The semantic identity never depends on this recovery: the child
        # metadata already carries furnitureInstanceRef.
        def owner_recovery(entity, furniture_ref)
          owner = owner_from_active_path(entity, furniture_ref)
          return ['path', owner] if owner

          candidates = owner_scan_candidates(furniture_ref)
          case candidates.length
          when 1 then ['scan', candidates.first]
          when 0 then ['none', nil]
          else ['ambiguous', nil]
          end
        end

        def owner_from_active_path(_entity, furniture_ref)
          model = @model_provider.call
          return nil unless model.respond_to?(:active_path)

          path = model.active_path
          return nil unless path.is_a?(Array) && !path.empty?

          # Host reality: active_path holds the OPEN instance chain only —
          # the selected entity itself lives in active_entities and is NOT a
          # path member. The path ROOT is the top-level instance being
          # edited, i.e. the owner of everything selectable right now; the
          # ref match keeps an outdated/mismatched path from winning.
          root = path.first
          return nil unless root.respond_to?(:get_attribute)

          metadata = read_metadata(root)
          return nil unless FURNITURE_METADATA_KINDS.include?(metadata && metadata['kind'])
          return nil if furniture_ref && metadata.dig('identity', 'instanceRef') != furniture_ref

          root
        end

        def owner_scan_candidates(furniture_ref)
          return [] if furniture_ref.nil?

          model = @model_provider.call
          return [] unless model.respond_to?(:entities)

          # Managed furniture always lives at the model ROOT; active_entities
          # would be whatever context the user has open for editing, so this
          # read-only scan must stay on model.entities.
          model.entities.select do |candidate| # rubocop:disable SketchupSuggestions/ModelEntities
            next false unless candidate.respond_to?(:get_attribute)

            metadata = read_metadata(candidate)
            FURNITURE_METADATA_KINDS.include?(metadata && metadata['kind']) &&
              metadata.dig('identity', 'instanceRef') == furniture_ref
          end
        end

        def semantic_path(entity, owner_entity)
          path = []
          path << display_name(owner_entity) if owner_entity
          path << display_name(entity)
          path
        end

        def child_display(entity, intent)
          display = { 'name' => display_name(entity) }
          display['role'] = intent['semanticRole'] if intent['semanticRole']
          display
        end

        def display_name(entity, definition = nil)
          fallback = definition.is_a?(Hash) ? definition['name'] : nil
          name = entity.respond_to?(:name) ? entity.name : nil
          fallback || name
        end

        def host_locator(entity, owner_entity = nil)
          locator = {}
          locator['entityPersistentId'] = entity.persistent_id if entity.respond_to?(:persistent_id)
          locator['furniturePersistentId'] = owner_entity.persistent_id if owner_entity.respond_to?(:persistent_id)
          locator.empty? ? nil : locator
        end

        def native_component_instance?(entity)
          defined?(::Sketchup::ComponentInstance) && entity.is_a?(::Sketchup::ComponentInstance)
        end

        def with_capabilities(context)
          context.capabilities = CapabilityPolicy.compute(context)
          context
        end
      end
    end
  end
end
