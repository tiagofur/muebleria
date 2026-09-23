# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # #469 — preview-only extents derivation from the authoritative
      # resolved layout. Prefers the layout's top-level dimensionsMm
      # ([width, height, depth] → local X=width, Y=depth, Z=height); when
      # absent, derives the local AABB of the resolved boards (#414
      # transforms). Preview/compat math only: never baked into part
      # geometry (interaction-model §7 keeps the AABB as preview-only).
      module PlacementPreviewExtents
        module_function

        def from_layout(layout)
          from_dimensions(layout.respond_to?(:dimensions_mm) ? layout.dimensions_mm : nil) ||
            boards_extents(layout.respond_to?(:boards) ? layout.boards : [])
        end

        def from_dimensions(dims)
          return nil unless dims.is_a?(Array) && dims.length == 3 && dims.all? { |v| v.to_f.positive? }

          { x: dims[0].to_f, y: dims[2].to_f, z: dims[1].to_f }
        end

        def boards_extents(boards)
          min = [Float::INFINITY, Float::INFINITY, Float::INFINITY]
          max = [-Float::INFINITY, -Float::INFINITY, -Float::INFINITY]
          boards.each do |board|
            corners_for_board(board).each { |corner| fold_corner(corner, min, max) }
          end
          return nil unless min.all?(&:finite?) && max.all?(&:finite?)

          { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] }
        end

        def fold_corner(corner, min, max)
          3.times do |axis|
            min[axis] = corner[axis] if corner[axis] < min[axis]
            max[axis] = corner[axis] if corner[axis] > max[axis]
          end
        end

        # Local box corners of one resolved board: its #414 transform
        # (translationMm + orthonormal basis) applied to the local
        # [0,width]×[0,thickness]×[0,length] box, all in mm.
        def corners_for_board(board)
          translation = board.respond_to?(:translation) ? board.translation : nil
          basis = board.respond_to?(:basis) ? board.basis : nil
          return [] unless translation.is_a?(Array) && basis.is_a?(Hash)

          size = board_size(board)
          [0.0, 1.0].repeated_permutation(3).map do |flags|
            local = [flags[0] * size[0], flags[1] * size[1], flags[2] * size[2]]
            transformed_corner(translation, basis, local)
          end
        end

        def transformed_corner(translation, basis, local)
          3.times.map do |axis|
            translation[axis] +
              ((basis['x'][axis] * local[0]) + (basis['y'][axis] * local[1]) +
               (basis['z'][axis] * local[2]))
          end
        end

        def board_size(board)
          %i[width_mm thickness_mm length_mm].map do |getter|
            board.respond_to?(getter) && board.public_send(getter) ? board.public_send(getter).to_f : 0.0
          end
        end
      end

      # #469 — transient viewport painting for the placement preview. Pure
      # View#draw calls: the wireframe box, the highlighted front (+Y) face
      # and the visible anchor marker never enter model.entities.
      module PlacementPreviewPainter
        MM_PER_INCH = 25.4
        COLOR_BOX = [41, 128, 185].freeze        # Blue — transient preview box
        COLOR_FRONT = [230, 126, 34].freeze      # Orange — front face (+Y)
        COLOR_ANCHOR = [39, 174, 96].freeze      # Green — active anchor
        LINE_WIDTH = 2
        ANCHOR_LABEL_SIZE = 13

        private

        # Corners ring: 0=BLB, 1=BRB, 2=FRB, 3=FLB (bottom), 4..7 the same
        # order on the top face.
        def draw_box_edges(view, corners)
          view.drawing_color = preview_color(view, COLOR_BOX)
          view.line_width = LINE_WIDTH
          view.line_stipple = '_'
          view.draw(GL_LINES, edges_from_corners(corners)) if defined?(GL_LINES)
        end

        def edges_from_corners(corners)
          segments = []
          4.times do |i|
            segments << corners[i] << corners[(i + 1) % 4]
            segments << corners[4 + i] << corners[4 + ((i + 1) % 4)]
            segments << corners[i] << corners[4 + i]
          end
          segments
        end

        # The +Y face at max depth (front per the engine convention) gets
        # its own closed outline so the designer reads orientation before
        # the commit click (#469 acceptance: front understandable).
        def draw_front_face(view, corners)
          view.drawing_color = preview_color(view, COLOR_FRONT)
          view.line_width = LINE_WIDTH
          view.line_stipple = ''
          view.draw(GL_LINE_LOOP, [corners[2], corners[3], corners[7], corners[6]]) \
            if defined?(GL_LINE_LOOP)
        end

        def draw_anchor_marker(view, anchor_point, anchor_label)
          view.drawing_color = preview_color(view, COLOR_ANCHOR)
          view.draw_points([anchor_point], 8, 2, preview_color(view, COLOR_ANCHOR)) \
            if view.respond_to?(:draw_points)
          return unless view.respond_to?(:draw_text)

          label_pt = ::Geom::Point3d.new(anchor_point.x, anchor_point.y,
                                         anchor_point.z + (6.0 / MM_PER_INCH))
          view.draw_text(label_pt, "Ancla · #{anchor_label}",
                         size: ANCHOR_LABEL_SIZE, color: preview_color(view, COLOR_ANCHOR), bold: true)
        end

        def preview_color(view, rgb)
          return rgb unless view.respond_to?(:drawing_color=)

          defined?(::Sketchup::Color) ? ::Sketchup::Color.new(rgb[0], rgb[1], rgb[2]) : rgb
        end

        def write_status_text(text)
          return unless defined?(::Sketchup) && ::Sketchup.respond_to?(:status_text=)

          ::Sketchup.status_text = text
        end
      end

      # #469 — shared transient placement preview for Library and Project
      # furniture entry points (designer-workflow §4/§7, interaction-model §6).
      #
      # Interaction-only tool: it holds NO transport, NO catalog service and
      # NO furniture builder, so a cursor move can never issue a server
      # request or mutate the model. The preview is drawn purely through
      # View#draw — no entity, definition or metadata is ever created, so
      # managed scans, WorkingCopy, commercial quantities, undo history and
      # publication cannot see it (zero residue by construction, #469 §4.3).
      #
      # Furniture-local frame is the engine convention (layout X=width,
      # Y=depth with the front at +Y/max-depth, Z=height, origin at the
      # back-left-bottom corner). The semantic anchor names that corner of
      # the resolved extents the user "grabs"; Tab cycles it, ←/→ rotate in
      # quarter turns about +Z through the anchor. Both affect ONLY the
      # preview/top-level transform — never dimensions, geometry, materials
      # or machining (#469 §5).
      #
      # The click hands the ACCEPTED transform to the caller's canonical
      # commit command via on_commit; identity provenance stays entirely
      # with the caller (Project reuses an existing furnitureInstanceId;
      # Library mints one through #390 at commit — never during preview).
      #
      # rubocop:disable-next Metrics/ClassLength, SketchupSuggestions/ToolInvalidate
      class FurniturePlacementTool
        include PlacementPreviewPainter

        MM_PER_INCH = 25.4

        ANCHORS = %i[back_left_bottom back_right_bottom front_left_bottom
                     front_right_bottom].freeze
        ANCHOR_LABELS = {
          back_left_bottom: 'esquina posterior izquierda (base)',
          back_right_bottom: 'esquina posterior derecha (base)',
          front_left_bottom: 'esquina frontal izquierda (base)',
          front_right_bottom: 'esquina frontal derecha (base)'
        }.freeze

        KEY_ESCAPE = 27
        KEY_TAB = 9
        # SketchUp forwards raw OS key codes on onKeyDown: Windows virtual
        # keys for the arrows are 37/39, classic Mac key codes 28/29. Both
        # are accepted so rotation works on either host (pinned by the
        # TestUp rehearsal spec; unit tests inject codes directly).
        KEYS_LEFT = [37, 28].freeze
        KEYS_RIGHT = [39, 29].freeze

        attr_reader :anchor, :rotation_quarters

        # extents_mm: furniture-local box extents {x: width, y: depth,
        # z: height} in millimetres, derived from the authoritative resolved
        # layout by the caller (outside the cursor loop). on_commit receives
        # the accepted Geom::Transformation; on_cancel receives a reason
        # (:escape / :tool_switched). Both fire at most once.
        def initialize(label:, extents_mm:, on_commit:, on_cancel:, anchor: :back_left_bottom, input_point_factory: nil,
                       model_provider: nil, logger: nil)
          unless extents_mm.is_a?(Hash) && %i[x y z].all? { |axis| extents_mm[axis].to_f.positive? }
            raise ArgumentError, 'extents_mm requiere x/y/z positivos (mm) del layout resuelto'
          end
          unless ANCHORS.include?(anchor.to_sym)
            raise ArgumentError, "ancla desconocida: #{anchor} (soportadas: #{ANCHORS.join(', ')})"
          end

          @label = label.to_s
          @extents_mm = { x: extents_mm[:x].to_f, y: extents_mm[:y].to_f, z: extents_mm[:z].to_f }
          @anchor = anchor.to_sym
          @rotation_quarters = 0
          @on_commit = on_commit
          @on_cancel = on_cancel
          @logger = logger
          @model_provider = model_provider
          @state = :active
          @cursor_mm = [0.0, 0.0, 0.0]
          @has_cursor = false
          @input_point = if input_point_factory
                           input_point_factory.call
                         else
                           (defined?(::Sketchup::InputPoint) ? ::Sketchup::InputPoint.new : nil)
                         end
        end

        # Preview-only extents derivation from the authoritative layout —
        # delegated so callers and tests share one authority.
        def self.extents_from_layout(layout)
          PlacementPreviewExtents.from_layout(layout)
        end

        def active?
          @state == :active
        end

        def committed?
          @state == :committed
        end

        def cancelled?
          @state == :cancelled
        end

        def activate
          update_status_text
          invalidate_view
        end

        # Tool switched away, model closed, or another surface took over:
        # an uncommitted preview is a cancel with zero residue — never a
        # ghost placement applied to the new context.
        def deactivate(view)
          cancel!(:tool_switched) if active?
          view.invalidate if view.respond_to?(:invalidate)
        end

        def suspend(view)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        def resume(view)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        # Cursor loop: InputPoint picking + invalidation only. There is
        # nothing else this tool CAN do — it holds no service handles.
        def onMouseMove(_flags, x_pos, y_pos, view)
          return unless active?
          return unless @input_point && view

          @input_point.pick(view, x_pos, y_pos)
          if @input_point.respond_to?(:valid?) && @input_point.valid? &&
             @input_point.respond_to?(:position)
            position = @input_point.position
            @cursor_mm = [position.x.to_f * MM_PER_INCH, position.y.to_f * MM_PER_INCH,
                          position.z.to_f * MM_PER_INCH]
            @has_cursor = true
          end
          view.invalidate
        end

        # The placement click commits exactly once: a double click, a
        # rebound callback or a late event after the terminal state is
        # ignored (one gesture = one placement, #469 §4.2).
        def onLButtonDown(_flags, _x_pos, _y_pos, view)
          return unless active?
          return unless @has_cursor

          transform = current_transform
          return unless transform

          finish!(:committed)
          view&.invalidate if view.respond_to?(:invalidate)
          @on_commit.call(transform)
          restore_selection_tool
        end

        def onKeyDown(key, _repeat, _flags, view)
          return unless active?

          case key
          when KEY_ESCAPE then cancel!(:escape)
          when KEY_TAB then cycle_anchor!
          when *KEYS_LEFT then rotate!(-1)
          when *KEYS_RIGHT then rotate!(1)
          end
          view&.invalidate if view.respond_to?(:invalidate)
        end

        # SketchUp also routes Esc through onCancel (tool protocol).
        def onCancel(_reason, view)
          cancel!(:escape)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        # Keeps the transient box inside the view's drawing frustum.
        # rubocop:disable-next Naming/MethodName
        def getExtents
          return nil unless defined?(::Geom::BoundingBox)

          box = ::Geom::BoundingBox.new
          preview_corners.each { |point| box.add(point) if box.respond_to?(:add) }
          box
        end

        # Transient wireframe only: the box, a highlighted front face and
        # the visible active anchor. Nothing enters model.entities.
        def draw(view)
          return unless active? && @has_cursor && view.respond_to?(:draw)

          corners = preview_corners
          return if corners.length != 8

          draw_box_edges(view, corners)
          draw_front_face(view, corners)
          draw_anchor_marker(view, corners[anchor_corner_index], ANCHOR_LABELS[@anchor])
        end

        # The accepted top-level transform: the anchor corner sits at the
        # inference point and the furniture frame is rotated about +Z
        # through that anchor. Rigid by construction — axes() only accepts
        # orthonormal input, and quarter turns are exact.
        def current_transform
          return nil unless @has_cursor
          return nil unless defined?(::Geom::Transformation) && defined?(::Geom::Point3d) &&
                            defined?(::Geom::Vector3d)

          anchor_pt = ::Geom::Point3d.new(@cursor_mm[0] / MM_PER_INCH,
                                          @cursor_mm[1] / MM_PER_INCH,
                                          @cursor_mm[2] / MM_PER_INCH)
          ::Geom::Transformation.axes(anchor_pt,
                                      ::Geom::Vector3d.new(*basis_for_rotation(:x)),
                                      ::Geom::Vector3d.new(*basis_for_rotation(:y)),
                                      ::Geom::Vector3d.new(*basis_for_rotation(:z))) *
            ::Geom::Transformation.translation(
              ::Geom::Vector3d.new(-anchor_local_point[0] / MM_PER_INCH,
                                   -anchor_local_point[1] / MM_PER_INCH,
                                   -anchor_local_point[2] / MM_PER_INCH)
            )
        end

        private

        def finish!(state)
          @state = state
          clear_status_text
        end

        def cancel!(reason)
          return unless active?

          finish!(:cancelled)
          invalidate_view
          @on_cancel.call(reason)
          restore_selection_tool
        end

        def cycle_anchor!
          @anchor = ANCHORS[(ANCHORS.index(@anchor) + 1) % ANCHORS.length]
          update_status_text
        end

        def rotate!(direction)
          @rotation_quarters = (((@rotation_quarters + direction) % 4) + 4) % 4
          update_status_text
        end

        # Quarter-turn basis about +Z (front stays front under rotation —
        # the frame turns with the furniture, never mirrors).
        def basis_for_rotation(axis)
          x = [1.0, 0.0, 0.0]
          y = [0.0, 1.0, 0.0]
          z = [0.0, 0.0, 1.0]
          @rotation_quarters.abs.times { x, y = rotate_pair(x, y) }
          { x: x, y: y, z: z }.fetch(axis)
        end

        # One +90° turn about +Z: x̂ → ŷ, ŷ → -x̂ (right-handed, no mirror).
        def rotate_pair(x_vec, y_vec)
          [y_vec.dup, [-x_vec[0], -x_vec[1], -x_vec[2]]]
        end

        # The anchor's local point in mm: back = y 0, front = y depth;
        # left = x 0, right = x width; bottom = z 0.
        def anchor_local_point
          x = @anchor.to_s.include?('right') ? @extents_mm[:x] : 0.0
          y = @anchor.to_s.include?('front') ? @extents_mm[:y] : 0.0
          [x, y, 0.0]
        end

        # Local box corners (mm): ring 0..3 is the bottom face (0=BLB,
        # 1=BRB, 2=FRB, 3=FLB), 4..7 the same ring on the top face.
        def local_corners_mm
          w = @extents_mm[:x]
          d = @extents_mm[:y]
          h = @extents_mm[:z]
          bottom = [[0.0, 0.0, 0.0], [w, 0.0, 0.0], [w, d, 0.0], [0.0, d, 0.0]]
          bottom.map(&:dup) + bottom.map { |c| [c[0], c[1], h] }
        end

        def anchor_corner_index
          { back_left_bottom: 0, back_right_bottom: 1,
            front_right_bottom: 2, front_left_bottom: 3 }.fetch(@anchor)
        end

        def preview_corners
          return [] unless @has_cursor

          transform = current_transform
          return [] unless transform

          local_corners_mm.filter_map do |corner|
            point = ::Geom::Point3d.new(corner[0] / MM_PER_INCH, corner[1] / MM_PER_INCH,
                                        corner[2] / MM_PER_INCH)
            point.respond_to?(:transform) ? point.transform(transform) : point
          end
        end

        def restore_selection_tool
          model = @model_provider&.call
          model&.select_tool(nil)
        rescue StandardError => e
          @logger&.warn('placement_tool_restore_failed', error: e)
        end

        def update_status_text
          write_status_text(
            "Colocar #{@label}: clic para confirmar · Esc para cancelar · " \
            "←/→ rotar · Tab ancla (#{ANCHOR_LABELS[@anchor]})"
          )
        end

        def clear_status_text
          write_status_text('')
        end

        def invalidate_view
          return unless defined?(::Sketchup)

          ::Sketchup.active_model&.active_view&.invalidate
        end
      end
    end
  end
end
