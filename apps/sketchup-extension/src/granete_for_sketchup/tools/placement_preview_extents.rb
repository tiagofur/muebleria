# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Tools
      # #469 — placement envelope derivation from the authoritative
      # resolved layout. Prefers the layout's top-level dimensionsMm
      # ([width, height, depth] → local X=width, Y=depth, Z=height); when
      # absent, derives the local AABB of the resolved boards (#414
      # transforms). Placement/preview math only: never baked into part
      # geometry (interaction-model §7 keeps the AABB as preview-only).
      #
      # #469 increment 3 (review): this module is THE semantic authority
      # for the furniture's placement box — the same value feeds the
      # transient preview AND the `placementEnvelopeMm` metadata persisted
      # at the canonical commit, so later side-snapping reads the
      # layout-derived envelope. The definition's world bounds are NOT
      # this authority: they aggregate boards + hardware/visual assets
      # that may protrude past the cabinet sides, and a protruding hinge
      # must never displace a cabinet side plane.
      module PlacementPreviewExtents
        module_function

        # Returns {x:, y:, z:, origin_mm:} — the SIZES and the local MINIMUM
        # of the resolved furniture box. origin_mm keeps the anchor mapping
        # the REAL box (a layout whose boards start away from the local
        # origin must not preview shifted relative to the commit).
        def from_layout(layout)
          from_dimensions(layout.respond_to?(:dimensions_mm) ? layout.dimensions_mm : nil) ||
            boards_extents(layout.respond_to?(:boards) ? layout.boards : [])
        end

        def from_dimensions(dims)
          return nil unless dims.is_a?(Array) && dims.length == 3 && dims.all? { |v| v.to_f.positive? }

          { x: dims[0].to_f, y: dims[2].to_f, z: dims[1].to_f, origin_mm: [0.0, 0.0, 0.0] }
        end

        def boards_extents(boards)
          min = [Float::INFINITY, Float::INFINITY, Float::INFINITY]
          max = [-Float::INFINITY, -Float::INFINITY, -Float::INFINITY]
          boards.each do |board|
            corners_for_board(board).each { |corner| fold_corner(corner, min, max) }
          end
          return nil unless min.all?(&:finite?) && max.all?(&:finite?)

          { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2],
            origin_mm: min.dup }
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

        # The persistable placement envelope (local box in mm) or nil when
        # the layout yields no usable extents — the caller then leaves any
        # previously stored envelope untouched (fail-closed for snapping:
        # a unit without envelope offers no side candidates).
        def envelope_from_layout(layout)
          extents = from_layout(layout)
          return nil unless extents

          origin = extents[:origin_mm]
          { 'min_mm' => origin.dup,
            'max_mm' => [origin[0] + extents[:x], origin[1] + extents[:y], origin[2] + extents[:z]] }
        end
      end
    end
  end
end
