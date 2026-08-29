# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Spanish user-facing explanations for unsupported capabilities
      # (#476). One place for inspector copy: every disabled action states
      # why it is unavailable and, when known, how to resolve it or which
      # upcoming feature owns it.
      module CapabilityReasons
        LEGACY_MIGRATION = -> { Model::FurnitureBuilder::LEGACY_REPRESENTATION_ERROR }

        DEFINITION_MISSING = lambda do
          'La definición de este mueble ya no está disponible en el catálogo del taller. ' \
            'Iniciá sesión de nuevo o volvé a insertar el mueble desde la biblioteca.'
        end
        NO_MATERIAL_ROLES = lambda do
          'Esta definición no expone roles de material configurables.'
        end
        MATERIALS_WITHOUT_DEFINITION = lambda do
          'Sin definición de catálogo no se pueden cambiar los materiales.'
        end
        HIGH_LEVEL_HARDWARE = lambda do
          'La edición de herrajes a nivel mueble llega con la authoría de herrajes (#468).'
        end
        FURNITURE_DUPLICATE = lambda do
          'Duplicar todavía no asigna identidad Granete propia; insertá otra unidad ' \
            'desde la biblioteca (#391).'
        end
        TECHNICAL_REVIEW = lambda do
          'La revisión técnica de fabricación llega con su propio módulo (#466); ' \
            'hoy el estado permanece pendiente.'
        end
        INSPECT_MANUFACTURING = lambda do
          'La inspección de manufactura llega con el visor de mecanizados (#470).'
        end
        AGGREGATE_MOVE = lambda do
          'El movimiento de agregados internos llega con la authoría interna (#467).'
        end
        AGGREGATE_REMOVE = lambda do
          'La eliminación de agregados llega con la authoría interna (#467).'
        end
        PART_MOVE = lambda do
          'El movimiento directo de piezas internas llega con la authoría interna (#467): ' \
            'hoy las posiciones las resuelve Granete.'
        end
        PART_DUPLICATE = lambda do
          'Duplicar una pieza exige una nueva ocurrencia con identidad propia resuelta ' \
            'por Granete (#467).'
        end
        PART_ADD_RELATED = lambda do
          'Agregar piezas relacionadas llega con la authoría interna (#467).'
        end
        PART_REMOVE = lambda do
          'Quitar una pieza llega con la authoría interna (#467).'
        end
        PART_CHANGE_JOINERY = lambda do
          'El cambio de sistema de unión se resuelve desde los parámetros del mueble; ' \
            'la edición directa llega con #467.'
        end
        HARDWARE_MANUAL_EDIT = lambda do
          'La edición de colocaciones manuales llega con la authoría de herrajes (#468).'
        end
        HARDWARE_DERIVED_EDIT = lambda do
          'Herraje derivado de las reglas de la definición: corregilo desde su origen ' \
            '(parámetros/unión del mueble), no manualmente.'
        end
        HARDWARE_REPLACE = lambda do
          'El reemplazo por un herraje compatible llega con la authoría de herrajes (#468).'
        end
        INSPECT_MACHINING = lambda do
          'La inspección de mecanizados llega con el visor de mecanizados (#470).'
        end
      end
    end
  end
end
