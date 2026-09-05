# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Projects a resolved hole (board-local, face-referenced mm coordinates
      # of the machining contract) onto SketchUp WORLD space using the
      # canonical managed-hierarchy transforms (#414/#415). Pure math over
      # points: it never creates entities, opens operations or writes
      # metadata — the result feeds an ephemeral viewport overlay only.
      #
      # Face semantics mirror the authoritative backend table
      # (backend-go layout.go, hardware anchor projection): the board-local
      # box spans [0,width]×[0,thickness]×[0,length] on X/Y/Z and
      #
      #   front  → center (x, T, y)   normal +Y   in-plane (X, Z)
      #   back   → center (x, 0, y)   normal −Y   in-plane (X, Z)
      #   left   → center (0, x, y)   normal −X   in-plane (Y, Z)
      #   right  → center (W, x, y)   normal +X   in-plane (Y, Z)
      #   top    → center (x, y, L)   normal +Z   in-plane (X, Y)
      #   bottom → center (x, y, 0)   normal −Z   in-plane (X, Y)
      #
      # Ruby consumes this table; it NEVER re-derives it from geometry, slot
      # names or hardware type.
      module FeatureProjector
        MM_TO_INCHES = 1.0 / 25.4

        FACE_GEOMETRY = {
          'front' => { 'center' => ->(_w, t, _l, x, y) { [x, t, y] },
                       'normal' => [0, 1, 0], 'u' => [1, 0, 0], 'v' => [0, 0, 1] },
          'back' => { 'center' => ->(_w, _t, _l, x, y) { [x, 0, y] },
                      'normal' => [0, -1, 0], 'u' => [1, 0, 0], 'v' => [0, 0, 1] },
          'left' => { 'center' => ->(_w, _t, _l, x, y) { [0, x, y] },
                      'normal' => [-1, 0, 0], 'u' => [0, 1, 0], 'v' => [0, 0, 1] },
          'right' => { 'center' => ->(w, _t, _l, x, y) { [w, x, y] },
                       'normal' => [1, 0, 0], 'u' => [0, 1, 0], 'v' => [0, 0, 1] },
          'top' => { 'center' => ->(_w, _t, l, x, y) { [x, y, l] },
                     'normal' => [0, 0, 1], 'u' => [1, 0, 0], 'v' => [0, 1, 0] },
          'bottom' => { 'center' => ->(_w, _t, _l, x, y) { [x, y, 0] },
                        'normal' => [0, 0, -1], 'u' => [1, 0, 0], 'v' => [0, 1, 0] }
        }.freeze

        RING_SEGMENT_COUNT = 24

        # One projected marker, expressed entirely in world POINTS (inches):
        # no vector-transform ambiguity, no host entities.
        class ProjectedFeature
          attr_reader :visual_id, :center, :ring_points, :depth_end, :radius_in

          def initialize(visual_id:, center:, ring_points:, depth_end:, radius_in:, conflict: false)
            @visual_id = visual_id
            @center = center
            @ring_points = ring_points
            @depth_end = depth_end
            @radius_in = radius_in
            @conflict = conflict
          end

          def conflict?
            @conflict
          end
        end

        module_function

        # feature: ManufacturingFeatureView; board: LayoutBoardTransform of
        # the SAME componentInstanceId; part_transform / furniture_transform:
        # the instance transformations of the board part and its owning
        # furniture root (world = furniture * part, SketchUp composition).
        # Returns nil when the face is not part of the contract table — an
        # unknown face never renders a guess.
        def project(feature, board:, part_transform:, furniture_transform:)
          entry = FACE_GEOMETRY[feature.face]
          return nil unless entry

          width_mm = board.width_mm
          thickness_mm = board.thickness_mm
          length_mm = board.length_mm
          local_center_mm = entry['center'].call(width_mm, thickness_mm, length_mm,
                                                 feature.x_mm, feature.y_mm)
          radius_mm = feature.diameter_mm / 2.0
          u = entry['u']
          v = entry['v']
          inward_mm = entry['normal'].map(&:-@)

          ring_mm = build_ring_mm(local_center_mm, radius_mm, u, v)
          depth_end_mm = build_depth_end_mm(local_center_mm, feature.depth_mm, inward_mm)

          world = furniture_transform * part_transform
          ProjectedFeature.new(
            visual_id: feature.visual_id,
            center: mm_to_inches(local_center_mm).transform(world),
            ring_points: ring_mm.map { |point| mm_to_inches(point).transform(world) },
            depth_end: mm_to_inches(depth_end_mm).transform(world),
            radius_in: radius_mm * MM_TO_INCHES,
            conflict: feature.conflict?
          )
        end

        def build_ring_mm(center_mm, radius_mm, u_vec, v_vec)
          Array.new(RING_SEGMENT_COUNT) do |i|
            angle = (2 * Math::PI * i) / RING_SEGMENT_COUNT
            along_u = radius_mm * Math.cos(angle)
            along_v = radius_mm * Math.sin(angle)
            [
              center_mm[0] + (along_u * u_vec[0]) + (along_v * v_vec[0]),
              center_mm[1] + (along_u * u_vec[1]) + (along_v * v_vec[1]),
              center_mm[2] + (along_u * u_vec[2]) + (along_v * v_vec[2])
            ]
          end
        end

        def build_depth_end_mm(center_mm, depth_mm, inward_mm)
          [
            center_mm[0] + (depth_mm * inward_mm[0]),
            center_mm[1] + (depth_mm * inward_mm[1]),
            center_mm[2] + (depth_mm * inward_mm[2])
          ]
        end

        def mm_to_inches(point_mm)
          Geom::Point3d.new(point_mm[0] * MM_TO_INCHES,
                            point_mm[1] * MM_TO_INCHES,
                            point_mm[2] * MM_TO_INCHES)
        end
      end
    end
  end
end
