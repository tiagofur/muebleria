# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Assets
      # Coordinate Spaces:
      #   Asset space (raw coordinates authored inside the .skp component definition)
      #     -> asset_normalization (rigid orthonormal transformation: R_norm, T_norm)
      #     -> Hardware canonical space (+X: longitudinal, +Y: in-plane, +Z: outward normal)
      #     -> Placement transform (positions and aligns canonical hardware on cabinet door/drawer)
      #     -> Furniture space (global cabinet coordinates)
      #
      # CRITICAL DISTINCTION:
      # MountFrame of the asset is NOT the placement of the hardware in the furniture!
      # MountFrame describes the hardware's own mounting interface relative to its internal raw coordinates.
      # Placement transform is applied during furniture layout to anchor the normalized hardware into the assembly.
      module MountFrame # rubocop:disable Metrics/ModuleLength
        MAGNITUDE_CAP_MM = 1_000_000.0 # 10^6 mm; coordinates beyond this are invalid
        BASIS_TOLERANCE = 1e-4

        BasisData = Struct.new(:x, :y, :z, keyword_init: true) do
          def to_h
            { 'x' => x, 'y' => y, 'z' => z }
          end
        end

        MountFrameData = Struct.new(:origin_mm, :basis, keyword_init: true) do
          def to_h
            {
              'originMm' => origin_mm,
              'basis' => basis.to_h
            }
          end
        end

        AssetNormalizationData = Struct.new(:translation_mm, :basis, keyword_init: true) do
          def to_h
            {
              'translationMm' => translation_mm,
              'basis' => basis.to_h
            }
          end

          # Applies normalization to a 3D point in mm: T_norm(p) = T + R * p
          def apply(point) # rubocop:disable Metrics/AbcSize
            [
              translation_mm[0] + (point[0] * basis.x[0]) + (point[1] * basis.y[0]) + (point[2] * basis.z[0]),
              translation_mm[1] + (point[0] * basis.x[1]) + (point[1] * basis.y[1]) + (point[2] * basis.z[1]),
              translation_mm[2] + (point[0] * basis.x[2]) + (point[1] * basis.y[2]) + (point[2] * basis.z[2])
            ]
          end

          # Applies normalization to a 3D vector (rotation only): R * v
          def apply_vector(vector) # rubocop:disable Metrics/AbcSize
            [
              (vector[0] * basis.x[0]) + (vector[1] * basis.y[0]) + (vector[2] * basis.z[0]),
              (vector[0] * basis.x[1]) + (vector[1] * basis.y[1]) + (vector[2] * basis.z[1]),
              (vector[0] * basis.x[2]) + (vector[1] * basis.y[2]) + (vector[2] * basis.z[2])
            ]
          end

          # Verifies distance preservation invariant: ||T(a) - T(b)|| == ||a - b||
          def distance_preserved?(pt_a, pt_b, tolerance: 1e-4)
            dist_orig = MountFrame.distance(pt_a, pt_b)
            trans_a = apply(pt_a)
            trans_b = apply(pt_b)
            dist_trans = MountFrame.distance(trans_a, trans_b)
            (dist_orig - dist_trans).abs <= tolerance
          end

          # Converts to a Geom::Transformation in SketchUp internal units (inches)
          def to_sketchup_transformation # rubocop:disable Metrics/AbcSize
            unless defined?(::Geom::Transformation) && defined?(::Geom::Point3d) && defined?(::Geom::Vector3d)
              return nil
            end

            origin = ::Geom::Point3d.new(
              translation_mm[0] / 25.4,
              translation_mm[1] / 25.4,
              translation_mm[2] / 25.4
            )
            xaxis = ::Geom::Vector3d.new(basis.x[0], basis.x[1], basis.x[2])
            yaxis = ::Geom::Vector3d.new(basis.y[0], basis.y[1], basis.y[2])
            zaxis = ::Geom::Vector3d.new(basis.z[0], basis.z[1], basis.z[2])
            ::Geom::Transformation.axes(origin, xaxis, yaxis, zaxis)
          end
        end

        class << self
          def distance(point1, point2)
            Math.sqrt(((point2[0] - point1[0])**2) + ((point2[1] - point1[1])**2) + ((point2[2] - point1[2])**2))
          end

          def dot_product(vector1, vector2)
            (vector1[0] * vector2[0]) + (vector1[1] * vector2[1]) + (vector1[2] * vector2[2])
          end

          def cross_product(vector1, vector2)
            [
              (vector1[1] * vector2[2]) - (vector1[2] * vector2[1]),
              (vector1[2] * vector2[0]) - (vector1[0] * vector2[2]),
              (vector1[0] * vector2[1]) - (vector1[1] * vector2[0])
            ]
          end

          def magnitude(vector)
            Math.sqrt((vector[0]**2) + (vector[1]**2) + (vector[2]**2))
          end

          def normalize_vector(vector)
            mag = magnitude(vector)
            raise ArgumentError, 'Cannot normalize zero vector' if mag <= 1e-12

            [vector[0] / mag, vector[1] / mag, vector[2] / mag]
          end

          # Validates basis: unit vectors, mutually orthogonal, right-handed (det = +1).
          # Refuses reflection/mirror (det = -1) and non-finite numbers.
          def validate_basis!(basis, label = 'basis') # rubocop:disable Metrics/AbcSize, Naming/PredicateMethod
            axes = { 'x' => basis.x, 'y' => basis.y, 'z' => basis.z }
            axes.each do |axis_name, axis_vector|
              unless axis_vector.is_a?(Array) && axis_vector.size == 3
                raise ArgumentError, "#{label}.#{axis_name} must have 3 coordinates"
              end

              axis_vector.each do |coord|
                if coord.nil? || coord.nan? || coord.infinite? || coord.abs > MAGNITUDE_CAP_MM
                  raise ArgumentError, "#{label}.#{axis_name} coordinates must be finite and bounded"
                end
              end

              norm = magnitude(axis_vector)
              if (norm - 1.0).abs > BASIS_TOLERANCE
                raise ArgumentError, "#{label}.#{axis_name} must be a unit vector (|v|=#{norm})"
              end
            end

            # Orthogonality
            dot_xy = dot_product(basis.x, basis.y)
            dot_xz = dot_product(basis.x, basis.z)
            dot_yz = dot_product(basis.y, basis.z)
            if dot_xy.abs > BASIS_TOLERANCE || dot_xz.abs > BASIS_TOLERANCE || dot_yz.abs > BASIS_TOLERANCE
              raise ArgumentError, "#{label} axes must be mutually orthogonal"
            end

            # Determinant: det = X · (Y x Z)
            cross_yz = cross_product(basis.y, basis.z)
            det = dot_product(basis.x, cross_yz)
            if (det - 1.0).abs > BASIS_TOLERANCE
              msg = "#{label} must be right-handed with det=+1 (got det=#{det.round(4)}); mirror is rejected"
              raise ArgumentError, msg
            end

            true
          end

          # Derives AssetNormalization from a MountFrame in Asset space:
          #   R_norm = R_mount^T
          #   T_norm = - R_norm * Origin_mount
          def derive_normalization(mount_frame) # rubocop:disable Metrics/AbcSize
            validate_basis!(mount_frame.basis, 'mount_frame.basis')
            origin = mount_frame.origin_mm
            unless origin.is_a?(Array) && origin.size == 3
              raise ArgumentError, 'mount_frame.origin_mm must have 3 coordinates'
            end

            origin.each_with_index do |v, i|
              if v.nil? || v.nan? || v.infinite? || v.abs > MAGNITUDE_CAP_MM
                raise ArgumentError, "mount_frame.origin_mm[#{i}] must be finite and bounded"
              end
            end

            # Columns of R_norm = rows of R_mount
            norm_basis = BasisData.new(
              x: [mount_frame.basis.x[0], mount_frame.basis.y[0], mount_frame.basis.z[0]],
              y: [mount_frame.basis.x[1], mount_frame.basis.y[1], mount_frame.basis.z[1]],
              z: [mount_frame.basis.x[2], mount_frame.basis.y[2], mount_frame.basis.z[2]]
            )

            bx = mount_frame.basis.x
            by = mount_frame.basis.y
            bz = mount_frame.basis.z
            trans = [
              -((bx[0] * origin[0]) + (bx[1] * origin[1]) + (bx[2] * origin[2])),
              -((by[0] * origin[0]) + (by[1] * origin[1]) + (by[2] * origin[2])),
              -((bz[0] * origin[0]) + (bz[1] * origin[1]) + (bz[2] * origin[2]))
            ]

            AssetNormalizationData.new(translation_mm: trans, basis: norm_basis)
          end

          # Builds a MountFrame for a two-hole handle from two explicit mounting points.
          # INVARIANT: hole_spacing_mm does NOT guess hole positions; it only validates
          # the measured distance between the two explicit points against expected nominal.
          # rubocop:disable-next Metrics/AbcSize
          def build_handle_mount_frame(hole_a_mm:, hole_b_mm:, surface_normal_z: [0.0, 0.0, 1.0],
                                       expected_hole_spacing_mm: nil, tolerance_mm: 2.0)
            actual_spacing = distance(hole_a_mm, hole_b_mm)
            if expected_hole_spacing_mm
              delta = (actual_spacing - expected_hole_spacing_mm.to_f).abs
              if delta > tolerance_mm.to_f
                msg = "Measured hole spacing #{actual_spacing.round(2)}mm differs from nominal " \
                      "#{expected_hole_spacing_mm}mm by #{delta.round(2)}mm (tolerance ±#{tolerance_mm}mm)"
                raise ArgumentError, msg
              end
            end

            # Anchor origin is the midpoint between mounting holes
            origin = [
              (hole_a_mm[0] + hole_b_mm[0]) / 2.0,
              (hole_a_mm[1] + hole_b_mm[1]) / 2.0,
              (hole_a_mm[2] + hole_b_mm[2]) / 2.0
            ]

            # Primary longitudinal axis X points from hole A to hole B
            dir_ab = [
              hole_b_mm[0] - hole_a_mm[0],
              hole_b_mm[1] - hole_a_mm[1],
              hole_b_mm[2] - hole_a_mm[2]
            ]
            axis_x = normalize_vector(dir_ab)

            # Normal Z pointing outward from host surface, re-orthogonalized against X
            norm_z = normalize_vector(surface_normal_z)
            proj = dot_product(norm_z, axis_x)
            z_ortho = [
              norm_z[0] - (proj * axis_x[0]),
              norm_z[1] - (proj * axis_x[1]),
              norm_z[2] - (proj * axis_x[2])
            ]
            axis_z = normalize_vector(z_ortho)

            # Secondary axis Y = Z x X (ensures right-handedness)
            axis_y = cross_product(axis_z, axis_x)

            basis = BasisData.new(x: axis_x, y: axis_y, z: axis_z)
            validate_basis!(basis, 'handle_mount_frame.basis')

            MountFrameData.new(origin_mm: origin, basis: basis)
          end

          # Compares nominal dimension vs host-measured dimension using a configurable tolerance
          def compare_nominal_vs_measured(nominal:, measured:, tolerance_mm:, dimension_name:)
            delta = (nominal.to_f - measured.to_f).abs
            return nil if delta <= tolerance_mm.to_f

            {
              'dimension' => dimension_name,
              'nominal_mm' => nominal.to_f,
              'measured_mm' => measured.to_f,
              'delta_mm' => delta
            }
          end
        end
      end
    end
  end
end
