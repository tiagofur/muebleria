# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # #469 increment 2 — pure semantic snap engine for the shared
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
      #   :face            — wall/vertical host face; aligns the furniture
      #                      BACK face to the plane with the front facing
      #                      the EYE side of the plane (SketchUp face
      #                      orientation is arbitrary/reversible; ±normal
      #                      alone never decides the room side; the cabinet
      #                      is never resized).
      #   :floor           — base plane (a horizontal host face, EITHER
      #                      winding: +Z and −Z normals are the same
      #                      geometric floor — the base sits ON the plane
      #                      and the pick already targets it); rotation is
      #                      unconstrained.
      #   :furniture_side  — side of a Granete-managed FurnitureInstance
      #                      (resolved by server identity, never by name):
      #                      existing side → new furniture opposite side,
      #                      fronts kept parallel to the target's front.
      #                      The side is a FINITE rectangle: the cursor
      #                      must be near it along the tangential axis and
      #                      Z, not merely along the constrained axis.
      #
      # Current limitation (#469 remaining scope): only axis-aligned
      # (quarter-grid) planes are supported — sloped walls and furniture
      # rotated to arbitrary angles offer no candidate. Wall/face snapping
      # is NOT complete until arbitrary angular support lands.
      #
      # Selection policy (deterministic, no hidden heuristics):
      #   1. A candidate exists only if its per-axis anchor displacement
      #      |snapped − cursor| ≤ TOLERANCE_MM (plus the finite-rectangle
      #      rule for furniture sides above).
      #   2. Candidates constrain exactly ONE world axis each. Per axis the
      #      best candidate is (displacement rounded to 0.01mm, type
      #      priority furniture_side < face < floor, target key) — a stable
      #      total order, so equal inputs always select the same winner.
      #   3. Per-axis winners compose when their axes differ (a wall + floor
      #      corner composes). Orientation-proposing candidates (face/side)
      #      must agree on the quarter turn: the globally best one wins and
      #      conflicting others are dropped (never silently mirrored).
      #   4. The PRIMARY constraint — the one a VCB gap applies to — is the
      #      best HORIZONTAL candidate (furniture runs are laid out along
      #      walls/sides); with no horizontal candidate the floor is primary.
      # rubocop:disable Metrics/ModuleLength -- one cohesive pure engine:
      # discovery + policy + candidate math share the same data contract;
      # splitting them would spread one invariant across files.
      module PlacementSnapEngine
        TOLERANCE_MM = 250.0
        AXIS_EPSILON = 1e-6
        TYPE_PRIORITY = { furniture_side: 0, face: 1, floor: 2 }.freeze

        # Semantics of the aligned (contact) side on the NEW furniture box.
        # local_axis is the box-local axis the face lives on (independent
        # of the world constraint axis — the derived quarter turn maps one
        # onto the other).
        ALIGNED_FACE_INFO = {
          back: { local_axis: 1, at_max: false }, # local y = origin_y (front = +Y)
          left: { local_axis: 0, at_max: false }, # local x = origin_x
          right: { local_axis: 0, at_max: true }, # local x = origin_x + width
          bottom: { local_axis: 2, at_max: false } # local z = origin_z
        }.freeze

        module_function

        # Solves the snap for the current cursor state. Returns nil (free
        # placement) or a solution hash:
        #   components:  composed per-axis candidates
        #   primary:     candidate the mm gap applies to
        #   rotation_quarters / constrains_rotation
        #   anchor_mm:   snapped anchor position (gap 0)
        #   label:       Spanish UX label without the gap (no IDs/matrices)
        # eye_mm: the viewer's eye position (mm). REQUIRED for wall/face
        # candidates: SketchUp face orientation is arbitrary (a face can be
        # reversed), so ±normal alone cannot decide which side is the room.
        # The front is resolved deterministically toward the eye side of
        # the plane; with no eye, or an eye exactly on the plane, the face
        # candidate is dropped — never guessed.
        def solve(cursor_mm:, extents_mm:, origin_mm:, anchor:, rotation_quarters:,
                  faces: [], managed_targets: [], eye_mm: nil)
          context = { cursor_mm: cursor_mm.map(&:to_f), extents_mm: extents_mm,
                      origin_mm: origin_mm.map(&:to_f), anchor: anchor,
                      rotation_quarters: rotation_quarters, eye_mm: eye_mm }
          candidates = face_candidates(faces, context) +
                       floor_candidates(faces, context) +
                       furniture_side_candidates(managed_targets, context)
          candidates = candidates.select { |candidate| candidate[:displacement_mm] <= TOLERANCE_MM }
          compose(candidates, context)
        end

        # Applies an exact gap (mm) along the primary constraint normal:
        # positive moves the box away from the target, negative overlaps.
        # Only the primary axis coordinate changes — the exterior transform
        # is the ONLY thing a gap can move.
        def apply_gap(solution, gap_mm)
          return solution[:anchor_mm] unless solution

          anchor = solution[:anchor_mm].dup
          primary = solution[:primary]
          anchor[primary[:axis]] += primary[:sign] * gap_mm.to_f
          anchor
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

        # Vertical host faces (walls): the furniture back aligns to the
        # plane and the front faces INTO THE ROOM. SketchUp face front/back
        # orientation is arbitrary (a wall face can be reversed), so the
        # ±normal alone never decides the room side: the front is resolved
        # deterministically toward the EYE side of the plane. Without an
        # eye, with an eye exactly on the plane, or for sloped faces
        # (no axis-aligned plane) there is no candidate — fail-safe, no
        # snap beats an unresolvable orientation.
        def face_candidates(faces, context)
          faces.filter_map do |plane|
            axis = horizontal_axis_index(normal_of(plane))
            next nil unless axis
            next nil unless context[:eye_mm]

            plane_value = point_of(plane)[axis]
            eye_offset = context[:eye_mm][axis] - plane_value
            next nil if eye_offset.abs <= AXIS_EPSILON

            sign = eye_offset.positive? ? 1 : -1
            front_dir = [0.0, 0.0, 0.0]
            front_dir[axis] = sign.to_f
            build_candidate(
              kind: :face, axis: axis, sign: sign,
              plane_value: plane_value,
              aligned_side: :back, front_dir: front_dir,
              key: "face|#{axis}|#{sign}|#{plane_value.round(3)}",
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
            next nil unless vertical_axis_aligned(normal_of(plane))

            z = point_of(plane)[2]
            build_candidate(
              kind: :floor, axis: 2, sign: 1, plane_value: z,
              aligned_side: :bottom, front_dir: nil,
              key: "floor|#{z.round(3)}", label: 'Piso', context: context
            )
          end
          candidates.uniq { |candidate| candidate[:key] }
        end

        # Granete-managed furniture sides. Targets arrive as descriptors
        # {furniture_instance_id:, label:, min_mm:, max_mm:, front_dir:}
        # resolved by MANAGED METADATA identity at the caller — component
        # names/GUIDs are never authority. Both pairings keep the new
        # furniture front PARALLEL to the target's front (a run of
        # cabinets): target right side → new left side, target left side →
        # new right side. A side is a FINITE rectangle, not an infinite
        # plane: the cursor must be within TOLERANCE of the rectangle
        # (constrained axis + tangential axis + Z), so a neighbor that is
        # merely close along the constrained axis but meters away along
        # the wall or in height is NOT a candidate. A target whose frame
        # is not axis-aligned (manually rotated off the quarter grid)
        # offers no candidate: its sides have no exact axis-aligned plane.
        def furniture_side_candidates(managed_targets, context)
          candidates = []
          managed_targets.each do |target|
            front = unit_horizontal(front_of(target))
            next unless front

            min_box = min_of(target)
            max_box = max_of(target)
            right = cross_front_up(front)
            sides = [
              { outward: right, side_label: 'lateral derecho', aligned: :left },
              { outward: [-right[0], -right[1], 0.0], side_label: 'lateral izquierdo', aligned: :right }
            ]
            sides.each do |side|
              axis_sign = horizontal_axis_sign(side[:outward])
              next unless axis_sign

              world_axis, sign = axis_sign
              next unless near_side_rectangle?(context[:cursor_mm], min_box, max_box, world_axis)

              candidates << build_candidate(
                kind: :furniture_side, axis: world_axis, sign: sign,
                plane_value: plane_value_along(min_box, max_box, world_axis, sign),
                aligned_side: side[:aligned],
                front_dir: front,
                key: "side|#{id_of(target)}|#{side[:side_label]}",
                label: "Encajar a #{label_of(target)} · #{side[:side_label]}",
                context: context, furniture_instance_id: id_of(target)
              )
            end
          end
          candidates
        end

        # Finite-side proximity: distance from the cursor to the side
        # RECTANGLE, clamped per axis (0 while inside the span). The
        # rectangle spans the target box along the tangential horizontal
        # axis and Z; near-ness on the constrained axis is checked
        # separately by the displacement tolerance filter.
        def near_side_rectangle?(cursor_mm, min_box, max_box, constrained_axis)
          tangential = constrained_axis.zero? ? 1 : 0
          [tangential, 2].all? do |axis|
            interval_distance(cursor_mm[axis], min_box[axis], max_box[axis]) <= TOLERANCE_MM
          end
        end

        # Distance from a coordinate to [interval_min, interval_max]:
        # 0 inside the interval, the gap to the nearest end otherwise.
        def interval_distance(value, interval_min, interval_max)
          return interval_min - value if value < interval_min
          return value - interval_max if value > interval_max

          0.0
        end

        # ---- candidate math -------------------------------------------

        # One axis-aligned constraint. The snapped anchor substitutes ONLY
        # its own world axis coordinate:
        #   anchor[axis] = plane_value + sign * (distance from the aligned
        #                                   face to the anchor, ≥ 0)
        # The aligned face sits in the box-LOCAL axis from
        # ALIGNED_FACE_INFO; the derived quarter turn maps that local axis
        # onto the constraint's world axis, so the face lands exactly on
        # the plane while the remaining axes keep following the cursor
        # (slide along the wall/side/floor).
        def build_candidate(kind:, axis:, sign:, plane_value:, aligned_side:, front_dir:,
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
          snapped = context[:cursor_mm].dup
          snapped[axis] = plane_value + (sign * face_to_anchor)
          displacement = (snapped[axis] - context[:cursor_mm][axis]).abs
          {
            kind: kind, axis: axis, sign: sign, plane_value_mm: plane_value,
            aligned_side: aligned_side, key: key, label: label,
            anchor_snapped_mm: snapped, displacement_mm: displacement,
            rotation_quarters: quarters_for_front(front_dir),
            furniture_instance_id: furniture_instance_id
          }
        end

        # Quarter-turn mapping local +Y (front) onto a horizontal unit
        # vector: q0 Ŷ=(0,1), q1 Ŷ=(−1,0), q2 Ŷ=(0,−1), q3 Ŷ=(1,0). Exact
        # for axis-aligned directions — never an approximation.
        def quarters_for_front(front_dir)
          return nil unless front_dir && front_dir.length == 3

          return 0 if along?(front_dir, 1)
          return 1 if along?(front_dir, 0, -1.0)
          return 2 if along?(front_dir, 1, -1.0)
          return 3 if along?(front_dir, 0)

          nil
        end

        # ---- selection policy -----------------------------------------

        def compose(candidates, context)
          return nil if candidates.empty?

          ranked = candidates.sort_by { |candidate| rank_key(candidate) }
          per_axis = {}
          ranked.each do |candidate|
            per_axis[candidate[:axis]] ||= candidate
          end

          # Orientation consistency: the best orientation-proposing
          # candidate fixes the quarter turn; later proposals that disagree
          # are dropped instead of mirrored or averaged.
          winners = ranked.select { |candidate| per_axis[candidate[:axis]].equal?(candidate) }
          components, expected_quarters = orientation_consistent(winners)
          return nil if components.empty?

          anchor_mm = context[:cursor_mm].dup
          components.each { |candidate| anchor_mm[candidate[:axis]] = candidate[:anchor_snapped_mm][candidate[:axis]] }
          primary = primary_candidate(components)
          {
            components: components,
            primary: primary,
            rotation_quarters: expected_quarters || context[:rotation_quarters],
            constrains_rotation: !expected_quarters.nil?,
            anchor_mm: anchor_mm,
            label: components.sort_by { |candidate| candidate.equal?(primary) ? 0 : 1 }
                             .map { |candidate| candidate[:label] }.join(' · ')
          }
        end

        # Keeps the per-axis winners whose orientation proposals agree
        # with the globally best one (nil proposals — the floor — always
        # compose). Returns [components, expected_quarters].
        def orientation_consistent(winners)
          expected_quarters = nil
          components = []
          winners.each do |candidate|
            quarters = candidate[:rotation_quarters]
            expected_quarters = quarters if expected_quarters.nil? && !quarters.nil?
            components << candidate if quarters.nil? || quarters == expected_quarters
          end
          [components, expected_quarters]
        end

        # The gap applies to the user's run intent: the best horizontal
        # constraint wins; only an empty horizontal set defers to the floor.
        def primary_candidate(components)
          horizontal = components.reject { |candidate| candidate[:axis] == 2 }
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
          vector_field(target, :front_dir, 'front_dir')
        end

        def id_of(target)
          target[:furniture_instance_id] || target['furniture_instance_id'] || ''
        end

        def label_of(target)
          target[:label] || target['label'] || 'mueble'
        end

        def min_of(target)
          vector_field(target, :min_mm, 'min_mm') || [0.0, 0.0, 0.0]
        end

        def max_of(target)
          vector_field(target, :max_mm, 'max_mm') || [0.0, 0.0, 0.0]
        end

        # ---- axis helpers ----------------------------------------------

        # A horizontal unit axis vector (±X/±Y) → [axis_index, sign]; any
        # other direction (vertical, sloped, non-unit) is nil — it has no
        # exact axis-aligned placement to propose.
        def horizontal_axis_sign(normal)
          return nil unless normal && normal.length == 3

          if axis_aligned?(normal[0]) && normal[1].abs < AXIS_EPSILON && normal[2].abs < AXIS_EPSILON
            return [0, normal[0].positive? ? 1 : -1]
          end
          if normal[0].abs < AXIS_EPSILON && axis_aligned?(normal[1]) && normal[2].abs < AXIS_EPSILON
            return [1, normal[1].positive? ? 1 : -1]
          end

          nil
        end

        # The horizontal world axis a horizontal axis-aligned normal
        # constrains (sign-agnostic — face orientation is arbitrary, the
        # room side is resolved from the eye). nil when not axis-aligned.
        def horizontal_axis_index(normal)
          axis_sign = horizontal_axis_sign(normal)
          axis_sign && axis_sign[0]
        end

        # A horizontal axis-aligned normal (±Z): both windings identify
        # the same base plane.
        def vertical_axis_aligned(normal)
          normal && normal.length == 3 &&
            normal[0].abs < AXIS_EPSILON && normal[1].abs < AXIS_EPSILON &&
            axis_aligned?(normal[2])
        end

        # A horizontal vector aligned to ±X/±Y (unit, z=0) → itself; nil
        # otherwise (unsupported orientation fails safe: no candidate).
        def unit_horizontal(vector)
          return nil unless vector && vector.length == 3 && vector[2].abs < AXIS_EPSILON

          return [vector[0], 0.0, 0.0] if axis_aligned?(vector[0]) && vector[1].abs < AXIS_EPSILON
          return [0.0, vector[1], 0.0] if vector[0].abs < AXIS_EPSILON && axis_aligned?(vector[1])

          nil
        end

        # right = front × up (right-handed; keeps the target's own frame).
        def cross_front_up(front)
          [front[1], -front[0], 0.0]
        end

        def plane_value_along(min_mm, max_mm, axis, sign)
          sign.positive? ? max_mm[axis] : min_mm[axis]
        end

        def extent_along(context, axis)
          context[:extents_mm][%i[x y z][axis]]
        end

        def along?(vector, axis, direction = 1.0)
          other = 1 - axis
          (vector[axis] - direction).abs < AXIS_EPSILON && vector[other].abs < AXIS_EPSILON &&
            vector[2].abs < AXIS_EPSILON
        end

        def axis_aligned?(component)
          (component.abs - 1.0).abs < AXIS_EPSILON
        end
      end
      # rubocop:enable Metrics/ModuleLength
    end
  end
end
