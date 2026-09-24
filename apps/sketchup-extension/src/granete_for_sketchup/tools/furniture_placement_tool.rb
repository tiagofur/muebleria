# frozen_string_literal: true

# placement_snap_engine and placement_preview_extents are loaded by the
# extension root (main.rb); tests require them explicitly before this file.

module Granete
  module SketchUpExtension
    module Tools
      # #469 — transient viewport painting for the placement preview. Pure
      # View#draw calls: the wireframe box, the highlighted front (+Y) face
      # and the visible anchor marker never enter model.entities.
      module PlacementPreviewPainter
        MM_PER_INCH = 25.4
        COLOR_BOX = [41, 128, 185].freeze        # Blue — transient preview box
        COLOR_FRONT = [230, 126, 34].freeze      # Orange — front face (+Y)
        COLOR_ANCHOR = [39, 174, 96].freeze      # Green — active anchor
        COLOR_SNAP = [142, 68, 173].freeze       # Purple — active semantic snap
        LINE_WIDTH = 2
        ANCHOR_LABEL_SIZE = 13
        ANCHOR_LABEL_PIXEL_OFFSET = 14
        SNAP_LABEL_SIZE = 13
        SNAP_LABEL_PIXEL_OFFSET = 32

        # Preview-box corner rings per aligned side (bottom ring order:
        # 0=BLB, 1=BRB, 2=FRB, 3=FLB; 4..7 the same ring on the top face).
        SNAP_FACE_CORNERS = {
          back: [0, 1, 5, 4], left: [0, 3, 7, 4],
          right: [1, 2, 6, 5], bottom: [0, 3, 2, 1]
        }.freeze

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

          view.draw_text(anchor_label_point(view, anchor_point), "Ancla · #{anchor_label}",
                         size: ANCHOR_LABEL_SIZE, color: preview_color(view, COLOR_ANCHOR), bold: true)
        end

        # draw_text takes SCREEN coordinates: project the 3D anchor with
        # View#screen_coords and lift the label a few pixels above it.
        # Older surfaces without screen_coords fall back to the 3D offset.
        def anchor_label_point(view, anchor_point, pixel_offset = ANCHOR_LABEL_PIXEL_OFFSET)
          if view.respond_to?(:screen_coords)
            screen = view.screen_coords(anchor_point)
            return ::Geom::Point3d.new(screen.x, screen.y - pixel_offset, 0)
          end

          ::Geom::Point3d.new(anchor_point.x, anchor_point.y,
                              anchor_point.z + (6.0 / MM_PER_INCH))
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
      # quarter turns about +Z through the anchor (free-mode authoring
      # control — increment 3 keeps it quarter-turn by design). Semantic
      # snaps may instead propose an ARBITRARY yaw: the committed basis
      # derives from the solution's unit front vector. All of these affect
      # ONLY the preview/top-level transform — never dimensions, geometry,
      # materials or machining (#469 §5).
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

        attr_reader :anchor, :rotation_quarters, :active_snap

        # extents_mm: furniture-local box extents {x: width, y: depth,
        # z: height} in millimetres, derived from the authoritative resolved
        # layout by the caller (outside the cursor loop). on_commit receives
        # the accepted Geom::Transformation; on_cancel receives a reason
        # (:escape / :tool_switched). Both fire at most once.
        # furniture_targets_provider: optional pure-data callable returning
        # Granete-managed neighbor ORIENTED-FRAME descriptors for
        # side-to-side snapping ({furniture_instance_id:, label:,
        # origin_world_mm:, front_dir_mm:, right_dir_mm:, local_min_mm:,
        # local_max_mm:}). base_planes_provider: optional pure-data
        # callable returning horizontal host base-plane descriptors
        # ({point_mm:, normal_mm:}) so a wall snap and the floor COMPOSE
        # through the real tool. Both run exactly once per gesture (lazy
        # snapshot) plus once at the click (revalidation) — never once
        # per mouse event. They are data-in/data-out — the tool still
        # holds no transport, service or builder, so a cursor move can
        # neither issue a request nor mutate the model.
        # rubocop:disable-next Metrics/ParameterLists -- host-tool DI surface
        def initialize(label:, extents_mm:, on_commit:, on_cancel:, anchor: :back_left_bottom, input_point_factory: nil,
                       model_provider: nil, origin_mm: [0.0, 0.0, 0.0], logger: nil, furniture_targets_provider: nil,
                       base_planes_provider: nil)
          validate_constructor_input!(extents_mm, anchor, origin_mm)

          @label = label.to_s
          @extents_mm = { x: extents_mm[:x].to_f, y: extents_mm[:y].to_f, z: extents_mm[:z].to_f }
          @origin_mm = origin_mm.map(&:to_f)
          @anchor = anchor.to_sym
          @rotation_quarters = 0
          @on_commit = on_commit
          @on_cancel = on_cancel
          @logger = logger
          @model_provider = model_provider
          @furniture_targets_provider = furniture_targets_provider
          @base_planes_provider = base_planes_provider
          @state = :active
          @cursor_mm = [0.0, 0.0, 0.0]
          @has_cursor = false
          @active_snap = nil
          @snap_offset_mm = 0.0
          @snap_offset_key = nil
          @eye_mm = nil
          @managed_targets_snapshot = nil
          @base_planes_snapshot = nil
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

        def validate_constructor_input!(extents_mm, anchor, origin_mm)
          unless extents_mm.is_a?(Hash) && %i[x y z].all? { |axis| extents_mm[axis].to_f.positive? }
            raise ArgumentError, 'extents_mm requiere x/y/z positivos (mm) del layout resuelto'
          end
          unless ANCHORS.include?(anchor.to_sym)
            raise ArgumentError, "ancla desconocida: #{anchor} (soportadas: #{ANCHORS.join(', ')})"
          end
          unless origin_mm.is_a?(Array) && origin_mm.length == 3 &&
                 origin_mm.all? { |v| v.is_a?(Numeric) && Float(v).finite? }
            raise ArgumentError, 'origin_mm debe ser un triple numérico finito (mm)'
          end
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

        # Idempotent: the host activates via select_tool AND the controller
        # may activate explicitly — double activation must not double the
        # side effects.
        def activate
          return if @activated

          @activated = true
          update_status_text
          invalidate_view
        end

        # Tool switched away, model closed, or another surface took over:
        # an uncommitted preview is a cancel with zero residue — never a
        # ghost placement applied to the new context. Deactivation does NOT
        # restore the selection tool: the host already moved to whatever
        # tool the user chose, and select_tool(nil) here would clobber it.
        def deactivate(view)
          cancel!(:tool_switched, restore: false) if active?
          view.invalidate if view.respond_to?(:invalidate)
        end

        def suspend(view)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        def resume(view)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        # Cursor loop: InputPoint picking + snap discovery + invalidation
        # only. There is nothing else this tool CAN do — it holds no
        # service handles. An invalid pick INVALIDATES the previous
        # position AND its snap solution: a stale cursor never keeps the
        # preview (or a later click) anchored to an old inference point or
        # an old target.
        def onMouseMove(_flags, x_pos, y_pos, view)
          return unless active?
          return unless @input_point && view

          pick_position(view, x_pos, y_pos)
          view.invalidate
        end

        # The placement click commits exactly once: a double click, a
        # rebound callback or a late event after the terminal state is
        # ignored (one gesture = one placement, #469 §4.2). The click
        # RE-PICKS the inference at its click's own coordinates and
        # RE-FETCHES the managed-neighbor and base-plane snapshots
        # (revalidating the chosen targets against CURRENT model state —
        # a target erased, moved or rotated between gesture start and
        # click can never be committed against), then commits only on a
        # fresh valid position: the commit either uses a revalidated
        # snap or falls back to free placement at the fresh inference
        # (#469 stale-candidate rule).
        def onLButtonDown(_flags, x_pos, y_pos, view)
          return unless active?

          refresh_managed_targets!
          refresh_base_planes!
          pick_position(view, x_pos, y_pos)
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

        # Tells the host this tool consumes VCB/measurements input, so
        # SketchUp routes keyboard entry to the measurements box while the
        # placement is live (host protocol; no raw keyboard grabbing).
        # rubocop:disable-next Naming/MethodName -- host Tool protocol name
        def enableVCB?
          true
        end

        # SketchUp tool protocol: the user typed into the VCB/measurements
        # box. With an active snap the value is the EXACT gap in mm for the
        # primary constraint (wall / furniture side / floor). This is the
        # host-native input path — the tool never steals raw keyboard
        # events. Without an active snap there is no reference to offset,
        # and the input is answered with an actionable hint, never a guess.
        # rubocop:disable-next Naming/PredicateMethod -- host Tool protocol name
        def onUserText(text, _view)
          return false unless active?

          gap_mm = PlacementSnapEngine.parse_gap_mm(text.to_s)
          if @active_snap.nil?
            write_status_text('Sin snap activo: acércate a pared, piso o mueble para fijar una holgura exacta.')
            return true
          end
          if gap_mm.nil?
            write_status_text('Valor no válido: escribe la holgura en mm (p. ej. 5 o 5mm).')
            return true
          end

          @snap_offset_mm = gap_mm
          @snap_offset_key = @active_snap[:primary][:key]
          update_status_text
          invalidate_view
          true
        end

        # SketchUp also routes Esc through onCancel (tool protocol).
        def onCancel(_reason, view)
          cancel!(:escape)
          view&.invalidate if view.respond_to?(:invalidate)
        end

        # Controller-facing cancellation (e.g. the dialog closing with a
        # live preview): same single-shot semantics as Esc.
        def cancel_preview(reason)
          cancel!(reason)
        end

        # Keeps the transient box inside the view's drawing frustum.
        # rubocop:disable-next Naming/MethodName
        def getExtents
          return nil unless defined?(::Geom::BoundingBox)

          box = ::Geom::BoundingBox.new
          preview_corners.each { |point| box.add(point) if box.respond_to?(:add) }
          box
        end

        # Transient wireframe only: the box, a highlighted front face, the
        # visible active anchor and — with an active snap — the aligned
        # faces plus the snap label. Nothing enters model.entities.
        def draw(view)
          return unless active? && @has_cursor && view.respond_to?(:draw)

          corners = preview_corners
          return if corners.length != 8

          draw_box_edges(view, corners)
          draw_front_face(view, corners)
          draw_anchor_marker(view, corners[anchor_corner_index], ANCHOR_LABELS[@anchor])
          draw_snap_feedback(view, corners) if @active_snap
        end

        # The accepted top-level transform: the anchor corner sits at the
        # inference point — or at the snapped position when a semantic
        # candidate is active — and the furniture frame is oriented about
        # +Z through that anchor. A snap may propose an ARBITRARY yaw
        # (increment 3): the world front comes from the solution as a unit
        # horizontal vector and the basis is derived from it directly —
        # x = front × up, y = front, z = up — unit, orthogonal and
        # determinant +1 by construction (axes() only accepts orthonormal
        # input). Free mode keeps the exact quarter-turn basis. Snap and
        # offset NEVER scale, resize or touch productive geometry: only
        # this exterior transform moves.
        def current_transform
          return nil unless @has_cursor
          return nil unless defined?(::Geom::Transformation) && defined?(::Geom::Point3d) &&
                            defined?(::Geom::Vector3d)

          anchor_world = snapped_anchor_mm
          anchor_pt = ::Geom::Point3d.new(anchor_world[0] / MM_PER_INCH,
                                          anchor_world[1] / MM_PER_INCH,
                                          anchor_world[2] / MM_PER_INCH)
          x_axis, y_axis, z_axis = effective_basis
          ::Geom::Transformation.axes(anchor_pt,
                                      ::Geom::Vector3d.new(*x_axis),
                                      ::Geom::Vector3d.new(*y_axis),
                                      ::Geom::Vector3d.new(*z_axis)) *
            ::Geom::Transformation.translation(
              ::Geom::Vector3d.new(-anchor_local_point[0] / MM_PER_INCH,
                                   -anchor_local_point[1] / MM_PER_INCH,
                                   -anchor_local_point[2] / MM_PER_INCH)
            )
        end

        private

        # Shared inference read: pick at the given screen coordinates and
        # either adopt the fresh position (re-solving the snap from the
        # fresh data) or invalidate the previous one and its snap.
        def pick_position(view, x_pos, y_pos)
          return unless @input_point

          @eye_mm = camera_eye_mm(view)
          @input_point.pick(view, x_pos, y_pos)
          if @input_point.respond_to?(:valid?) && @input_point.valid? &&
             @input_point.respond_to?(:position)
            position = @input_point.position
            @cursor_mm = [position.x.to_f * MM_PER_INCH, position.y.to_f * MM_PER_INCH,
                          position.z.to_f * MM_PER_INCH]
            @has_cursor = true
            refresh_snap!
          else
            @has_cursor = false
            @active_snap = nil
          end
        end

        # #469 increments 2+3 — semantic snap refresh. Local-only candidate
        # discovery over pure data (InputPoint face + gesture-scoped base
        # planes + managed-neighbor descriptors + the viewing eye); the
        # deterministic engine ranks and composes (a picked wall COMPOSES
        # with the floor plane). No request, no mutation, no metadata
        # write.
        def refresh_snap!
          @active_snap = PlacementSnapEngine.solve(
            cursor_mm: @cursor_mm, extents_mm: @extents_mm, origin_mm: @origin_mm,
            anchor: @anchor, faces: inferenced_planes, managed_targets: managed_targets,
            eye_mm: @eye_mm
          )
          update_status_text
        end

        # The viewer's eye in mm — the deterministic room-side reference
        # for wall snapping (SketchUp face orientation is arbitrary; the
        # ±normal alone never decides the room). nil when the surface
        # exposes no camera: wall candidates are dropped, not guessed.
        def camera_eye_mm(view)
          camera = view.respond_to?(:camera) ? view.camera : nil
          eye = camera.respond_to?(:eye) ? camera.eye : nil
          return nil unless eye.respond_to?(:x)

          [eye.x.to_f * MM_PER_INCH, eye.y.to_f * MM_PER_INCH, eye.z.to_f * MM_PER_INCH]
        end

        # Snap sources: the host face under the cursor (the wall snap
        # source through the normal host mechanism: InputPoint face +
        # world normal) PLUS the gesture-scoped horizontal base planes,
        # so a picked wall and the floor COMPOSE in one solution. No
        # synthetic planes: the base planes come from real host faces via
        # the provider, and away from any face the preview keeps
        # following the raw inference exactly as #469 increment 1 did.
        def inferenced_planes
          picked_face_plane + base_planes
        end

        # The picked face as a plane descriptor (empty without a face).
        def picked_face_plane
          face = @input_point.respond_to?(:face) ? @input_point.face : nil
          return [] unless face.respond_to?(:normal)

          normal = face.normal
          if normal.respond_to?(:transform) && @input_point.respond_to?(:transformation) &&
             @input_point.transformation
            normal = normal.transform(@input_point.transformation)
          end
          [{ point_mm: @cursor_mm.dup,
             normal_mm: [normal.x.to_f, normal.y.to_f, normal.z.to_f] }]
        end

        # Horizontal base-plane descriptors SNAPSHOT for the gesture: the
        # provider (a local scan of top-level host faces) runs exactly
        # ONCE per cursor loop — mouse moves never re-scan the model. The
        # click re-fetches (#refresh_base_planes!) so the committed floor
        # constraint comes from CURRENT geometry.
        def base_planes
          return [] unless @base_planes_provider

          if @base_planes_snapshot.nil?
            planes = @base_planes_provider.call
            @base_planes_snapshot = planes.is_a?(Array) ? planes : []
          end
          @base_planes_snapshot
        end

        # Managed-neighbor descriptors SNAPSHOT for the gesture: the
        # provider (a full local model scan) runs exactly ONCE per cursor
        # loop — mouse moves never re-index the model. The click re-fetches
        # (#refresh_managed_targets!) to revalidate the chosen targets
        # against current model state before committing.
        def managed_targets
          return [] unless @furniture_targets_provider

          if @managed_targets_snapshot.nil?
            targets = @furniture_targets_provider.call
            @managed_targets_snapshot = targets.is_a?(Array) ? targets : []
          end
          @managed_targets_snapshot
        end

        # Commit-time revalidation: one fresh provider fetch replaces the
        # gesture snapshot so the committed solution is solved against
        # CURRENT entities — an erased or moved target simply stops being
        # a candidate instead of being committed against stale geometry.
        def refresh_managed_targets!
          return unless @furniture_targets_provider

          fresh = @furniture_targets_provider.call
          @managed_targets_snapshot = fresh.is_a?(Array) ? fresh : []
        end

        # Commit-time base-plane revalidation: the committed floor
        # constraint comes from the CURRENT host geometry.
        def refresh_base_planes!
          return unless @base_planes_provider

          fresh = @base_planes_provider.call
          @base_planes_snapshot = fresh.is_a?(Array) ? fresh : []
        end

        # The world anchor position: the raw inference point in free mode,
        # the snapped anchor (with the exact gap when the persisted offset
        # belongs to the live primary constraint) with an active snap.
        def snapped_anchor_mm
          solution = @active_snap
          return @cursor_mm unless solution

          if @snap_offset_key && solution[:primary][:key] == @snap_offset_key
            PlacementSnapEngine.apply_gap(solution, @snap_offset_mm)
          else
            solution[:anchor_mm]
          end
        end

        # The effective world basis [x, y, z] axis vectors. Under an
        # orientation-proposing snap it derives from the solution's
        # ARBITRARY unit front (increment 3): right = front × up keeps the
        # frame right-handed with determinant +1 at any yaw. Free mode
        # (and the floor, which never reorients) keeps the exact
        # quarter-turn basis about +Z.
        def effective_basis
          solution = @active_snap
          front = solution && solution[:constrains_rotation] ? solution[:front_dir_mm] : nil
          return basis_for_rotation(@rotation_quarters) unless front

          [[front[1], -front[0], 0.0], [front[0], front[1], 0.0], [0.0, 0.0, 1.0]]
        end

        # Quarter-turn basis about +Z (front stays front under rotation —
        # the frame turns with the furniture, never mirrors): returns the
        # [x, y, z] axis vectors.
        def basis_for_rotation(quarters = @rotation_quarters)
          x = [1.0, 0.0, 0.0]
          y = [0.0, 1.0, 0.0]
          quarters.abs.times { x, y = rotate_pair(x, y) }
          [x, y, [0.0, 0.0, 1.0]]
        end

        # The gap shown to the designer: the persisted offset when it
        # belongs to the live primary constraint, 0 otherwise.
        def effective_gap_mm
          solution = @active_snap
          return 0.0 unless solution
          return 0.0 unless @snap_offset_key && solution[:primary][:key] == @snap_offset_key

          @snap_offset_mm
        end

        def format_mm(value)
          (value % 1.0).abs < 1e-9 ? format('%.0f', value) : format('%.1f', value)
        end

        def snap_display_label
          "#{@active_snap[:label]} · #{format_mm(effective_gap_mm)} mm"
        end

        def finish!(state)
          @state = state
          clear_status_text
        end

        def cancel!(reason, restore: true)
          return unless active?

          finish!(:cancelled)
          invalidate_view
          @on_cancel.call(reason)
          restore_selection_tool if restore
        end

        def cycle_anchor!
          @anchor = ANCHORS[(ANCHORS.index(@anchor) + 1) % ANCHORS.length]
          refresh_snap!
        end

        # Rotation is a free-mode/floor authoring control. While an
        # orientation-proposing snap (wall / furniture side) is active, the
        # target already fixes the front and the arrows are answered with
        # an explicit hint instead of silently fighting the snap.
        def rotate!(direction)
          if @active_snap && @active_snap[:constrains_rotation]
            write_status_text('Rotación fijada por el snap: aléjate de pared o mueble para rotar libremente.')
            return
          end

          @rotation_quarters = (((@rotation_quarters + direction) % 4) + 4) % 4
          refresh_snap!
        end

        # One +90° turn about +Z: x̂ → ŷ, ŷ → -x̂ (right-handed, no mirror).
        def rotate_pair(x_vec, y_vec)
          [y_vec.dup, [-x_vec[0], -x_vec[1], -x_vec[2]]]
        end

        # The anchor's local point in mm: the engine owns the mapping so
        # free and snapped transforms grab the same corner by construction.
        def anchor_local_point
          PlacementSnapEngine.anchor_local_point(@anchor, @extents_mm, @origin_mm)
        end

        # Local box corners (mm): ring 0..3 is the bottom face (0=BLB,
        # 1=BRB, 2=FRB, 3=FLB), 4..7 the same ring on the top face.
        def local_corners_mm
          w = @extents_mm[:x]
          d = @extents_mm[:y]
          h = @extents_mm[:z]
          o = @origin_mm
          bottom = [[o[0], o[1], o[2]], [o[0] + w, o[1], o[2]],
                    [o[0] + w, o[1] + d, o[2]], [o[0], o[1] + d, o[2]]]
          bottom.map(&:dup) + bottom.map { |c| [c[0], c[1], o[2] + h] }
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

        # #469 increment 2 — snap feedback: each aligned face gets its own
        # closed outline in the snap color and one label (above the anchor
        # label) states WHAT is being aligned to and the live gap. Spanish
        # copy only — no matrices, quaternions or internal IDs as UX.
        def draw_snap_feedback(view, corners)
          view.drawing_color = preview_color(view, COLOR_SNAP)
          view.line_width = LINE_WIDTH
          view.line_stipple = '-'
          @active_snap[:components].each do |component|
            ring = SNAP_FACE_CORNERS.fetch(component[:aligned_side], nil)
            next unless ring

            view.draw(GL_LINE_LOOP, ring.map { |index| corners[index] }) if defined?(GL_LINE_LOOP)
          end
          return unless view.respond_to?(:draw_text)

          view.draw_text(anchor_label_point(view, corners[anchor_corner_index], SNAP_LABEL_PIXEL_OFFSET),
                         snap_display_label,
                         size: SNAP_LABEL_SIZE, color: preview_color(view, COLOR_SNAP), bold: true)
        end

        def restore_selection_tool
          model = @model_provider&.call
          model&.select_tool(nil)
        rescue StandardError => e
          @logger&.warn('placement_tool_restore_failed', error: e)
        end

        def update_status_text
          if @active_snap
            write_status_text(
              "#{snap_display_label} · clic para confirmar · escribe holgura (mm) y Enter · " \
              'Esc para cancelar'
            )
          else
            write_status_text(
              "Colocar #{@label}: clic para confirmar · Esc para cancelar · " \
              "←/→ rotar · Tab ancla (#{ANCHOR_LABELS[@anchor]}) · " \
              'acércate a pared, piso o mueble para encajar'
            )
          end
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
