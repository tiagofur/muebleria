# frozen_string_literal: true

# Resuelve el metadata store del modelo activo (src de verdad de persistent ids).
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      class ActiveModelMetadataStore
        def initialize(factory)
          @factory = factory
        end

        def read(target)
          model = if target.respond_to?(:model) && target.model
                    target.model
                  elsif Sketchup.respond_to?(:active_model)
                    Sketchup.active_model
                  end
          return nil unless model

          @factory.call(model).read(target)
        end
      end

      # Login/logout callback handlers, extracted to keep DialogController
      # within the class-length budget.
    end
  end
end
