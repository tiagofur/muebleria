# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Ephemeral viewport overlay tool (#470 / SU-VIS-1). Draws the
      # Granete-resolved manufacturing markers of the current scope with the
      # SketchUp Tool 2D-drawing API and picks them by screen proximity.
      #
      # Hard guarantees:
      #   - draw()/pick() only READ the view and the projected markers; the
      #     productive model is never touched (no entities, no operations,
      #     no metadata);
      #   - the tool draws whatever the manager currently holds: OFF or
      #     STALE-scoped scopes draw nothing productive, stale scopes draw
      #     dimmed markers;
      #   - markers are pure viewport pixels — nothing here can be scanned
      #     back into manufacturing truth because nothing is created;
      #   - a click on a marker selects the ManufacturingFeature (overlay
      #     state only); any other click delegates to the manager to write
      #     SketchUp's NATURAL model selection — the #476 SelectionObserver
      #     flow, identical to a click without the overlay, then updates
      #     the dialog and re-scopes this overlay. The tool never resolves
      #     selection semantics itself.
      #
      # Colors mirror the dialog design tokens (dialog.html :root):
      #   brand-500 / warning-700 / danger-600 / neutral-700.
      # rubocop:disable-next SketchupSuggestions/ToolInvalidate
      class InspectionTool
        COLOR_NORMAL = [77, 67, 193].freeze      # --brand-500 hsl(245 58% 51%)
        COLOR_ACTIVE = [147, 64, 16].freeze      # --warning-700 hsl(38 80% 32%)
        COLOR_CONFLICT = [220, 40, 40].freeze    # --danger-600 hsl(0 72% 51%)
        COLOR_STALE = [90, 110, 114].freeze      # --neutral-700 hsl(230 12% 40%)

        LINE_WIDTH_NORMAL = 2
        LINE_WIDTH_ACTIVE = 3
        LABEL_SIZE = 14

        def initialize(manager)
          @manager = manager
        end

        def activate; end

        def deactivate(view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        # Keeps markers visible when the camera frustum excludes them.
        # rubocop:disable-next Naming/MethodName
        def getExtents
          return unless defined?(Geom::BoundingBox)

          bounds = Geom::BoundingBox.new
          @manager.projected_features.each do |feature|
            bounds.add(feature.center)
            bounds.add(feature.depth_end)
          end
          bounds
        end

        def draw(view)
          return unless view.respond_to?(:draw)

          stale = @manager.stale?
          @manager.projected_features.each do |feature|
            draw_marker(view, feature, stale: stale)
          end
          draw_stale_banner(view) if stale && @manager.mode_on?
        end

        # rubocop:disable-next Naming/PredicateMethod, Naming/MethodParameterName
        def onLButtonDown(_flags, x, y, view)
          feature = ScreenPicker.pick(x, y, @manager.projected_features, view)
          if feature
            @manager.select_feature(feature.visual_id)
            view.invalidate if view.respond_to?(:invalidate)
            return true
          end

          # Any other click follows SketchUp's natural selection (#470): the
          # manager writes model.selection itself (replace on geometry, clear
          # on empty space) and the #476 SelectionObserver flow — the same
          # one that runs without the overlay — updates the dialog and
          # re-scopes this overlay. The tool consumes the click it performed.
          @manager.select_naturally(native_pick_under_cursor(x, y, view))
          true
        end

        def onCancel(_reason, view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        private

        def draw_marker(view, feature, stale:)
          active = @manager.active_feature_id == feature.visual_id
          color = if stale
                    COLOR_STALE
                  elsif feature.conflict?
                    COLOR_CONFLICT
                  else
                    COLOR_NORMAL
                  end
          color = COLOR_ACTIVE if active && !stale

          view.drawing_color = color_for(view, color)
          view.line_width = active ? LINE_WIDTH_ACTIVE : LINE_WIDTH_NORMAL
          view.line_stipple = stale ? '-' : ''
          view.draw(GL_LINE_LOOP, feature.ring_points)
          view.draw(GL_LINES, [feature.center, feature.depth_end])
          view.line_stipple = ''
          view.draw(GL_POINTS, [feature.center])

          return unless active && view.respond_to?(:draw_text)

          view.draw_text(feature.center, active_label(feature),
                         size: LABEL_SIZE, color: color_for(view, color),
                         bold: true)
        end

        def active_label(feature)
          feature = @manager.feature_by_projected_id(feature.visual_id)
          return '' unless feature

          "Ø#{feature.diameter_mm.to_i} · #{feature.type_label} · prof. #{feature.depth_mm} mm"
        end

        def draw_stale_banner(view)
          return unless view.respond_to?(:draw_text)

          view.draw_text(Geom::Point3d.new(12, 24, 0),
                         'Fabricación desactualizada: re-resolvé para ver el estado vigente',
                         size: LABEL_SIZE, color: color_for(view, COLOR_STALE), bold: true)
        end

        # The entity the native Select tool would pick under the cursor, or
        # nil for a click on empty space: the HOST's own pick resolution
        # (PickHelper#do_pick + #best_picked — the select-tool-equivalent
        # entity of the current editing context), never a hand-rolled path
        # walk in plugin code.
        # rubocop:disable-next Naming/MethodParameterName
        def native_pick_under_cursor(x, y, view)
          return nil unless view.respond_to?(:pick_helper)

          ph = view.pick_helper
          return nil unless ph.respond_to?(:do_pick)

          count = ph.do_pick(x, y)
          return nil unless count.is_a?(Integer) && count.positive?

          ph.best_picked if ph.respond_to?(:best_picked)
        rescue StandardError
          nil
        end

        def color_for(view, rgb)
          return rgb unless view.respond_to?(:drawing_color=)

          ::Sketchup::Color.new(rgb[0], rgb[1], rgb[2])
        end
      end
    end
  end
end
