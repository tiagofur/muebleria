# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Motion
      # #1717 — pose de presentación de una entidad movida por la apertura
      # (frente de puerta, pieza de cajón, herraje montado), guardada CON la
      # entidad para que sobreviva a guardar y reabrir el SKP. Una entidad
      # abierta registra hasta dónde abrió y desde qué transform cerrado
      # partió; una entidad cerrada no tiene registro. Sólo presentación:
      # nunca decide fabricación ni identidad, y nunca toca la metadata
      # semántica (`bootstrap_intent.v1`).
      module PresentationPoseStore
        DICTIONARY = 'com.granete.sketchup_extension'
        KEY = 'presentation_motion_pose.v1'
        TRANSFORM_SIZE = 16
        OPEN_THRESHOLD = 0.01

        module_function

        # progress: 0..1 (1.0 = totalmente abierto). closed_transform: la
        # pose cerrada canónica de la entidad, tomada ANTES de moverla.
        def write(entity, progress, closed_transform)
          return unless entity.respond_to?(:set_attribute)

          record = {
            'progress' => progress.to_f,
            'closedTransform' => closed_transform.to_a.map(&:to_f)
          }
          entity.set_attribute(DICTIONARY, KEY, JSON.generate(record))
        end

        def clear(entity)
          return unless entity.respond_to?(:delete_attribute)

          entity.delete_attribute(DICTIONARY, KEY)
        end

        def open?(entity)
          record = read(entity)
          record ? record.fetch('progress', 0.0).to_f > OPEN_THRESHOLD : false
        end

        # Transform cerrado canónico guardado; nil cuando la entidad no tiene
        # registro (cerrada) o el registro no sirve.
        def closed_transform(entity)
          record = read(entity)
          values = record && record['closedTransform']
          return nil unless valid_transform_values?(values)

          ::Geom::Transformation.new(values.map(&:to_f))
        end

        def read(entity)
          return unless entity.respond_to?(:get_attribute)

          raw = entity.get_attribute(DICTIONARY, KEY)
          return unless raw.is_a?(String) && !raw.empty?

          parsed = JSON.parse(raw)
          parsed.is_a?(Hash) ? parsed : nil
        rescue StandardError
          # A record that cannot be read (corrupt, or a dead entity) is no
          # record: the actor reads closed, never as a guessed pose.
          nil
        end

        def valid_transform_values?(values)
          values.is_a?(Array) && values.size == TRANSFORM_SIZE && values.all?(Numeric)
        end
      end
    end
  end
end
