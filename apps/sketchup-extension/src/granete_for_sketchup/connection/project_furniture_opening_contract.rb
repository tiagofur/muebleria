# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        module Contract
          # #1330/#1344 — the durable opening selection with its frozen pin:
          # envelope-validated, contents verbatim. Read-only consumer here.
          module OpeningContract
            ALLOWED_KEYS = %w[system profileId placements profilePin].freeze

            def self.parse!(raw)
              return nil if raw.nil?
              raise ContractError, 'opening de authoring_defaults inválida' unless raw.is_a?(Hash)

              reject_unknown!(raw, ALLOWED_KEYS, 'opening')
              system = raw['system']
              valid_system = system.is_a?(String) && !system.strip.empty?
              raise ContractError, 'opening sin system válido' unless valid_system

              # The pin's contents are the server-frozen slice (#1263): the
              # plugin reads the frozen code and never owns the payload, so
              # only the identity is validated — enumerating the pin keys
              # here would break on every honest server addition (#1344).
              pin = raw['profilePin']
              return nil if pin.nil?
              raise ContractError, 'profilePin de opening inválido' unless pin.is_a?(Hash)

              code = pin['profileCode']
              valid_code = code.is_a?(String) && !code.strip.empty?
              raise ContractError, 'profilePin sin profileCode válido' unless valid_code

              raw
            end

            def self.working_defaults_raw(body)
              defaults = body['authoring_defaults']
              defaults.is_a?(Hash) ? defaults.except('opening') : defaults
            end

            def self.opening_raw(body)
              defaults = body['authoring_defaults']
              defaults.is_a?(Hash) ? defaults['opening'] : nil
            end

            def self.reject_unknown!(hash, allowed, label)
              unknown = hash.keys - allowed
              return if unknown.empty?

              raise ContractError, "#{label} con claves desconocidas: #{unknown.inspect}"
            end
          end
        end
      end
    end
  end
end
