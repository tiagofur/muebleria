# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # #469 increments 2+3 — pure semantic snap engine for the shared
      # FurniturePlacementTool. Deterministic, host-free and unit-testable:
      # it consumes plain mm numerics and returns candidate solutions; the
      # tool layer is the only place Geom/SketchUp types appear.
      #
      # Authoring convenience ONLY (designer-workflow §6, interaction-model
      # §6.3): every candidate produces a top-level placement transform.
      # Nothing here can change dimensions, materials, part geometry,
      # hardware or machining — the engine has no access to productive
      # truth of any kind.
      #
      # Candidate families:
      #   :face            — wall/vertical host face at ANY horizontal yaw
      #                      (increment 3): the furniture BACK face aligns
      #                      to the plane with the front facing the EYE
      #                      side of the plane (SketchUp face orientation
      #                      is arbitrary/reversible; ±normal alone never
      #                      decides the room side; the cabinet is never
      #                      resized).
      #   :floor           — base plane (a horizontal host face, EITHER
      #                      winding: +Z and −Z normals are the same
      #                      geometric floor — the base sits ON the plane
      #                      and the pick already targets it); rotation is
      #                      unconstrained.
      #   :furniture_side  — side of a Granete-managed FurnitureInstance
      #                      (resolved by server identity, never by name)
      #                      at ANY yaw around Z: existing side → new
      #                      furniture opposite side, fronts kept parallel
      #                      to the target's front. The side is a FINITE
      #                      rectangle measured in the target's ORIENTED
      #                      frame: the cursor must be near it along the
      #                      normal, tangent (front) and Z axes.
      #
      # Increment 3 critical rule: rotated furniture sides come from the
      # target's ORIENTED frame (rigid transform + local extents supplied
      # by the caller) — NEVER from the world AABB, which is axis-aligned
      # and stops being the furniture's real sides at any non-quarter yaw.
      # Constraints are vector planar (point + unit normal/tangent); no
      # direction is ever rounded to its nearest world axis.
      #
      # Selection policy (deterministic, no hidden heuristics):
      #   1. A candidate exists only if its anchor displacement along the
      #      constraint normal |s − d| ≤ TOLERANCE_MM (plus the
      #      finite-rectangle rule for furniture sides above).
      #   2. Candidates constrain exactly ONE orientation-relative slot
      #      each. With the winning front f, a horizontal candidate's
      #      normal is parallel to ±f (front slot) or ±right(f) (right
      #      slot); the floor owns the vertical slot. Per slot the best
      #      candidate is (displacement rounded to 0.01mm, type priority
      #      furniture_side < face < floor, target key) — a stable total
      #      order, so equal inputs always select the same winner.
      #   3. Slot winners compose (a wall + floor corner composes at any
      #      angle; wall + perpendicular side composes). Orientation-
      #      proposing candidates must agree on the front direction: the
      #      globally best one wins and conflicting others are dropped
      #      (never silently mirrored or averaged).
      #   4. The PRIMARY constraint — the one a VCB gap applies to — is the
      #      best HORIZONTAL candidate (furniture runs are laid out along
      #      walls/sides); with no horizontal candidate the floor is primary.
      # rubocop:disable Metrics/ModuleLength -- one cohesive pure engine:
      # discovery + policy + candidate math share the same data contract;
      # splitting them would spread one invariant across files.
      module PlacementSnapEngine
        TOLERANCE_MM = 250.0
        AXIS_EPSILON = 1e-6
        PARALLEL_EPSILON = 1e-6
        TYPE_PRIORITY = { furniture_side: 0, face: 1, floor: 2 }.freeze

        # Semantics of the aligned (contact) side on the NEW furniture box.
        # local_axis is the box-local axis the face lives on; at_max says
        # whether the face sits at the local maximum (the face-to-anchor
        # distance is measured INTO the box, along the constraint normal).
        ALIGNED_FACE_INFO = {
          back: { local_axis: 1, at_max: false }, # local y = origin_y (front = +Y)
          left: { local_axis: 0, at_max: false }, # local x = origin_x
          right: { local_axis: 0, at_max: true }, # local x = origin_x + width
          bottom: { local_axis: 2, at_max: false } # local z = origin_z
        }.freeze

        module_function

        # Solves the snap for the current cursor state. Returns nil (free
        # placement) or a solution hash:
        #   components:        composed per-slot candidates
        #   primary:           candidate the mm gap applies to
        #   front_dir_mm:      proposed world front (unit, horizontal) —
        #                      nil when nothing proposes orientation
        #   constrains_rotation
        #   anchor_mm:         snapped anchor position (gap 0)
        #   label:             Spanish UX label without the gap (no IDs/matrices)
        # eye_mm: the viewer's eye position (mm). REQUIRED for wall/face
        # candidates: SketchUp face orientation is arbitrary (a face can be
        # reversed), so ±normal alone cannot decide which side is the room.
        # The front is resolved deterministically toward the eye side of
        # the plane; with no eye, or an eye exactly on the plane, the face
        # candidate is dropped — never guessed.
        def solve(cursor_mm:, extents_mm:, origin_mm:, anchor:, faces: [], managed_targets: [], eye_mm: nil)
          context = { cursor_mm: cursor_mm.map(&:to_f), extents_mm: extents_mm,
                      origin_mm: origin_mm.map(&:to_f), anchor: anchor, eye_mm: eye_mm }
          candidates = face_candidates(faces, context) +
                       floor_candidates(faces, context) +
                       furniture_side_candidates(managed_targets, context)
          candidates = candidates.select { |candidate| candidate[:displacement_mm] <= TOLERANCE_MM }
          compose(candidates, context)
        end

        # Applies an exact gap (mm) along the primary constraint NORMAL:
        # positive moves the box away from the target, negative overlaps.
        # The offset travels the unit normal vector — never a single
        # world-axis coordinate — and the exterior transform is the ONLY
        # thing a gap can move.
        def apply_gap(solution, gap_mm)
          return solution[:anchor_mm] unless solution

          add_scaled(solution[:anchor_mm], solution[:primary][:normal_mm], gap_mm.to_f)
        end

        # VCB text → mm. Accepts "5", "5.5", "-3", "5mm", "5 mm" (the host
        # delivers raw measurements-box text to the tool). Anything else is
        # nil — never a guessed or defaulted distance.
        def parse_gap_mm(text)
          return nil unless text.is_a?(String)

          match = text.strip.match(/\A(-?\d+(?:\.\d+)?)\s*(mm)?\z/i)
          value = match && Float(match[1])
          value&.finite? ? value : nil
        end

        # The anchor's local point in mm — the single authority shared with
        # the tool (free and snapped transforms must grab the same corner).
        def anchor_local_point(anchor, extents_mm, origin_mm)
          x = anchor.to_s.include?('right') ? origin_mm[0] + extents_mm[:x] : origin_mm[0]
          y = anchor.to_s.include?('front') ? origin_mm[1] + extents_mm[:y] : origin_mm[1]
          [x, y, origin_mm[2]]
        end

        # ---- discovery ------------------------------------------------

        # Vertical host faces (walls) at ANY horizontal yaw: the furniture
        # back aligns to the plane and the front faces INTO THE ROOM.
        # SketchUp face front/back orientation is arbitrary (a wall face
        # can be reversed), so the ±normal alone never decides the room
        # side: the front is resolved deterministically toward the EYE side
        # of the plane. Without an eye, with an eye exactly on the plane,
        # or for non-vertical faces (tilted normals) there is no candidate
        # — fail-safe, no snap beats an unresolvable orientation.
        def face_candidates(faces, context)
          faces.filter_map do |plane|
            normal = normalize_horizontal(normal_of(plane))
            next nil unless normal
            next nil unless context[:eye_mm]

            eye_offset = dot3(sub3(context[:eye_mm], point_of(plane)), normal)
            next nil if eye_offset.abs <= AXIS_EPSILON

            room_normal = scale3(normal, eye_offset.positive? ? 1.0 : -1.0)
            build_candidate(
              kind: :face, normal: room_normal, plane_point: point_of(plane),
              aligned_side: :back, front_dir: room_normal,
              key: "face|#{fmt(room_normal)}|#{fmt_key(dot3(point_of(plane), room_normal))}",
              label: 'Encajar a pared', context: context
            )
          end
        end

        # Base planes: HORIZONTAL HOST FACES under the cursor, EITHER
        # winding — the wall fix already established that Face#normal sign
        # is not semantic authority, and a geometrically identical floor
        # can be reversed (−Z): both are the same base plane. Rotation is
        # unconstrained — the floor never reorients, and a free pick away
        # from any face is never hijacked toward z=0.
        def floor_candidates(faces, context)
          candidates = faces.filter_map do |plane|
            normal = normal_of(plane)
            next nil unless normal && normal.length == 3 &&
                            normal[0].abs < AXIS_EPSILON && normal[1].abs < AXIS_EPSILON &&
                            ((normal[2].abs - 1.0).abs < AXIS_EPSILON)

            z = point_of(plane)[2]
            build_candidate(
              kind: :floor, normal: [0.0, 0.0, 1.0],
              plane_point: [0.0, 0.0, z],
              aligned_side: :bottom, front_dir: nil,
              key: "floor|#{fmt_key(z)}", label: 'Piso', context: context
            )
          end
          candidates.uniq { |candidate| candidate[:key] }
        end

        # Granete-managed furniture sides at ANY yaw around Z. Targets
        # arrive as ORIENTED FRAME descriptors
        # {furniture_instance_id:, label:, origin_world_mm:, front_dir_mm:,
        #  right_dir_mm:, local_min_mm:, local_max_mm:} resolved by MANAGED
        # METADATA identity at the caller — component names/GUIDs are
        # never authority, and the frame comes from the entity's real
        # rigid transform with its LOCAL extents (never the world AABB:
        # axis-aligned bounds invent wrong side planes for rotated
        # furniture). Both pairings keep the new furniture front PARALLEL
        # to the target's front (a run of cabinets): target right side →
        # new left side, target left side → new right side. A side is a
        # FINITE rectangle in the ORIENTED frame: the cursor must be
        # within TOLERANCE of the rectangle along the tangent (front) axis
        # and Z, so a neighbor that is merely close along the constraint
        # normal but meters away along the run or in height is NOT a
        # candidate.
        def furniture_side_candidates(managed_targets, context)
          candidates = []
          managed_targets.each do |target|
            frame = target_frame(target)
            next unless frame

            sides = [
              { outward: frame[:right], at_max: true, side_label: 'lateral derecho', aligned: :left },
              { outward: scale3(frame[:right], -1.0), at_max: false,
                side_label: 'lateral izquierdo', aligned: :right }
            ]
            sides.each do |side|
              plane_point = add_scaled(frame[:origin_world_mm], frame[:right],
                                       side[:at_max] ? frame[:local_max_mm][0] : frame[:local_min_mm][0])
              next unless near_side_rectangle?(context[:cursor_mm], frame)

              candidates << build_candidate(
                kind: :furniture_side, normal: side[:outward], plane_point: plane_point,
                aligned_side: side[:aligned], front_dir: frame[:front],
                key: "side|#{id_of(target)}|#{side[:side_label]}",
                label: "Encajar a #{label_of(target)} · #{side[:side_label]}",
                context: context, furniture_instance_id: id_of(target)
              )
            end
          end
          candidates
        end

        # The target's oriented frame, validated fail-closed: horizontal
        # unit orthogonal front/right with right × front = +Z (no tilt, no
        # scale, no mirror). Frames that fail validation offer nothing.
        def target_frame(target)
          front = normalize_horizontal(front_of(target))
          right = normalize_horizontal(right_of_target(target))
          return nil unless front && right
          return nil unless cross_z(right, front) > 1.0 - PARALLEL_EPSILON

          min = local_min_of(target)
          max = local_max_of(target)
          return nil unless min && max

          { origin_world_mm: origin_world_of(target), front: front, right: right,
            local_min_mm: min, local_max_mm: max }
        end

        # Finite-side proximity in the ORIENTED frame: distance from the
        # cursor to the side RECTANGLE, clamped per axis (0 while inside
        # the span). The rectangle spans the target along the tangent
        # (front) axis and Z using the LOCAL extents; near-ness on the
        # constraint normal is checked separately by the displacement
        # tolerance filter.
        def near_side_rectangle?(cursor_mm, frame)
          origin = frame[:origin_world_mm]
          tangent_coord = dot3(sub3(cursor_mm, origin), frame[:front])
          tangential = interval_distance(tangent_coord, frame[:local_min_mm][1], frame[:local_max_mm][1])
          return false if tangential > TOLERANCE_MM

          vertical = interval_distance(cursor_mm[2], origin[2] + frame[:local_min_mm][2],
                                       origin[2] + frame[:local_max_mm][2])
          vertical <= TOLERANCE_MM
        end

        # Distance from a coordinate to [interval_min, interval_max]:
        # 0 inside the interval, the gap to the nearest end otherwise.
        def interval_distance(value, interval_min, interval_max)
          return interval_min - value if value < interval_min
          return value - interval_max if value > interval_max

          0.0
        end

        # ---- candidate math -------------------------------------------

        # One planar constraint. With the plane point p, unit normal n
        # (pointing toward the side the furniture sits on) and s ≥ 0 the
        # local-axis distance from the aligned face to the anchor measured
        # INTO the box, the snapped anchor lands exactly at signed
        # distance s from the plane along n:
        #   anchor = cursor + n·(s − d),  d = (cursor − p)·n
        # so the aligned face touches the plane while the unconstrained
        # directions keep following the cursor (slide along the
        # wall/side/floor). displacement is |s − d| — the anchor jump
        # ALONG the normal, nothing else.
        def build_candidate(kind:, normal:, plane_point:, aligned_side:, front_dir:,
                            key:, label:, context:, furniture_instance_id: nil)
          face_info = ALIGNED_FACE_INFO.fetch(aligned_side)
          local_axis = face_info[:local_axis]
          local_origin = context[:origin_mm][local_axis]
          local_face_value = face_info[:at_max] ? local_origin + extent_along(context, local_axis) : local_origin
          anchor_local = anchor_local_point(context[:anchor], context[:extents_mm], context[:origin_mm])
          face_to_anchor = if face_info[:at_max]
                             local_face_value - anchor_local[local_axis]
                           else
                             anchor_local[local_axis] - local_face_value
                           end
          cursor = context[:cursor_mm]
          plane_offset = dot3(sub3(cursor, plane_point), normal)
          delta = face_to_anchor - plane_offset
          {
            kind: kind, normal_mm: normal, plane_point_mm: plane_point,
            tangent_mm: tangent_of(normal, front_dir), aligned_side: aligned_side,
            key: key, label: label,
            anchor_snapped_mm: add_scaled(cursor, normal, delta),
            displacement_mm: delta.abs,
            front_dir_mm: front_dir, furniture_instance_id: furniture_instance_id
          }
        end

        # Tangent of the constraint plane: the target front for furniture
        # sides (the run direction), the normal's horizontal perpendicular
        # for walls. nil for floors (a vertical constraint has no run
        # direction). Informational — proximity math above uses it per
        # family; kept in the candidate so no consumer reinvents axes.
        def tangent_of(normal, front_dir)
          return front_dir.dup if front_dir
          return nil if normal[2].abs > AXIS_EPSILON

          [normal[1], -normal[0], 0.0]
        end

        # ---- selection policy -----------------------------------------

        def compose(candidates, context)
          return nil if candidates.empty?

          ranked = candidates.sort_by { |candidate| rank_key(candidate) }
          expected_front = ranked.map { |candidate| candidate[:front_dir_mm] }.compact.first
          winners = slot_winners(ranked, expected_front)
          return nil if winners.empty?

          primary = primary_candidate(winners)
          {
            components: winners,
            primary: primary,
            front_dir_mm: expected_front,
            constrains_rotation: !expected_front.nil?,
            anchor_mm: compose_anchor(winners, context),
            label: winners.sort_by { |candidate| candidate.equal?(primary) ? 0 : 1 }
                          .map { |candidate| candidate[:label] }.join(' · ')
          }
        end

        # Per orientation-relative slot, the best ranked candidate whose
        # front proposal agrees with the globally best one (nil proposals —
        # the floor — always compose). Slots with no candidate and slots
        # whose normal cannot compose with the winning front are dropped.
        def slot_winners(ranked, expected_front)
          winners = {}
          ranked.each do |candidate|
            front = candidate[:front_dir_mm]
            next unless front.nil? || same_direction?(front, expected_front)

            slot = constraint_slot(candidate, expected_front)
            winners[slot] ||= candidate
          end
          winners.values
        end

        # The composed anchor: each slot winner shifts the cursor along its
        # own normal by exactly its delta; the slot directions are mutually
        # orthogonal, so the shifts never interact.
        def compose_anchor(winners, context)
          winners.reduce(context[:cursor_mm].dup) do |anchor, candidate|
            add3(anchor, sub3(candidate[:anchor_snapped_mm], context[:cursor_mm]))
          end
        end

        # The orientation-relative slot a horizontal candidate constrains:
        # its normal is parallel to ±front (the wall/back direction) or to
        # ±right (the run direction); orthogonal slots compose into a
        # corner at ANY angle. The floor owns the vertical slot. A normal
        # at any other angle to the winning front cannot compose — nil
        # drops it (fail-closed, never approximated).
        def constraint_slot(candidate, expected_front)
          return :vertical if candidate[:kind] == :floor
          return nil unless expected_front

          normal = candidate[:normal_mm]
          return :front_axis if parallel?(normal, expected_front)
          return :right_axis if parallel?(normal, right_of(expected_front))

          nil
        end

        # The gap applies to the user's run intent: the best horizontal
        # constraint wins; only an empty horizontal set defers to the floor.
        def primary_candidate(components)
          horizontal = components.reject { |candidate| candidate[:kind] == :floor }
          pool = horizontal.empty? ? components : horizontal
          pool.min_by { |candidate| rank_key(candidate) }
        end

        def rank_key(candidate)
          [candidate[:displacement_mm].round(2), TYPE_PRIORITY.fetch(candidate[:kind]), candidate[:key]]
        end

        # ---- descriptor accessors (symbol/string tolerant) -------------

        def normal_of(plane)
          vector_field(plane, :normal_mm, 'normal_mm')
        end

        def point_of(plane)
          vector_field(plane, :point_mm, 'point_mm')
        end

        def vector_field(hash, symbol_key, string_key)
          value = hash[symbol_key] || hash[string_key]
          value.is_a?(Array) && value.length == 3 ? value.map(&:to_f) : nil
        end

        def front_of(target)
          vector_field(target, :front_dir_mm, 'front_dir_mm')
        end

        def right_of_target(target)
          vector_field(target, :right_dir_mm, 'right_dir_mm')
        end

        def id_of(target)
          target[:furniture_instance_id] || target['furniture_instance_id'] || ''
        end

        def label_of(target)
          target[:label] || target['label'] || 'mueble'
        end

        def origin_world_of(target)
          vector_field(target, :origin_world_mm, 'origin_world_mm') || [0.0, 0.0, 0.0]
        end

        def local_min_of(target)
          vector_field(target, :local_min_mm, 'local_min_mm')
        end

        def local_max_of(target)
          vector_field(target, :local_max_mm, 'local_max_mm')
        end

        # ---- vector helpers --------------------------------------------

        # Any horizontal direction (unit, z=0) normalized to unit length —
        # arbitrary yaws included. Vertical, tilted, zero-length or
        # non-3d input is nil: unsupported orientations fail safe.
        def normalize_horizontal(vector)
          return nil unless vector && vector.length == 3 && vector[2].abs < AXIS_EPSILON

          length = Math.sqrt((vector[0]**2) + (vector[1]**2))
          return nil if length < AXIS_EPSILON

          [vector[0] / length, vector[1] / length, 0.0]
        end

        # right = front × up (right-handed; keeps the target's own frame).
        def right_of(front)
          [front[1], -front[0], 0.0]
        end

        # Z component of vec_a × vec_b for horizontal vectors: +1 for a
        # right-handed (right, front) pair, −1 for a mirrored one.
        def cross_z(vec_a, vec_b)
          (vec_a[0] * vec_b[1]) - (vec_a[1] * vec_b[0])
        end

        # Horizontal parallelism INCLUDING opposite directions (±n is the
        # same constraint line): |cross| ≈ 0.
        def parallel?(vec_a, vec_b)
          cross_z(vec_a, vec_b).abs < PARALLEL_EPSILON
        end

        # Same horizontal direction specifically (orientation authority):
        # cross ≈ 0 AND dot > 0.
        def same_direction?(vec_a, vec_b)
          parallel?(vec_a, vec_b) && dot3(vec_a, vec_b).positive?
        end

        def dot3(vec_a, vec_b)
          (vec_a[0] * vec_b[0]) + (vec_a[1] * vec_b[1]) + (vec_a[2] * vec_b[2])
        end

        def sub3(vec_a, vec_b)
          [vec_a[0] - vec_b[0], vec_a[1] - vec_b[1], vec_a[2] - vec_b[2]]
        end

        def add3(vec_a, vec_b)
          [vec_a[0] + vec_b[0], vec_a[1] + vec_b[1], vec_a[2] + vec_b[2]]
        end

        def scale3(vector, factor)
          [vector[0] * factor, vector[1] * factor, vector[2] * factor]
        end

        def add_scaled(vector, direction, factor)
          add3(vector, scale3(direction, factor))
        end

        # Stable key formatting: enough precision to distinguish real
        # angles, rounded so identical geometry yields identical keys.
        def fmt_key(value)
          format('%.6f', value)
        end

        def fmt(vector)
          vector.map { |component| format('%.6f', component) }.join(',')
        end

        def extent_along(context, axis)
          context[:extents_mm][%i[x y z][axis]]
        end
      end
      # rubocop:enable Metrics/ModuleLength
    end
  end
end
