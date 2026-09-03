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
        module TransformContract
          MM_PER_INCH = 25.4
          EPSILON = 1e-9

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
            r10 = xaxis.y.to_f
            r20 = xaxis.z.to_f
            r21 = yaxis.z.to_f
            r22 = zaxis.z.to_f

            if r20.abs >= 1.0 - EPSILON
              # Gimbal lock: pitch ±90° — roll and yaw collapse; pin yaw to 0.
              pitch = r20.positive? ? 90.0 : -90.0
              roll = Math.atan2(r21, r22)
              return [(roll * 180.0 / Math::PI).round(3), pitch, 0.0].map(&:to_f)
            end

            pitch = -Math.asin(r20.clamp(-1.0, 1.0))
            roll = Math.atan2(r21, r22)
            yaw = Math.atan2(r10, r00)
            [roll, pitch, yaw].map { |angle| (angle * 180.0 / Math::PI).round(3) }
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
