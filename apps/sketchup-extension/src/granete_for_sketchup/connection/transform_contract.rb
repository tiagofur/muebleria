# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module ProjectFurniture
        # Client-agnostic Transform3D ⇄ host transform conversion
        # (digital-thread §16). The working copy stores millimetres/degrees;
        # SketchUp stores inches internally, so every crossing converts here
        # and nowhere else. Rotation is decomposed from the rigid basis as
        # extrinsic XYZ Euler angles in degrees (R = Rz·Ry·Rx applied to world
        # axes); identity placement serialises as [0, 0, 0].
        module TransformContract # rubocop:disable Metrics/ModuleLength
          MM_PER_INCH = 25.4
          TRANSLATION_TOLERANCE_MM = 0.001
          BASIS_TOLERANCE = 1e-6
          # For a near-gimbal pitch delta d, 1 - |sin(pitch)| is about d²/2.
          # Only snap when the resulting basis remains within our exactness
          # tolerance; looser detection destroys valid near-90° information.
          GIMBAL_SINE_EPSILON = (BASIS_TOLERANCE**2) / 2.0

          module_function

          def from_host(transformation)
            return nil unless transformation.respond_to?(:origin) && transformation.respond_to?(:xaxis)

            origin = transformation.origin
            xaxis = transformation.xaxis
            yaxis = transformation.yaxis
            zaxis = transformation.zaxis
            return nil unless origin && xaxis && yaxis && zaxis

            {
              'translation_mm' => [
                (origin.x.to_f * MM_PER_INCH).round(3),
                (origin.y.to_f * MM_PER_INCH).round(3),
                (origin.z.to_f * MM_PER_INCH).round(3)
              ],
              'rotation_deg' => euler_xyz_deg(xaxis, yaxis, zaxis)
            }
          end

          # R = Rz·Ry·Rx (extrinsic XYZ); the columns are the transformed
          # axes, matching euler_xyz_deg's decomposition.
          def basis_from_degrees(degrees)
            sx, cx = sin_cos(degrees[0])
            sy, cy = sin_cos(degrees[1])
            sz, cz = sin_cos(degrees[2])

            xaxis = [cy * cz, cy * sz, -sy]
            yaxis = [(sx * sy * cz) - (cx * sz), (sx * sy * sz) + (cx * cz), sx * cy]
            zaxis = [(cx * sy * cz) + (sx * sz), (cx * sy * sz) - (sx * cz), cx * cy]
            [xaxis, yaxis, zaxis]
          end

          def sin_cos(degrees)
            radians = degrees * Math::PI / 180.0
            [Math.sin(radians), Math.cos(radians)]
          end

          # Euler from the rigid basis: host axes are the COLUMNS of R
          # (xaxis = column 0, yaxis = column 1, zaxis = column 2), so
          # r_ij maps to axis components accordingly.
          def euler_xyz_deg(xaxis, yaxis, zaxis)
            r00 = xaxis.x.to_f
            r01 = yaxis.x.to_f
            r02 = zaxis.x.to_f
            r10 = xaxis.y.to_f
            r20 = xaxis.z.to_f
            r21 = yaxis.z.to_f
            r22 = zaxis.z.to_f

            return gimbal_euler_xyz_deg(r20, r01, r02) if r20.abs >= 1.0 - GIMBAL_SINE_EPSILON

            pitch = -Math.asin(r20.clamp(-1.0, 1.0))
            roll = Math.atan2(r21, r22)
            yaw = Math.atan2(r10, r00)
            [roll, pitch, yaw].map { |angle| (angle * 180.0 / Math::PI).round(3) }
          end

          # At pitch ±90°, roll and yaw collapse into one observable angle.
          # Pin yaw to zero and recover the equivalent canonical roll.
          def gimbal_euler_xyz_deg(r20, r01, r02)
            positive_pitch = r20.negative?
            pitch = positive_pitch ? 90.0 : -90.0
            roll = positive_pitch ? Math.atan2(r01, r02) : Math.atan2(-r01, -r02)
            [(roll * 180.0 / Math::PI).round(3), pitch, 0.0].map(&:to_f)
          end

          # Euler triples are not unique at gimbal lock. Compare the canonical
          # rigid transforms (translation + basis) rather than their raw angle
          # representation so equivalent ±90° pitch orientations remain exact.
          def equivalent?(left, right)
            return false unless transform_contract?(left) && transform_contract?(right)

            translations_match = left['translation_mm'].zip(right['translation_mm']).all? do |a, b|
              (a.to_f - b.to_f).abs <= TRANSLATION_TOLERANCE_MM
            end
            return false unless translations_match

            left_basis = basis_from_degrees(left['rotation_deg'].map(&:to_f)).flatten
            right_basis = basis_from_degrees(right['rotation_deg'].map(&:to_f)).flatten
            left_basis.zip(right_basis).all? { |a, b| (a - b).abs <= BASIS_TOLERANCE }
          end

          # Compare an authoritative contract directly with the host's rigid
          # transform. This deliberately avoids host → Euler → basis because
          # Euler decomposition and three-decimal serialization lose
          # information close to gimbal lock.
          def equivalent_to_host?(contract, transformation)
            return false unless transform_contract?(contract) && host_transform?(transformation)

            actual_translation = transformation.origin.to_a.map { |value| value.to_f * MM_PER_INCH }
            translations_match = contract['translation_mm'].zip(actual_translation).all? do |expected, actual|
              (expected.to_f - actual).abs <= TRANSLATION_TOLERANCE_MM
            end
            return false unless translations_match

            expected_basis = basis_from_degrees(contract['rotation_deg'].map(&:to_f)).flatten
            actual_basis = [transformation.xaxis, transformation.yaxis, transformation.zaxis]
                           .flat_map { |axis| axis.to_a.map(&:to_f) }
            expected_basis.zip(actual_basis).all? { |expected, actual| (expected - actual).abs <= BASIS_TOLERANCE }
          end

          def transform_contract?(value)
            value.is_a?(Hash) && %w[translation_mm rotation_deg].all? do |key|
              vector = value[key]
              vector.is_a?(Array) && vector.length == 3 && vector.all?(Numeric)
            end
          end

          def host_transform?(value)
            value.respond_to?(:origin) && value.respond_to?(:xaxis) &&
              value.respond_to?(:yaxis) && value.respond_to?(:zaxis) && value.origin &&
              value.xaxis && value.yaxis && value.zaxis
          end

          # Rebuilds a host transform from the canonical contract (used when a
          # stored working item must drive the host placement).
          def to_host(transformation)
            return nil unless transformation.is_a?(Hash)

            translation = transformation['translation_mm']
            rotation = transformation['rotation_deg']
            return nil unless translation.is_a?(Array) && translation.length == 3

            degrees = rotation.is_a?(Array) && rotation.length == 3 ? rotation.map(&:to_f) : [0.0, 0.0, 0.0]
            xaxis, yaxis, zaxis = basis_from_degrees(degrees)

            Geom::Transformation.axes(
              Geom::Point3d.new(translation[0].to_f / MM_PER_INCH,
                                translation[1].to_f / MM_PER_INCH,
                                translation[2].to_f / MM_PER_INCH),
              Geom::Vector3d.new(xaxis[0], xaxis[1], xaxis[2]),
              Geom::Vector3d.new(yaxis[0], yaxis[1], yaxis[2]),
              Geom::Vector3d.new(zaxis[0], zaxis[1], zaxis[2])
            )
          end
        end
      end
    end
  end
end
