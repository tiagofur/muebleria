# frozen_string_literal: true

require 'json'

# #1633 — etiqueta de altura por ensamble (cajón) de un mueble. El layout del
# servidor nombra la altura que resolvió cada bahía (`heightLabel`); la
# materialización la guarda en la definición del mueble y el escáner de
# cajones (DoorActors) la usa para rotular «Cajón 1 · altura M». Sólo
# presentación: nunca decide fabricación ni identidad.
module Granete
  module SketchUpExtension
    module Metadata
      module AssemblyHeightLabels
        DICTIONARY = 'com.granete.sketchup_extension'
        KEY = 'assembly_height_labels.v1'

        module_function

        # labels: { assemblyInstanceId => label }. Un mapa vacío borra el
        # dato anterior (la bahía ya no tiene alturas tras un resolve).
        def write(definition, labels)
          return unless definition.respond_to?(:set_attribute)

          clean = labels.each_with_object({}) do |(id, label), acc|
            text = label.to_s.strip
            acc[id.to_s] = text unless id.to_s.strip.empty? || text.empty?
          end
          if clean.empty?
            if definition.respond_to?(:delete_attribute)
              definition.delete_attribute(DICTIONARY, KEY)
            else
              definition.set_attribute(DICTIONARY, KEY, '{}')
            end
          else
            definition.set_attribute(DICTIONARY, KEY, JSON.generate(clean))
          end
        end

        def read(definition)
          return {} unless definition.respond_to?(:get_attribute)

          raw = definition.get_attribute(DICTIONARY, KEY)
          return {} unless raw.is_a?(String) && !raw.empty?

          parsed = JSON.parse(raw)
          parsed.is_a?(Hash) ? parsed : {}
        rescue JSON::ParserError
          {}
        end
      end
    end
  end
end
