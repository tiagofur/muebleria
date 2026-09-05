# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Spanish display copy and grouping tables of the #466 preflight
      # review. Display-only: behavior always branches on the stable issue
      # code, never on this copy or on localized server message text.
      # rubocop:disable-next Metrics/ModuleLength
      module PreflightReviewCopy
        # Closed issue-code → review category.
        CATEGORIES = {
          'parameters' => %w[
            PARAMETER_INVALID PARAMETER_UNKNOWN PARAMETER_REQUIRED PARAMETER_TYPE_INVALID
            PARAMETER_OUT_OF_RANGE PARAMETER_STEP_INVALID PARAMETER_ENUM_INVALID
            PARAMETER_STRING_TOO_LONG PARAMETER_DEFINITION_INVALID PARAMETER_BINDING_CONFLICT
          ],
          'materials' => %w[MATERIAL_CHOICE_INVALID],
          'relationships' => %w[
            RELATIONSHIP_INVALID RELATIONSHIP_ORPHANED JOINERY_SYSTEM_UNSUPPORTED
          ],
          'hardware' => %w[
            HARDWARE_HOST_INVALID HARDWARE_REFERENCE_INVALID HARDWARE_PLACEMENT_INVALID
            HARDWARE_DERIVED_EDIT HARDWARE_INCOMPATIBLE DRILLING_CONFLICT
          ],
          'structure' => %w[
            RESOLVE_GEOMETRY_INVALID OCCURRENCE_UNKNOWN_TEMPLATE OCCURRENCE_DUPLICATE_ID
            OCCURRENCE_COUNT_UNSUPPORTED SNAPSHOT_INCOMPLETE TRANSFORM_INVALID
          ],
          'catalog' => %w[
            SCHEMA_ID_MISMATCH SCHEMA_VERSION_UNSUPPORTED REQUEST_INVALID PAYLOAD_TOO_LARGE
            QUERY_PARAMETERS_UNSUPPORTED METHOD_NOT_ALLOWED AUTHENTICATION_REQUIRED
            ACCESS_FORBIDDEN CONTENT_TYPE_UNSUPPORTED CATALOG_REFERENCE_MISSING
            CATALOG_REVISION_STALE
          ]
        }.freeze

        CATEGORY_LABELS = {
          'parameters' => 'Parámetros',
          'materials' => 'Materiales',
          'relationships' => 'Relaciones constructivas',
          'hardware' => 'Herrajes y perforaciones',
          'structure' => 'Estructura del mueble',
          'catalog' => 'Catálogo y conexión'
        }.freeze

        # Spanish copy per stable code: `title` names the problem in user
        # language, `remediation` explains how to resolve it.
        ISSUE_COPY = {
          'DRILLING_CONFLICT' => {
            'title' => 'Conflicto de perforación',
            'remediation' => 'Dos perforaciones ocupan el mismo lugar. Mové el herraje o la ' \
                             'pieza en conflicto para respetar la separación mínima y volvé a verificar.'
          },
          'HARDWARE_PLACEMENT_INVALID' => {
            'title' => 'Colocación de herraje inválida',
            'remediation' => 'Ajustá la posición del herraje dentro de los límites de la pieza ' \
                             'anfitriona y volvé a verificar.'
          },
          'HARDWARE_HOST_INVALID' => {
            'title' => 'Pieza anfitriona inválida',
            'remediation' => 'El herraje está anclado a una pieza que no lo admite. Reubicá el ' \
                             'herraje sobre una pieza válida.'
          },
          'HARDWARE_REFERENCE_INVALID' => {
            'title' => 'Herraje de catálogo inválido',
            'remediation' => 'El herraje referenciado ya no es válido. Sustituilo por uno ' \
                             'compatible del catálogo.'
          },
          'HARDWARE_DERIVED_EDIT' => {
            'title' => 'Herraje derivado no editable',
            'remediation' => 'Este herraje se calcula por regla de ingeniería. Editá el ' \
                             'parámetro o relación que lo origina.'
          },
          'HARDWARE_INCOMPATIBLE' => {
            'title' => 'Herraje incompatible',
            'remediation' => 'El herraje no es compatible con esta pieza o configuración. ' \
                             'Elegí uno compatible del catálogo.'
          },
          'RELATIONSHIP_INVALID' => {
            'title' => 'Relación constructiva inválida',
            'remediation' => 'La relación entre piezas no es construible. Revisá la posición ' \
                             'de la pieza de origen.'
          },
          'RELATIONSHIP_ORPHANED' => {
            'title' => 'Relación sin pieza',
            'remediation' => 'Una relación constructiva quedó apuntando a una pieza ' \
                             'inexistente. Revisá la pieza de origen.'
          },
          'JOINERY_SYSTEM_UNSUPPORTED' => {
            'title' => 'Sistema de unión no soportado',
            'remediation' => 'El taller no puede ejecutar esta unión. Elegí un sistema de ' \
                             'unión soportado.'
          },
          'MATERIAL_CHOICE_INVALID' => {
            'title' => 'Material inválido',
            'remediation' => 'Elegí un material disponible del taller para el rol indicado.'
          },
          'RESOLVE_GEOMETRY_INVALID' => {
            'title' => 'Geometría no resoluble',
            'remediation' => 'La combinación de parámetros produce una geometría imposible. ' \
                             'Ajustá las medidas del mueble.'
          }
        }.freeze

        CATEGORY_REMEDIATION = {
          'parameters' => 'Ajustá el parámetro indicado en el editor del mueble y volvé a verificar.',
          'materials' => 'Elegí un material disponible del taller y volvé a verificar.',
          'hardware' => 'Corregí la colocación del herraje y volvé a verificar.',
          'relationships' => 'Revisá la pieza de origen de la relación y volvé a verificar.',
          'structure' => 'Ajustá la composición del mueble para que sea construible y volvé a verificar.',
          'catalog' => 'Verificá la conexión con Granete o actualizá el catálogo, y volvé a verificar.'
        }.freeze

        SOURCE_KIND_LABELS = {
          'part' => 'Pieza',
          'hardware' => 'Herraje',
          'relationship' => 'Relación constructiva',
          'furniture' => 'Mueble'
        }.freeze

        class << self
          def category_of(code)
            CATEGORIES.each do |category, codes|
              return category if codes.include?(code)
            end
            'catalog'
          end

          def title_for(code)
            ISSUE_COPY.dig(code, 'title') || CATEGORY_LABELS.fetch(category_of(code))
          end

          def remediation_for(code)
            ISSUE_COPY.dig(code, 'remediation') || CATEGORY_REMEDIATION.fetch(category_of(code))
          end

          def category_label(category)
            CATEGORY_LABELS.fetch(category)
          end

          def source_kind_label(kind)
            SOURCE_KIND_LABELS.fetch(kind, 'Mueble')
          end
        end
      end
    end
  end
end
