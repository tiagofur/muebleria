# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Minimal #471 batch payload validation. Runs BEFORE any command is
      # built or resolved, so a malformed batch — and critically one that
      # carries the same semantic furniture identity twice (A, A, B) — is
      # rejected up front instead of being partially applied or silently
      # deduplicated. Duplicates are a user-visible error: the honest fix
      # is an explicit rejection with a reason, never a quiet merge.
      module BatchItemsContract
        module_function

        # Returns nil when the items are structurally valid; a Spanish
        # rejection reason otherwise.
        def validate(items)
          return 'el lote debe ser una lista de muebles' unless items.is_a?(Array)
          return 'el lote está vacío' if items.empty?

          seen = {}
          items.each_with_index do |item, index|
            return "el item #{index} del lote no es un objeto" unless item.is_a?(Hash)

            identity = item['instanceId'] || item['furnitureInstanceRef'] ||
                       item['furnitureInstanceId']
            return "el item #{index} del lote no tiene identidad de mueble" if identity.to_s.strip.empty?
            return "el item #{index} del lote no declara definitionId" if item['definitionId'].to_s.strip.empty?

            key = item['furnitureInstanceId'] ? "id:#{identity}" : "ref:#{identity}"
            return 'el lote contiene la misma identidad más de una vez' if seen[key]

            seen[key] = true
          end
          nil
        end
      end
    end
  end
end
