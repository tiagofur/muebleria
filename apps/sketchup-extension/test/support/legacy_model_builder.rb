# frozen_string_literal: true

require_relative '../../src/granete_for_sketchup/metadata/store'
require_relative 'sketchup'

module Granete
  module SketchUpExtension
    # Builds legacy-representation scenes for #416 tests: furniture persisted
    # as top-level Sketchup::Group with the SAME namespaced metadata the
    # pre-#415 builder wrote (verified against git history of
    # MetadataWriter), plus nested component Groups carrying the legacy child
    # shape (kind 'componentInstance' WITHOUT componentInstanceId or
    # entityClass). Works on both the host stub and a real SketchUp host
    # (TestUp), so unit and real-host evidence build the same scene.
    module LegacyModelBuilder
      NAMESPACE = Metadata::Store::NAMESPACE
      METADATA_VERSION = Metadata::Store::METADATA_VERSION

      module_function

      # definition: catalog definition hash (provides furniture_definition_id
      # through the writer's intent). transform: world placement to preserve.
      def add_legacy_furniture(model, store, definition:, instance_ref:, parameters: {},
                               material_choices: nil, transform: nil, child_count: 2)
        group = model.active_entities.add_group
        group.name = "Mueble anterior #{instance_ref}"
        group.transformation = transform if transform && group.respond_to?(:transformation=)

        store.write(group, furniture_payload(store, definition, instance_ref,
                                             parameters, material_choices))
        child_count.times do |index|
          child = group.entities.add_group
          child.name = "componente anterior #{index}"
          store.write(child, child_payload(store, instance_ref, index))
        end
        group
      end

      def furniture_payload(store, definition, instance_ref, parameters, material_choices)
        intent = {
          'semanticRole' => 'furniture-instance',
          'furnitureDefinitionId' => definition['furniture_definition_id'],
          'parameters' => parameters
        }
        intent['materialChoices'] = material_choices if material_choices.is_a?(Hash) && !material_choices.empty?
        {
          'namespace' => NAMESPACE,
          'metadataVersion' => METADATA_VERSION,
          'kind' => 'furnitureInstance',
          'identity' => {
            'instanceRef' => instance_ref,
            'projectRef' => store.project_ref,
            'sourceRevisionRef' => 'rev-legacy'
          },
          'intent' => intent
        }
      end

      # Historical child shape: no componentInstanceId, no furnitureInstanceRef,
      # no entityClass — exactly what the pre-#415 builder persisted.
      def child_payload(store, instance_ref, index)
        {
          'namespace' => NAMESPACE,
          'metadataVersion' => METADATA_VERSION,
          'kind' => 'componentInstance',
          'identity' => {
            'instanceRef' => "#{instance_ref}-comp-#{index}",
            'projectRef' => store.project_ref
          },
          'intent' => { 'semanticRole' => "slot_#{index}" }
        }
      end
    end
  end
end
