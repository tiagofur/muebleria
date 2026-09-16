# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # MountFrameTool is an interactive SketchUp viewport tool for authoring
      # the mounting frame (MountFrame) of a hardware asset.
      # For a two-hole handle:
      # - Step 1: User picks Hole A center.
      # - Step 2: User picks Hole B center.
      # - Step 3: Tool constructs the orthonormal right-handed basis:
      #     Origin: midpoint between A and B
      #     +X: longitudinal axis pointing from A to B
      #     +Z: normal axis pointing outward from host surface (toggleable/inverting)
      #     +Y: in-plane axis perpendicular to X and Z (Y = Z x X)
      # - Viewport rendering:
      #     Red line (+X)
      #     Green line (+Y)
      #     Blue line (+Z)
      #     Point labels "A", "B", and origin anchor.
      #
      # rubocop:disable-next Metrics/ClassLength, SketchupSuggestions/ToolInvalidate
      class MountFrameTool
        MM_PER_INCH = 25.4
        AXIS_LENGTH_MM = 50.0

        COLOR_HOLE_A = [0, 180, 216].freeze    # Cyan
        COLOR_HOLE_B = [247, 37, 133].freeze   # Magenta
        COLOR_AXIS_X = [230, 57, 70].freeze    # Red (+X)
        COLOR_AXIS_Y = [42, 157, 143].freeze   # Green (+Y)
        COLOR_AXIS_Z = [33, 150, 243].freeze   # Blue (+Z)
        COLOR_LINE_AB = [255, 193, 7].freeze   # Amber

        LINE_WIDTH = 2
        AXIS_LINE_WIDTH = 3
        LABEL_SIZE = 13

        STATUS_TEXTS = {
          pick_a: 'Preparar montaje: Hacé clic para fijar el punto A (primer agujero).',
          pick_b: 'Preparar montaje: Hacé clic para fijar el punto B (segundo agujero).',
          ready: 'Montaje definido. Verificá ejes (+Z azul hacia afuera). Podés invertir o guardar.'
        }.freeze

        attr_reader :step, :point_a_mm, :point_b_mm, :mount_frame, :normal_inverted

        def initialize(expected_hole_spacing_mm: nil, tolerance_mm: 2.0, logger: nil, on_change: nil)
          @expected_hole_spacing_mm = expected_hole_spacing_mm
          @tolerance_mm = tolerance_mm
          @logger = logger
          @on_change = on_change

          @step = :pick_a
          @point_a_mm = nil
          @point_b_mm = nil
          @normal_inverted = false
          @mount_frame = nil

          @ip1 = defined?(::Sketchup::InputPoint) ? ::Sketchup::InputPoint.new : nil
          @ip2 = defined?(::Sketchup::InputPoint) ? ::Sketchup::InputPoint.new : nil
        end

        def activate
          update_status_text
          Sketchup.active_model&.active_view&.invalidate if defined?(Sketchup)
        end

        def deactivate(view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        def reset!
          @step = :pick_a
          @point_a_mm = nil
          @point_b_mm = nil
          @mount_frame = nil
          @normal_inverted = false
          update_status_text
          notify_change
          Sketchup.active_model&.active_view&.invalidate if defined?(Sketchup)
        end

        def set_points(hole_a_mm, hole_b_mm)
          @point_a_mm = hole_a_mm
          @point_b_mm = hole_b_mm
          @step = :ready
          recompute_mount_frame!
          update_status_text
          notify_change
          Sketchup.active_model&.active_view&.invalidate if defined?(Sketchup)
        end

        def invert_normal!
          @normal_inverted = !@normal_inverted
          recompute_mount_frame! if @point_a_mm && @point_b_mm
          update_status_text
          notify_change
          Sketchup.active_model&.active_view&.invalidate if defined?(Sketchup)
        end

        def onMouseMove(_flags, x_pos, y_pos, view)
          return unless @ip1 && view

          if @step == :pick_a
            @ip1.pick(view, x_pos, y_pos)
          elsif @step == :pick_b && @ip2
            @ip1.pick(view, x_pos, y_pos)
            @ip2.pick(view, x_pos, y_pos, @ip1)
          end
          view.invalidate
        end

        def onLButtonDown(_flags, _x_pos, _y_pos, view)
          return unless @ip1&.valid?

          pos = @ip1.position
          pt_mm = [pos.x * MM_PER_INCH, pos.y * MM_PER_INCH, pos.z * MM_PER_INCH]

          handle_click_at(pt_mm, view)
        end

        def onKeyDown(key, _repeat, _flags, view)
          return unless key == 27 # Escape key

          reset!
          view&.invalidate
        end

        # rubocop:disable-next Naming/MethodName
        def getExtents
          return nil unless defined?(::Geom::BoundingBox) && defined?(::Geom::Point3d)

          bb = ::Geom::BoundingBox.new
          bb.add(point_to_sketchup(@point_a_mm)) if @point_a_mm
          bb.add(point_to_sketchup(@point_b_mm)) if @point_b_mm
          add_mount_frame_extents(bb) if @mount_frame
          bb.valid? ? bb : nil
        end

        def draw(view)
          return unless view.respond_to?(:draw)

          @ip1&.draw(view) if @ip1&.valid?

          if @point_a_mm
            pt_a = point_to_sketchup(@point_a_mm)
            draw_point_marker(view, pt_a, COLOR_HOLE_A, 'A')
          end

          draw_point_b_and_connector(view) if @point_b_mm
          draw_mount_frame_gizmo(view) if @mount_frame
        end

        def measured_spacing_mm
          return nil unless @point_a_mm && @point_b_mm

          Assets::MountFrame.distance(@point_a_mm, @point_b_mm)
        end

        def spacing_comparison
          measured = measured_spacing_mm
          return nil unless measured && @expected_hole_spacing_mm

          Assets::MountFrame.compare_nominal_vs_measured(
            nominal: @expected_hole_spacing_mm,
            measured: measured,
            tolerance_mm: @tolerance_mm,
            dimension_name: 'distancia_entre_agujeros'
          )
        end

        private

        def handle_click_at(pt_mm, view)
          if @step == :pick_a
            @point_a_mm = pt_mm
            @step = :pick_b
            update_status_text
            notify_change
            view&.invalidate
          elsif @step == :pick_b
            dist = Assets::MountFrame.distance(@point_a_mm, pt_mm)
            return if dist < 1.0

            @point_b_mm = pt_mm
            @step = :ready
            recompute_mount_frame!
            update_status_text
            notify_change
            view&.invalidate
          end
        end

        def add_mount_frame_extents(bounding_box)
          origin_pt = point_to_sketchup(@mount_frame.origin_mm)
          bounding_box.add(origin_pt)
          %i[x y z].each do |axis|
            vec = @mount_frame.basis.send(axis)
            bounding_box.add(axis_endpoint(origin_pt, vec, AXIS_LENGTH_MM))
          end
        end

        def draw_point_b_and_connector(view)
          pt_b = point_to_sketchup(@point_b_mm)
          draw_point_marker(view, pt_b, COLOR_HOLE_B, 'B')
          return unless @point_a_mm

          view.drawing_color = color_for(view, COLOR_LINE_AB)
          view.line_width = LINE_WIDTH
          view.line_stipple = '_'
          view.draw(GL_LINES, [point_to_sketchup(@point_a_mm), pt_b])
        end

        def point_to_sketchup(pt_mm)
          ::Geom::Point3d.new(
            pt_mm[0] / MM_PER_INCH,
            pt_mm[1] / MM_PER_INCH,
            pt_mm[2] / MM_PER_INCH
          )
        end

        def recompute_mount_frame!
          return unless @point_a_mm && @point_b_mm

          normal_z = @normal_inverted ? [0.0, 0.0, -1.0] : [0.0, 0.0, 1.0]
          @mount_frame = Assets::MountFrame.build_handle_mount_frame(
            hole_a_mm: @point_a_mm,
            hole_b_mm: @point_b_mm,
            surface_normal_z: normal_z
          )
        rescue StandardError => e
          @logger&.error('mount_frame_recompute_failed', error: e)
          @mount_frame = nil
        end

        def update_status_text
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:status_text=)

          ::Sketchup.status_text = STATUS_TEXTS.fetch(@step, '')
        end

        def notify_change
          @on_change&.call(
            step: @step,
            point_a_mm: @point_a_mm,
            point_b_mm: @point_b_mm,
            measured_spacing_mm: measured_spacing_mm,
            mount_frame: @mount_frame,
            normal_inverted: @normal_inverted,
            spacing_comparison: spacing_comparison
          )
        end

        def draw_point_marker(view, point_marker, rgb, label)
          view.drawing_color = color_for(view, rgb)
          view.draw_points([point_marker], 8, 2, color_for(view, rgb)) if view.respond_to?(:draw_points)
          return unless view.respond_to?(:draw_text)

          label_pt = ::Geom::Point3d.new(point_marker.x, point_marker.y, point_marker.z + (6.0 / MM_PER_INCH))
          view.draw_text(label_pt, label, size: LABEL_SIZE, color: color_for(view, rgb), bold: true)
        end

        def draw_mount_frame_gizmo(view)
          origin = point_to_sketchup(@mount_frame.origin_mm)
          draw_point_marker(view, origin, [255, 255, 255], 'Origen')

          basis = @mount_frame.basis
          axes = [
            { name: '+X', vec: basis.x, color: COLOR_AXIS_X },
            { name: '+Y', vec: basis.y, color: COLOR_AXIS_Y },
            { name: '+Z', vec: basis.z, color: COLOR_AXIS_Z }
          ]

          view.line_width = AXIS_LINE_WIDTH
          view.line_stipple = ''
          axes.each do |axis|
            draw_axis_line(view, origin, axis)
          end
        end

        def draw_axis_line(view, origin, axis)
          vec = axis[:vec]
          tip = axis_endpoint(origin, vec, AXIS_LENGTH_MM)
          view.drawing_color = color_for(view, axis[:color])
          view.draw(GL_LINES, [origin, tip])
          return unless view.respond_to?(:draw_text)

          label_pt = axis_endpoint(tip, vec, 4.0)
          view.draw_text(label_pt, axis[:name], size: LABEL_SIZE, color: color_for(view, axis[:color]), bold: true)
        end

        def axis_endpoint(start_pt, vec, length_mm)
          scale = length_mm / MM_PER_INCH
          ::Geom::Point3d.new(
            start_pt.x + (vec[0] * scale),
            start_pt.y + (vec[1] * scale),
            start_pt.z + (vec[2] * scale)
          )
        end

        def color_for(view, rgb)
          return rgb unless view.respond_to?(:drawing_color=)

          ::Sketchup::Color.new(rgb[0], rgb[1], rgb[2])
        end
      end
    end
  end
end
