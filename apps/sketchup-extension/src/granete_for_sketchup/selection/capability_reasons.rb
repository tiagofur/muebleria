# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # Spanish user-facing explanations for unsupported capabilities
      # (#476). One place for inspector copy: every disabled action states
      # why it is unavailable in user language and, when known, how to
      # resolve it. Internal tracking numbers deliberately stay out of this
      # product copy; they live in the technical detail/diagnostics layer.
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
          'La edición de herrajes a nivel mueble estará disponible en una próxima versión.'
        end
        FURNITURE_DUPLICATE = lambda do
          'Duplicar todavía no asigna identidad propia; insertá otra unidad desde la biblioteca.'
        end
        TECHNICAL_REVIEW = lambda do
          'La revisión técnica de fabricación todavía no está disponible; ' \
            'el estado permanece pendiente.'
        end
        INSPECT_MANUFACTURING = lambda do
          'La inspección de manufactura estará disponible con el visor de mecanizados.'
        end
        AGGREGATE_MOVE = lambda do
          'El movimiento de agregados internos llegará con la autoría interna.'
        end
        AGGREGATE_REMOVE = lambda do
          'La eliminación de agregados llegará con la autoría interna.'
        end
        PART_STRUCTURAL = lambda do
          'Las piezas estructurales mantienen la posición y cantidad definidas por la ' \
            'definición del mueble; la autoría directa aplica a los internos movibles ' \
            '(p. ej. entrepaños).'
        end
        PART_PLACEMENT_UNKNOWN = lambda do
          'Falta la capacidad de autoría publicada por Granete para esta pieza (modelo o layout ' \
            'anterior a la autoría interna). Reinsertá el mueble desde la biblioteca o ' \
            'actualizá la extensión.'
        end
        PART_CHANGE_JOINERY = lambda do
          'El sistema de unión se cambia desde los parámetros del mueble.'
        end
        HARDWARE_MANUAL_EDIT = lambda do
          'La edición de colocaciones manuales llegará con la autoría de herrajes.'
        end
        HARDWARE_DERIVED_EDIT = lambda do
          'Herraje derivado de las reglas de la definición: corregilo desde su origen ' \
            '(parámetros o unión del mueble), no manualmente.'
        end
        HARDWARE_UNKNOWN_EDIT = lambda do
          'Origen del herraje sin determinar: faltan datos de procedencia. ' \
            'Reinsertá el mueble desde la biblioteca o actualizá la extensión.'
        end
        HARDWARE_REPLACE = lambda do
          'El reemplazo por un herraje compatible llegará con la autoría de herrajes.'
        end
        INSPECT_MACHINING = lambda do
          'La inspección de mecanizados estará disponible con el visor de mecanizados.'
        end
      end
    end
  end
end
