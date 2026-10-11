# frozen_string_literal: true

# #1272 — the gola channel PLACEHOLDER: a solid block standing in for the
# opening profile until its real SKP design lands (3d-asset-library). Every
# dimension is server-born (the catalog profile's declared cross-section, the
# resolved front's grip boundary); anything undeclared draws nothing — never
# an invented size. The block is plain visualization inside the rebuilt root:
# it is not a layout board, so it never reaches the cut list or the pieces.
# Contract: métodos de instancia incluidos en DialogController.
module Granete
  module SketchUpExtension
    module UserInterface
      module DesignOpeningChannelBridge # rubocop:disable Metrics/ModuleLength
        # Server-born spec of the channel placeholder: profile cross-section
        # (height × depth) from the catalog read, zone boundary from the
        # resolved front's grips. nil = nothing drawable (jaladera, profile
        # without declared geometry) — never a guessed size.
        def design_opening_channel_spec(state)
          opening = state.is_a?(Hash) ? state['opening'] : nil
          return nil unless opening.is_a?(Hash) && opening['system'] == 'gola'

          front = Array(state.dig('resolution', 'fronts')).first
          return nil unless front.is_a?(Hash)

          profile = design_opening_channel_profile(opening['profileId'].to_s)
          return nil unless profile

          { 'profileId' => profile['id'], 'profileCode' => profile['code'].to_s,
            'heightMm' => profile['profile_height_mm'], 'depthMm' => profile['profile_depth_mm'],
            'boundary' => design_opening_channel_boundary(front) }
        end

        # One honest summary over the per-unit placeholder results.
        def design_opening_channel_summary(spec, results)
          return nil unless spec
          return { 'status' => 'skipped', 'reason' => 'sin resultado de geometría' } if results.empty?

          drawn = results.find { |r| r['status'] == 'drawn' }
          return { 'status' => 'drawn', 'heightMm' => spec['heightMm'], 'depthMm' => spec['depthMm'] } if drawn

          skipped = results.find { |r| r['status'] == 'skipped' }
          { 'status' => 'skipped', 'reason' => (skipped && skipped['reason']) || 'sin razón' }
        end

        # Draws the placeholder block inside the rebuilt root: a solid of the
        # profile's cross-section spanning the door width, flush with the
        # front face and anchored to the grip boundary edge of the persisted
        # placement envelope. Host-only (SketchUp bounds/transformations);
        # every early return is an honest skip.
        def design_opening_draw_channel_placeholder(model, root, spec)
          store = @metadata_store_factory.call(model)
          doors = Selection::DoorActors.scan(root, store).doors
          return { 'status' => 'skipped', 'reason' => 'sin puerta en el mueble' } if doors.empty?

          door = doors.first
          return { 'status' => 'skipped', 'reason' => 'puerta sin volumen medible' } unless door.respond_to?(:bounds)

          envelope = store.read(root)&.dig('placementEnvelopeMm')
          unless envelope.is_a?(Hash) && envelope['min_mm'].is_a?(Array) && envelope['max_mm'].is_a?(Array)
            return { 'status' => 'skipped', 'reason' => 'sin envelope de colocación' }
          end

          door_min, door_max = design_opening_local_bounds_mm(root, door)
          box = design_opening_channel_box_mm(door_min, door_max,
                                              envelope['min_mm'].map(&:to_f),
                                              envelope['max_mm'].map(&:to_f), spec)

          group = design_opening_add_channel_solid(root, box, spec)
          store.write(group, 'namespace' => Metadata::Store::NAMESPACE,
                             'metadataVersion' => Metadata::Store::METADATA_VERSION,
                             'kind' => 'openingChannelPlaceholder',
                             'identity' => { 'profileId' => spec['profileId'] },
                             'opening' => { 'system' => 'gola', 'profileCode' => spec['profileCode'],
                                            'heightMm' => spec['heightMm'], 'depthMm' => spec['depthMm'],
                                            'boundary' => spec['boundary'] })
          { 'status' => 'drawn', 'heightMm' => spec['heightMm'], 'depthMm' => spec['depthMm'] }
        rescue StandardError => e
          @logger.warn('opening_channel_placeholder_failed', error: e)
          { 'status' => 'skipped', 'reason' => e.message }
        end

        # Pure geometry (kept public for headless tests): the channel
        # block's local box in mm. X spans the door width; Y is flush with
        # the door's front face extending the profile depth inwards; Z
        # anchors to the envelope's boundary edge (top grip → under the
        # body top; bottom grip → over the body bottom).
        def design_opening_channel_box_mm(door_min, door_max, env_min, env_max, spec)
          height_mm = spec['heightMm'].to_f
          depth_mm = spec['depthMm'].to_f

          front_at_max = (env_max[1] - door_max[1]).abs <= (door_min[1] - env_min[1]).abs
          y_range = if front_at_max
                      [door_max[1] - depth_mm, door_max[1]]
                    else
                      [door_min[1], door_min[1] + depth_mm]
                    end

          z_range = if spec['boundary'] == 'bottom'
                      [env_min[2], env_min[2] + height_mm]
                    else
                      [env_max[2] - height_mm, env_max[2]]
                    end

          { 'min_mm' => [door_min[0], y_range.min, z_range.min],
            'max_mm' => [door_max[0], y_range.max, z_range.max] }
        end

        private

        # The selected catalog profile, fail-closed on its declared
        # cross-section: a profile without positive height AND depth has no
        # honest placeholder to draw.
        def design_opening_channel_profile(profile_id)
          return nil if profile_id.empty?

          profiles = Array(design_opening_placer.service.fetch_opening_profiles)
          profile = profiles.find { |candidate| candidate.is_a?(Hash) && candidate['id'] == profile_id }
          return nil unless profile.is_a?(Hash)

          height = profile['profile_height_mm']
          depth = profile['profile_depth_mm']
          return nil unless height.is_a?(Integer) && height.positive? &&
                            depth.is_a?(Integer) && depth.positive?

          profile
        rescue StandardError => e
          @logger.warn('opening_channel_profiles_unavailable', error: e)
          nil
        end

        # The zone edge the channel anchors to: a bottom grip (rebase)
        # anchors below, anything else (gola's top consumption) above.
        def design_opening_channel_boundary(front)
          bottom = Array(front['grips']).any? { |grip| grip.is_a?(Hash) && grip['boundary'] == 'bottom' }
          bottom ? 'bottom' : 'top'
        end

        # The door's AABB translated into the root's definition-local space,
        # converted to millimetres — the same space the placement envelope
        # and the rendered boards live in.
        def design_opening_local_bounds_mm(root, door)
          inverse = root.transformation.inverse
          min = [Float::INFINITY] * 3
          max = [-Float::INFINITY] * 3
          (0..7).each do |corner_index|
            corner = inverse * door.bounds.corner(corner_index)
            3.times do |axis|
              value_mm = corner.to_a[axis] * 25.4
              min[axis] = value_mm if value_mm < min[axis]
              max[axis] = value_mm if value_mm > max[axis]
            end
          end
          [min, max]
        end

        # Creates the solid group inside the root's definition (host API):
        # axis-aligned box from the mm range, following the builder's
        # mm→inches face+pushpull idiom.
        def design_opening_add_channel_solid(root, box, spec)
          mm_to_inches = 1.0 / 25.4
          min = box['min_mm'].map { |v| v * mm_to_inches }
          max = box['max_mm'].map { |v| v * mm_to_inches }

          group = root.definition.entities.add_group
          group.name = "Canal #{spec['profileCode']} (placeholder)".strip
          face = group.entities.add_face(channel_solid_points(min, max))
          face&.pushpull(max[2] - min[2])
          group
        end

        def channel_solid_points(min, max)
          [
            Geom::Point3d.new(min[0], min[1], min[2]), Geom::Point3d.new(max[0], min[1], min[2]),
            Geom::Point3d.new(max[0], max[1], min[2]), Geom::Point3d.new(min[0], max[1], min[2])
          ]
        end
      end
    end
  end
end
