# frozen_string_literal: true

# Adapts ResolvedAgregadoMotion from authoring resolve into
# SketchUp ComponentInstance transformation presentation poses.
# INVARIANT: Never modifies authoring transforms. Only applies transient visual poses.
# INVARIANT: Closing (progress=0) always recomputes from canonical closed transform.
module Granete
  module SketchUpExtension
    module Motion
      class PresentationMotionAdapter
        # @param resolved_motions [Array<Hash>] from authoring resolve output
        # @param component_map [Hash<String, Sketchup::ComponentInstance>] id -> instance
        def initialize(resolved_motions, component_map)
          @motions = resolved_motions || []
          @component_map = component_map
        end

        # @param agregado_instance_id [String]
        # @param progress [Float] 0.0 = closed, 1.0 = fully open
        # @param furniture_transform [Geom::Transformation] canonical furniture-local transform
        def apply_motion(agregado_instance_id, progress, furniture_transform)
          motion_def = @motions.find { |m| m['agregadoInstanceId'] == agregado_instance_id }
          return unless motion_def

          motion_def['componentInstanceIds'].each do |comp_id|
            instance = @component_map[comp_id]
            next unless instance

            closed_transform = canonical_closed_transform(instance, furniture_transform)
            posed_transform = compute_pose(closed_transform, motion_def['motion'], progress, furniture_transform)
            instance.move!(posed_transform)
          end
        end

        def close_all(furniture_transform)
          @motions.each do |m|
            m['componentInstanceIds'].each do |comp_id|
              instance = @component_map[comp_id]
              next unless instance
              instance.move!(canonical_closed_transform(instance, furniture_transform))
            end
          end
        end

        private

        def canonical_closed_transform(instance, furniture_transform)
          # Returns the canonical closed transform. Uses the first instance of the
          # definition as the authoring-time reference; falls back to current transform
          # only if no other instance exists.
          first = instance.definition.instances.first
          (first && first != instance) ? first.transformation : instance.transformation
        end

        def compute_pose(closed_t, motion, progress, furniture_t)
          return closed_t if progress <= 0.0

          case motion['kind']
          when 'rotate'
            compute_rotate_pose(closed_t, motion, progress, furniture_t)
          when 'translate'
            compute_translate_pose(closed_t, motion, progress)
          else
            closed_t
          end
        end

        def compute_rotate_pose(closed_t, motion, progress, furniture_t)
          angle_rad = motion['openAngleDeg'].to_f * progress * (Math::PI / 180.0)
          pivot_pt = resolve_pivot(motion, closed_t, furniture_t)
          ax = motion['axisLocal']
          axis_vec = Geom::Vector3d.new(ax['x'].to_f, ax['y'].to_f, ax['z'].to_f)
          rot = Geom::Transformation.rotation(pivot_pt, axis_vec, angle_rad)
          rot * closed_t
        end

        def compute_translate_pose(closed_t, motion, progress)
          dist_m = motion['distanceMm'].to_f * progress / 1000.0
          ax = motion['axisLocal']
          v = Geom::Vector3d.new(ax['x'].to_f * dist_m, ax['y'].to_f * dist_m, ax['z'].to_f * dist_m)
          Geom::Transformation.translation(v) * closed_t
        end

        def resolve_pivot(motion, closed_t, furniture_t)
          if motion['pivotLocalMm']
            pts = motion['pivotLocalMm']
            furniture_t * Geom::Point3d.new(pts[0] / 1000.0, pts[1] / 1000.0, pts[2] / 1000.0)
          else
            # Named side fallback: origin of furniture-local space.
            # Slice C will improve this to actual bounding-box corner.
            Geom::Point3d.new(0, 0, 0)
          end
        end
      end
    end
  end
end
