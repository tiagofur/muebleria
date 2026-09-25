# frozen_string_literal: true

# AppObserver de SketchUp: rebind al cambiar de modelo abierto.
# Contrato: métodos de instancia incluidos en DialogController (ui/dialog_controller.rb).

module Granete
  module SketchUpExtension
    module UserInterface
      class AppModelObserver < (defined?(::Sketchup::AppObserver) ? ::Sketchup::AppObserver : Object)
        def initialize(on_model_change:)
          super() if defined?(::Sketchup::AppObserver)
          @on_model_change = on_model_change
        end

        def onNewModel(model)
          @on_model_change.call(model)
        end

        def onOpenModel(model)
          @on_model_change.call(model)
        end

        def onActivateModel(model)
          @on_model_change.call(model)
        end
      end

      # Selection and model lifecycle observer bridge for keeping the dialog in sync with SketchUp.
    end
  end
end
