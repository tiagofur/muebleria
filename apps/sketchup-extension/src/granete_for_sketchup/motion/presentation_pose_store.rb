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
      # Un registro sólo cuenta entero: sin su pose cerrada no hay camino de
      # vuelta, así que a medias es «sin registro» (cerrado) y nunca levanta.
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
          record ? record['progress'].to_f > OPEN_THRESHOLD : false
        end

        # Transform cerrado canónico guardado; nil cuando la entidad no tiene
        # registro utilizable (cerrada).
        def closed_transform(entity)
          record = read(entity)
          return nil unless record

          ::Geom::Transformation.new(record['closedTransform'].map(&:to_f))
        end

        # True cuando la entidad trae un registro utilizable, abierta o a
        # medio cerrar. Lo que no trae registro está cerrado.
        def recorded?(entity)
          !read(entity).nil?
        end

        def read(entity)
          return unless entity.respond_to?(:get_attribute)

          raw = entity.get_attribute(DICTIONARY, KEY)
          return unless raw.is_a?(String) && !raw.empty?

          parsed = JSON.parse(raw)
          valid_record?(parsed) ? parsed : nil
        rescue StandardError
          # A record that cannot be read (corrupt, or a dead entity) is no
          # record: the actor reads closed, never as a guessed pose.
          nil
        end

        def valid_record?(record)
          return false unless record.is_a?(Hash) && finite_number?(record['progress'])

          values = record['closedTransform']
          values.is_a?(Array) && values.size == TRANSFORM_SIZE && values.all? { |value| finite_number?(value) }
        end

        def finite_number?(value)
          value.is_a?(Numeric) && value.respond_to?(:finite?) && value.finite?
        end

        private_class_method :read, :valid_record?, :finite_number?
      end
    end
  end
end
