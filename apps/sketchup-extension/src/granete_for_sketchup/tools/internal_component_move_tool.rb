# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # #467 / SU-AUTH-1: constrained viewport gesture for moving a movable
      # internal component. The drag is locked to the furniture's vertical
      # axis, the preview is drawn with the 2D view API as PURE viewport
      # pixels, and a click submits the same semantic move intent the
      # inspector's precise-mm path uses — Granete re-resolves and the #498
      # coordinator rebuilds atomically. The tool itself never mutates
      # entities, definitions or metadata.
      #
      # SketchUp lengths are inches: every Geom computation here converts to
      # millimeters before leaving the tool.
      # rubocop:disable SketchupSuggestions/ToolInvalidate
      class InternalComponentMoveTool
        MM_PER_INCH = 25.4
        COLOR_PREVIEW = [77, 67, 193].freeze   # --brand-500 (dialog tokens)
        COLOR_GHOST = [90, 110, 114].freeze    # --neutral-700
        LINE_WIDTH = 2
        LABEL_SIZE = 14

        STATUS_HINT = 'Arrastrá para mover a lo alto; clic confirma, Esc cancela.'

        def initialize(furniture:, child:, base_translation_mm:, logger: nil, &on_commit)
          @furniture = furniture
          @child = child
          @base_translation_mm = base_translation_mm
          @logger = logger
          @on_commit = on_commit
          @delta_mm = 0.0
          @committed = false
        end

        def activate
          Sketchup.status_text = STATUS_HINT if defined?(Sketchup) && Sketchup.respond_to?(:status_text=)
        end

        def deactivate(view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        def draw(view)
          return unless view.respond_to?(:draw)

          bounds = current_child_bounds
          draw_bounds_wireframe(view, bounds, COLOR_GHOST) if bounds
          preview = preview_bounds
          draw_bounds_wireframe(view, preview, COLOR_PREVIEW) if preview
          draw_delta_label(view, preview) if preview && view.respond_to?(:draw_text)
        end

        # Keeps the preview visible when the camera frustum excludes it.
        # rubocop:disable Naming/MethodName
        def getExtents
          preview_bounds || current_child_bounds
        end

        # rubocop:disable Naming/MethodParameterName
        def onMouseMove(_flags, x, y, view)
          @delta_mm = delta_mm_at(x, y, view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        # SketchUp Tool API: returning true consumes the click.
        # rubocop:disable Naming/PredicateMethod
        def onLButtonDown(_flags, _x, _y, view)
          commit
          view.invalidate if view.respond_to?(:invalidate)
          true
        end
        # rubocop:enable Naming/PredicateMethod, Naming/MethodParameterName, Naming/MethodName

        def onCancel(_reason, view)
          @committed = true
          view.model.select_tool(nil) if view.respond_to?(:model)
          view.invalidate if view.respond_to?(:invalidate)
        end

        private

        def commit
          return if @committed

          @committed = true
          translation = @base_translation_mm.dup
          translation[2] = (@base_translation_mm[2] + @delta_mm).round(1)
          model = @furniture.respond_to?(:model) ? @furniture.model : nil
          model.select_tool(nil) if model.respond_to?(:select_tool)
          @on_commit.call(translation)
        rescue StandardError => e
          @logger&.error('component_viewport_move_commit_failed', error: e)
        end

        # Signed movement along the furniture's vertical axis: intersect the
        # cursor ray with the vertical line through the component center and
        # project the offset onto the axis.
        def delta_mm_at(screen_x, screen_y, view)
          ray = view.pickray(screen_x, screen_y)
          return 0.0 unless ray.is_a?(Array) && ray.length == 2

          anchor = axis_anchor
          direction = vertical_direction
          point = Geom.intersect_line_line(ray, [anchor, direction])
          return 0.0 unless point.is_a?(Geom::Point3d)

          offset_in = (point - anchor) % direction
          offset_in * MM_PER_INCH
        rescue StandardError
          0.0
        end

        def axis_anchor
          @axis_anchor ||= current_child_bounds&.center ||
                           (@child.respond_to?(:bounds) ? @child.bounds.center : Geom::Point3d.new)
        end

        # Vertical axis of the furniture in world space (its world transform
        # applied to the assembly Z axis) — the constrained authoring axis.
        def vertical_direction
          @vertical_direction ||= begin
            transform = @furniture.respond_to?(:transformation) ? @furniture.transformation : nil
            direction = if transform.respond_to?(:*)
                          transform * Geom::Vector3d.new(0, 0, 1)
                        else
                          Geom::Vector3d.new(0, 0, 1)
                        end
            direction.normalize
          end
        end

        def preview_bounds
          return nil if (@delta_mm.abs < 0.01) || !defined?(Geom::BoundingBox)

          bounds = current_child_bounds
          return nil unless bounds

          translation = Geom::Transformation.translation(
            vertical_direction * (@delta_mm / MM_PER_INCH)
          )
          translated = Geom::BoundingBox.new
          bounds_corners(bounds).each do |corner|
            translated.add(corner.transform(translation))
          end
          translated
        end

        def current_child_bounds
          return nil unless @child.respond_to?(:bounds)

          bounds = @child.bounds
          bounds.respond_to?(:valid?) && bounds.valid? ? bounds : nil
        end

        # The eight AABB corners, ordered so indices 0–3 form the min-Z face
        # and 4–7 the max-Z face (wireframe edges index into this order).
        def bounds_corners(bounds)
          [false, true].flat_map do |max_z|
            [false, true].flat_map do |max_y|
              [false, true].map do |max_x|
                Geom::Point3d.new(
                  max_x ? bounds.max.x : bounds.min.x,
                  max_y ? bounds.max.y : bounds.min.y,
                  max_z ? bounds.max.z : bounds.min.z
                )
              end
            end
          end
        end

        def draw_bounds_wireframe(view, bounds, rgb)
          corners = bounds_corners(bounds)
          edges = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4],
                   [0, 4], [1, 5], [2, 6], [3, 7]]
          view.drawing_color = color_for(view, rgb)
          view.line_width = LINE_WIDTH
          view.line_stipple = ''
          edges.each do |start_index, end_index|
            view.draw(GL_LINES, [corners[start_index], corners[end_index]])
          end
        rescue StandardError => e
          @logger&.warn('component_viewport_move_draw_failed', error: e)
        end

        def draw_delta_label(view, bounds)
          height_mm = @base_translation_mm[2] + @delta_mm
          view.draw_text(Geom::Point3d.new(bounds.min.x, bounds.max.y, bounds.max.z),
                         "Z #{format('%.1f', height_mm)} mm",
                         size: LABEL_SIZE, color: color_for(view, COLOR_PREVIEW), bold: true)
        rescue StandardError => e
          @logger&.warn('component_viewport_move_label_failed', error: e)
        end

        def color_for(view, rgb)
          return rgb unless view.respond_to?(:drawing_color=)

          ::Sketchup::Color.new(rgb[0], rgb[1], rgb[2])
        end
      end
    end
  end
end
# rubocop:enable SketchupSuggestions/ToolInvalidate
