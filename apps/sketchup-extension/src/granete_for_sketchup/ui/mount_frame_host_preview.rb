# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module UserInterface
      # MountFrameHostPreview manages isolated host geometry lifecycle for
      # mount frame authoring. It guarantees that geometry created during
      # a preparation session is tagged and selectively cleaned up without
      # touching any external instances or model geometry.
      class MountFrameHostPreview
        ATTR_DICT = 'granete_preparer'
        ATTR_KEY = 'session_id'
        MM_PER_INCH = 25.4

        def initialize(logger: nil)
          @logger = logger
        end

        def load_definition(model, skp_path, session_id)
          definition = model.definitions.load(skp_path)
          return nil unless definition

          definition.set_attribute(ATTR_DICT, ATTR_KEY, session_id)
          definition
        end

        def create_preview_group(model, definition, session_id)
          model.start_operation('Preparar Montaje', true)
          begin
            group = model.active_entities.add_group
            group.set_attribute(ATTR_DICT, ATTR_KEY, session_id)
            group.entities.add_instance(definition, Geom::Transformation.new)
            group
          ensure
            model.commit_operation
          end
        end

        def cleanup_preview(model, group, definition, session_id)
          return unless model

          model.start_operation('Limpiar Montaje', true)
          begin
            erase_preview_group(model, group, session_id)
            remove_definition_if_safe(model, definition, session_id)
          rescue StandardError => e
            @logger&.warn('preparer_cleanup_failed', error: e)
          ensure
            model.commit_operation
          end
        end

        def extract_measured_bounds(definition)
          return nil unless definition.respond_to?(:bounds) && definition.bounds

          bounds = definition.bounds
          return nil if bounds.empty?

          {
            'widthMm' => (bounds.width * MM_PER_INCH).round(1),
            'heightMm' => (bounds.height * MM_PER_INCH).round(1),
            'depthMm' => (bounds.depth * MM_PER_INCH).round(1),
            'diagonalMm' => (bounds.diagonal * MM_PER_INCH).round(1)
          }
        end

        private

        def erase_preview_group(model, group, session_id)
          return unless group&.valid?
          return unless group.get_attribute(ATTR_DICT, ATTR_KEY) == session_id

          model.active_entities.erase_entities(group)
        end

        def remove_definition_if_safe(model, definition, session_id)
          return unless definition&.valid?
          return unless definition.get_attribute(ATTR_DICT, ATTR_KEY) == session_id
          return unless definition.instances.empty?

          if model.definitions.respond_to?(:remove)
            model.definitions.remove(definition)
          else
            definition.entities.clear!
          end
        end
      end
    end
  end
end
