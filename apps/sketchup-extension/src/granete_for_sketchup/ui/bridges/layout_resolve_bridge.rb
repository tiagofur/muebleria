# frozen_string_literal: true

# #1264 — model-context layout resolve: the server-resolved composition for
# a definition AT THE MODEL'S DESIGN CONTEXT. A design-bound model resolves
# WITH its designId so the persisted opening constrains the fronts of the
# design's furniture (nil keeps the definition-scoped semantics). Shared by
# the update/preview/component bridges and the opening geometry convergence.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      module LayoutResolveBridge
        # The design context of the bound model: nil when unbound (or when
        # the model cannot carry binding attributes — previews against mock
        # hosts stay definition-scoped).
        def authoring_design_id
          model = active_model
          return nil unless model.respond_to?(:get_attribute)

          binding = Connection::ModelBinding::Store.new(model).read
          binding&.design_id.to_s.strip.empty? ? nil : binding&.design_id
        end

        # Fetches the server-resolved composition for a definition at the
        # dialog's current parameters and board choices (role → material id),
        # parsed through the authoritative #414 transform contract. Granete
        # resolves the real furniture; nil falls back to the generic authoring
        # path (offline catalogs). A body the parser rejects fails loudly.
        def resolve_layout_for(definition, parameters, material_choices = nil, design_id = :binding)
          return nil unless @catalog_provider.respond_to?(:resolved_native_layout)

          resolved_design_id = design_id == :binding ? authoring_design_id : design_id
          @catalog_provider.resolved_native_layout(definition['furniture_definition_id'],
                                                   parameters || {}, material_choices || {},
                                                   resolved_design_id)
        end
      end
    end
  end
end
