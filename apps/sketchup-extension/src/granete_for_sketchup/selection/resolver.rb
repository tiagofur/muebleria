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
      class Resolver
        FURNITURE_METADATA_KINDS = %w[furnitureInstance bootstrapIntent].freeze
        CHILD_METADATA_KINDS = %w[componentInstance partInstance].freeze
        LEGACY_HARDWARE_SIGNAL = 'hostComponentInstanceId'

        def initialize(metadata_store:, catalog_provider: nil, model_provider: nil)
          @metadata_store = metadata_store
          @catalog_provider = catalog_provider
          @model_provider = model_provider || default_model_provider
        end

        # entity nil (no selection) resolves to nil; any host entity resolves
        # to a SelectionContext, including kind=unmanaged.
        def resolve(entity)
          return nil if entity.nil?

          return with_capabilities(unmanaged_context(entity)) unless entity.respond_to?(:get_attribute)

          metadata = read_metadata(entity)
          return with_capabilities(unmanaged_context(entity)) if metadata.nil?

          kind = metadata['kind']
          context = if FURNITURE_METADATA_KINDS.include?(kind)
                      furniture_context(entity, metadata)
                    elsif CHILD_METADATA_KINDS.include?(kind)
                      child_context(entity, metadata)
                    else
                      unmanaged_context(entity)
                    end
          with_capabilities(context)
        end

        private

        def with_capabilities(context)
          context.capabilities = CapabilityPolicy.compute(context)
          context
        end

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
            furniture_instance_id: identity['instanceRef'],
            furniture_definition_id: definition_id,
            project_id: identity['projectRef'],
            base_revision_id: identity['sourceRevisionRef'],
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
          owner_entity = owner_entity(owner_ref)

          common = {
            furniture_instance_id: owner_ref,
            project_id: identity['projectRef'],
            host_locator: host_locator(entity, owner_entity),
            semantic_path: semantic_path(entity, owner_entity),
            display: child_display(entity, intent)
          }

          case entity_class
          when 'hardware'
            hardware_context(entity, metadata, common)
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

        def hardware_context(_entity, metadata, common)
          identity = metadata['identity'] || {}
          intent = metadata['intent'] || {}

          SelectionContext.new(
            kind: 'hardware',
            component_instance_id: identity['instanceRef'],
            hardware_placement_id: identity['instanceRef'],
            hardware_definition_id: intent['hardwareDefinitionId'],
            host_component_instance_id: intent[LEGACY_HARDWARE_SIGNAL],
            # Every hardware the current builder writes comes from a Granete
            # resolved layout; manual placements arrive with #468, which
            # writes 'manual' explicitly.
            origin: intent['placementOrigin'] || 'resolved',
            **common
          )
        end

        # Explicit entityClass wins. Metadata written before #476 has no
        # discriminator, so the legacy read uses the structured hardware host
        # binding — never names — until #416's migration refreshes it.
        def resolve_entity_class(intent)
          entity_class = intent['entityClass']
          return entity_class if %w[part hardware aggregate].include?(entity_class)

          intent[LEGACY_HARDWARE_SIGNAL] ? 'hardware' : 'part'
        end

        def unmanaged_context(entity)
          SelectionContext.new(
            kind: 'unmanaged',
            host_locator: host_locator(entity),
            display: { 'name' => display_name(entity) }
          )
        end

        def find_definition(definition_id)
          return nil if definition_id.nil? || !@catalog_provider.respond_to?(:find_definition)

          @catalog_provider.find_definition(definition_id)
        end

        # The owning furniture ENTITY is host evidence for the breadcrumb and
        # navigation; the semantic identity (furnitureInstanceId) comes from
        # the child metadata and stays valid even when the entity is gone.
        def owner_entity(furniture_ref)
          return nil if furniture_ref.nil?

          model = @model_provider.call
          return nil unless model.respond_to?(:entities)

          # Managed furniture always lives at the model ROOT; active_entities
          # would be whatever context the user has open for editing, so this
          # read-only scan must stay on model.entities.
          model.entities.find do |candidate| # rubocop:disable SketchupSuggestions/ModelEntities
            next false unless candidate.respond_to?(:get_attribute)

            metadata = read_metadata(candidate)
            next false if metadata.nil?

            FURNITURE_METADATA_KINDS.include?(metadata['kind']) &&
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
      end
    end
  end
end
