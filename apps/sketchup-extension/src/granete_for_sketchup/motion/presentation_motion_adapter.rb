# frozen_string_literal: true

# Adapts presentation opening/closing kinematics into SketchUp ComponentInstance
# visual poses.
# INVARIANT: Never modifies authoring truth or emits design intents. Only applies transient visual poses.
# INVARIANT: Closing (progress=0) always restores exactly the canonical closed transform without drift.
# INVARIANT: Hinges and handles attached to an opening door front rotate rigidly along with the door front.

module Granete
  module SketchUpExtension
    module Motion
      class PresentationMotionAdapter
        attr_reader :motions, :component_map, :hardware_by_host

        # @param resolved_motions [Array<Hash>] from authoring resolve output or door definitions
        # @param component_map [Hash<String, Sketchup::ComponentInstance>] component_id -> instance
        # @param hardware_by_host [Hash<String, Array<Sketchup::ComponentInstance>>] host_id -> hw instances
        def initialize(resolved_motions = [], component_map = {}, hardware_by_host = {})
          @motions = resolved_motions || []
          @component_map = component_map || {}
          @hardware_by_host = hardware_by_host || {}
          @closed_transforms = {} # persistent_id/object_id -> canonical Geom::Transformation
          @open_states = {} # motion_id / door_slot -> Float (current progress)
        end

        def register_closed_transform(entity)
          return unless entity.respond_to?(:transformation)

          k = entity_key(entity)
          @closed_transforms[k] ||= entity.transformation.clone
        end

        def canonical_closed_transform(entity)
          return nil unless entity.respond_to?(:transformation)

          k = entity_key(entity)
          @closed_transforms[k] ||= entity.transformation.clone
          @closed_transforms[k]
        end

        # Applies motion to an agregado/door actor and all its mounted hardware.
        # @param motion_id_or_agregado_id [String]
        # @param progress [Float] 0.0 = closed, 1.0 = fully open
        # @param furniture_transform [Geom::Transformation, nil]
        def apply_motion(motion_id_or_agregado_id, progress = 1.0, furniture_transform = nil)
          motion_def = find_motion(motion_id_or_agregado_id)
          return unless motion_def

          progress = progress.to_f.clamp(0.0, 1.0)
          @open_states[motion_id_or_agregado_id] = progress

          comp_ids = motion_def['componentInstanceIds'] || []
          motion = motion_def['motion'] || motion_def

          comp_ids.each do |comp_id|
            door_instance = @component_map[comp_id]
            next unless door_instance

            if progress <= 0.0
              restore_actor_closed_pose(door_instance, comp_id)
            else
              apply_actor_motion_pose(door_instance, comp_id, motion, progress, furniture_transform)
            end
          end
        end

        # Closes all open doors/actors and restores canonical transforms.
        def close_all(_furniture_transform = nil)
          @motions.each do |m|
            comp_ids = m['componentInstanceIds'] || []
            comp_ids.each do |comp_id|
              door = @component_map[comp_id]
              if door
                closed_t = canonical_closed_transform(door)
                set_transform(door, closed_t) if closed_t
              end
              mounted_hw = @hardware_by_host[comp_id] || []
              mounted_hw.each do |hw|
                hw_closed = canonical_closed_transform(hw)
                set_transform(hw, hw_closed) if hw_closed
              end
            end
          end
          @open_states.clear
        end

        def open?(motion_id)
          (@open_states[motion_id] || 0.0) > 0.01
        end

        # rubocop:disable-next Naming/PredicateMethod
        def toggle_motion(motion_id, furniture_transform = nil)
          if open?(motion_id)
            apply_motion(motion_id, 0.0, furniture_transform)
            false
          else
            apply_motion(motion_id, 1.0, furniture_transform)
            true
          end
        end

        private

        def find_motion(target_id)
          @motions.find do |m|
            m['agregadoInstanceId'] == target_id ||
              m['id'] == target_id ||
              m['doorSlotIndex'].to_s == target_id.to_s
          end
        end

        def restore_actor_closed_pose(door_instance, comp_id)
          closed_t = canonical_closed_transform(door_instance)
          set_transform(door_instance, closed_t) if closed_t
          (@hardware_by_host[comp_id] || []).each do |hw|
            hw_closed = canonical_closed_transform(hw)
            set_transform(hw, hw_closed) if hw_closed
          end
        end

        def apply_actor_motion_pose(door_instance, comp_id, motion, progress, furniture_transform)
          closed_t = canonical_closed_transform(door_instance)
          return unless closed_t

          rel_t = compute_relative_transform(door_instance, closed_t, motion, progress, furniture_transform)
          return unless rel_t

          set_transform(door_instance, rel_t * closed_t)
          (@hardware_by_host[comp_id] || []).each do |hw|
            hw_closed = canonical_closed_transform(hw)
            set_transform(hw, rel_t * hw_closed) if hw_closed
          end
        end

        def entity_key(entity)
          if entity.respond_to?(:persistent_id) && entity.persistent_id && entity.persistent_id != 0
            entity.persistent_id
          else
            entity.object_id
          end
        end

        def set_transform(entity, transform)
          if entity.respond_to?(:transformation=)
            entity.transformation = transform
          elsif entity.respond_to?(:move!)
            entity.move!(transform)
          end
        end

        def compute_relative_transform(door_instance, closed_t, motion, progress, _furniture_transform)
          case motion['kind']
          when 'rotate'
            compute_relative_rotate_transform(door_instance, closed_t, motion, progress)
          when 'translate'
            compute_relative_translate_transform(motion, progress)
          else
            defined?(::Geom::Transformation) ? ::Geom::Transformation.new : nil
          end
        end

        def compute_relative_rotate_transform(door_instance, closed_t, motion, progress)
          angle_deg = (motion['openAngleDeg'] || 110.0).to_f * progress
          pivot_side = motion['pivotSide'] || motion['pivot'] || 'left'
          pivot_side = pivot_side.to_s.downcase

          # Pivot axis is local vertical (Z) of the furniture frame
          axis_vec = if motion['axisLocal']
                       ax = motion['axisLocal']
                       ::Geom::Vector3d.new(ax['x'].to_f, ax['y'].to_f, ax['z'].to_f)
                     else
                       ::Geom::Vector3d.new(0, 0, 1)
                     end

          # Determine hinge pivot point in furniture coordinates
          pivot_pt = resolve_pivot_point(door_instance, closed_t, pivot_side)

          # Left swing opens with positive angle (outward)
          # Right swing opens with negative angle (outward)
          sign = pivot_side == 'right' ? -1.0 : 1.0
          angle_rad = sign * angle_deg * (Math::PI / 180.0)

          ::Geom::Transformation.rotation(pivot_pt, axis_vec, angle_rad)
        end

        def compute_relative_translate_transform(motion, progress)
          dist_mm = (motion['distanceMm'] || 400.0).to_f * progress
          dist_inches = dist_mm / 25.4
          ax = motion['axisLocal'] || { 'x' => 0, 'y' => 1, 'z' => 0 }
          v = ::Geom::Vector3d.new(ax['x'].to_f * dist_inches, ax['y'].to_f * dist_inches, ax['z'].to_f * dist_inches)
          ::Geom::Transformation.translation(v)
        end

        def resolve_pivot_point(door_instance, closed_t, pivot_side)
          origin = closed_t.respond_to?(:origin) ? closed_t.origin : ::Geom::Point3d.new(0, 0, 0)
          return origin unless pivot_side == 'right'

          # For right side, offset pivot to the right vertical edge of the door
          width_inches = if door_instance.respond_to?(:definition) && door_instance.definition.respond_to?(:bounds)
                           door_instance.definition.bounds.width
                         elsif door_instance.respond_to?(:bounds)
                           door_instance.bounds.width
                         else
                           0.0
                         end

          if closed_t.respond_to?(:xaxis)
            origin + (closed_t.xaxis * width_inches)
          else
            origin + ::Geom::Vector3d.new(width_inches, 0, 0)
          end
        end
      end
    end
  end
end
