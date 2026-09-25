# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Owns: read-only host discovery for base planes and managed-furniture
      # snap descriptors. Reads @metadata_store_factory and @logger from its
      # including controller; calls Sketchup/Geom host APIs and ManagedFurniture.index.
      # Does NOT own: preview lifecycle, callbacks, tool construction, identity
      # orchestration, or placement commit/cancel.
      module PlacementEnvironment # rubocop:disable Metrics/ModuleLength -- host snap-environment boundary, no lifecycle logic
        UNIT_EPSILON = 1e-6

        # Returns a read-only base-plane provider that starts at model.entities,
        # recursively traverses nested Group/ComponentInstance containers with
        # accumulated transforms, respects effective visibility, and prunes
        # managed-furniture roots from room-plane discovery.
        def placement_base_planes_provider(model)
          lambda do
            # Deterministic ROOT scan: active_entities changes with the
            # user's open edit context and would make the gesture
            # snapshot and the click revalidation disagree. Nested
            # containers are handled by the recursive accumulated
            # transform below.
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            entities = model.respond_to?(:entities) ? model.entities : nil
            return [] unless entities.respond_to?(:each)

            scan_base_planes(entities, Geom::Transformation.new,
                             @metadata_store_factory.call(model), model, [])
          end
        end

        private

        # Recursive horizontal-face scan: faces emit WORLD planes;
        # containers recurse with the accumulated transform (parent *
        # child, SketchUp composition semantics) so room fixtures nested
        # inside Groups/Components participate with their true world
        # placement. EFFECTIVE VISIBILITY FIRST (#469 review r5): the
        # scan keeps the INSTANCE PATH and a surface the designer cannot
        # see (own hidden flag, Tag/Layer off, hidden/tagged-off parent
        # anywhere up the path) never participates — snapping extends
        # VISIBLE inference. GRANETE FURNITURE ROOTS ARE PRUNED (managed
        # metadata kind == furnitureInstance, connected or local): a
        # placed cabinet's boards/shelves/tops are furniture, not room
        # floors — they must never become "Piso" candidates that beat
        # the architectural floor by a shorter Z distance. HOST-FAITHFUL
        # access (a real ComponentInstance has no #entities — its
        # content lives on the definition):
        #   Group              → entity.entities
        #   ComponentInstance  → entity.definition.entities
        def scan_base_planes(entities, world_transform, metadata_store, model, instance_path)
          planes = []
          entities.each do |entity|
            child_path = instance_path + [entity]
            next unless effective_path_visible?(model, child_path)

            case entity
            when ::Sketchup::Face
              plane = placement_face_world_plane(entity, world_transform)
              planes << plane if plane
            when ::Sketchup::Group, ::Sketchup::ComponentInstance
              next if granete_furniture_root?(entity, metadata_store)

              child_entities = entity.is_a?(::Sketchup::Group) ? entity.entities : entity.definition.entities
              planes.concat(scan_base_planes(child_entities,
                                             world_transform * entity.transformation,
                                             metadata_store, model, child_path))
            end
          end
          planes
        end

        # Effective visibility of the FULL instance path through the REAL
        # host API: Model#drawing_element_visible? (SketchUp 2020+;
        # accepts an Array<Sketchup::Drawingelement>) accounts for the
        # element's own hidden flag, its Tag/Layer and every parent's
        # state under the CURRENT model options. The only supported host
        # target (SketchUp 2026.2, see the extension README) always has
        # the method and the fixed implementation. Documented defensive
        # paths for older hosts, never silent:
        #   * method absent (< 2020): explicit per-element fallback walk
        #     (own visible? + own Layer visible? along the path);
        #   * ArgumentError: documented host bug FIXED in 2026.0 (the
        #     call threw when the path's last element was a
        #     Group/ComponentInstance). It can only surface on the
        #     pre-descend subtree probe; treat as "cannot decide →
        #     descend" — the FACE-level call (paths end in a Face) is
        #     authoritative and never hits the bug.
        def effective_path_visible?(model, instance_path)
          return true if instance_path.empty?

          if model.respond_to?(:drawing_element_visible?)
            begin
              return model.drawing_element_visible?(instance_path)
            rescue ArgumentError
              return true
            end
          end

          instance_path.all? do |element|
            own_visible = element.respond_to?(:visible?) ? element.visible? : true
            layer = element.respond_to?(:layer) ? element.layer : nil
            layer_visible = layer.respond_to?(:visible?) ? layer.visible? : true
            own_visible && layer_visible
          end
        end

        # True when the entity's Granete metadata marks it as a managed
        # furniture root (kind == furnitureInstance) — connected or
        # local. The furniture's own geometry never contributes base
        # planes.
        def granete_furniture_root?(entity, metadata_store)
          metadata = metadata_store.respond_to?(:read) ? metadata_store.read(entity) : nil
          metadata.is_a?(Hash) && metadata['kind'] == 'furnitureInstance'
        end

        # One horizontal face as a WORLD base-plane descriptor: the world
        # normal must stay vertical (a tilted container tilts its floors
        # — rejected), and the plane carries a BOUNDING-RECTANGLE
        # APPROXIMATION of its world extent (the transformed VERTEX
        # positions folded to a world XY min/max interval — the real
        # Geom::BoundingBox has no #transform to lean on) plus a world
        # plane point, so the engine never treats a distant platform as
        # an infinite floor. APPROXIMATION, NOT EXACT: concave faces,
        # L-shapes, holes and notches are covered by their bounding
        # rectangle (conservative over-inclusion near the notch);
        # polygon-aware footprints (loops with holes) are remaining
        # #469 scope.
        def placement_face_world_plane(entity, world_transform)
          return nil unless placement_local_horizontal_face?(entity)
          return nil unless placement_world_normal_vertical?(entity.normal, world_transform)

          positions = entity.vertices
                            .map { |vertex| vertex.position.transform(world_transform) }
                            .map { |position| point_mm(position) }
          return nil if positions.empty?

          footprint = world_footprint(positions)
          { 'point_mm' => positions.first, 'normal_mm' => [0.0, 0.0, 1.0],
            'footprint_min_mm' => footprint[0], 'footprint_max_mm' => footprint[1] }
        end

        # The face's WORLD normal stays vertical (a tilted container
        # tilts its floors — rejected).
        def placement_world_normal_vertical?(normal, world_transform)
          world = normal.transform(world_transform)
          world.x.to_f.abs < UNIT_EPSILON && world.y.to_f.abs < UNIT_EPSILON &&
            world.z.to_f.abs > 1.0 - UNIT_EPSILON
        end

        # World min/max corner pair folded from transformed vertex
        # positions (mm triples).
        def world_footprint(positions)
          min = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.min }
          max = [0, 1, 2].map { |axis| positions.map { |point| point[axis] }.max }
          [min, max]
        end

        # A face whose LOCAL normal is vertical (either winding).
        def placement_local_horizontal_face?(entity)
          normal = entity.respond_to?(:normal) ? entity.normal : nil
          normal.respond_to?(:z) && normal.x.to_f.abs < UNIT_EPSILON &&
            normal.y.to_f.abs < UNIT_EPSILON && normal.z.to_f.abs > 1.0 - UNIT_EPSILON
        end

        public

        # #469 increments 2+3 — pure-data provider of Granete-managed
        # neighbors for side-to-side snapping. Targets are resolved by
        # SERVER identity through ManagedFurniture metadata — never by
        # component name/GUID — and the scan is local/read-only (no
        # request, no mutation), so it is safe inside the cursor loop.
        # #469 increment 4: placed LOCAL furniture (instanceRef identity,
        # no furnitureInstanceId) joins the same stream under its local
        # ref — no server identity is invented to earn snapping. Ambiguous
        # roots (duplicated identity in either stream), erased entities,
        # non-rigid frames and units without a PERSISTED placement
        # envelope offer no candidate: an unsafe target fails closed
        # instead of guessing.
        def placement_furniture_targets_provider(model)
          lambda do
            metadata_store = @metadata_store_factory.call(model)
            index = Connection::ProjectFurniture::ManagedFurniture.index(
              model, metadata_store
            )
            server_targets = index[:by_id].flat_map do |furniture_instance_id, entries|
              next [] if entries.length != 1

              placement_target_descriptor(furniture_instance_id, entries.first[:entity], metadata_store)
            end
            local_targets = index[:local_by_ref].flat_map do |instance_ref, entries|
              next [] if entries.length != 1

              placement_target_descriptor(instance_ref, entries.first[:entity], metadata_store)
            end
            server_targets + local_targets
          end
        end

        private

        # Oriented-frame descriptor of one managed root for the snap
        # engine (#469 increment 3). The frame comes from the entity's
        # REAL rigid transform (world origin + horizontal unit right/front
        # axes) plus the PERSISTED placement envelope
        # (`placementEnvelopeMm`: the layout-derived local box the
        # canonical commit writes through PlacementPreviewExtents — the
        # same authority the transient preview uses). The world AABB and
        # the definition bounds are explicitly NOT the side authority:
        # both aggregate whatever else the definition holds (protruding
        # hardware/visual assets) and would displace real cabinet sides.
        # Host transform axes are INCHES-direction vectors; the engine
        # works in mm. The label comes from the entity display name
        # (cosmetic only — identity stays the furnitureInstanceId above).
        def placement_target_descriptor(furniture_instance_id, entity, metadata_store)
          return [] unless entity.respond_to?(:transformation)
          return [] if entity.respond_to?(:valid?) && !entity.valid?

          frame = placement_target_frame(entity, metadata_store)
          return [] unless frame

          [{
            'furniture_instance_id' => furniture_instance_id,
            'label' => placement_target_label(entity),
            'origin_world_mm' => frame[:origin_world_mm],
            'front_dir_mm' => frame[:front_dir_mm],
            'right_dir_mm' => frame[:right_dir_mm],
            'local_min_mm' => frame[:local_min_mm],
            'local_max_mm' => frame[:local_max_mm]
          }]
        rescue StandardError => e
          @logger.warn('placement_target_skipped', { 'error' => e.message })
          []
        end

        # The root's oriented frame, validated fail-closed: horizontal
        # UNIT right/front (any yaw, but no tilt and no scaling — a scaled
        # instance's axis vectors leave unit length), mutually orthogonal
        # and right-handed (right × front = +Z: a mirrored frame is not
        # the furniture's own frame), with zaxis ≈ +Z (no tilt), and a
        # usable PERSISTED placement envelope. nil when any check fails —
        # such a target offers no candidate.
        def placement_target_frame(entity, metadata_store)
          transform = entity.transformation
          right = horizontal_unit_dir_mm(transform.xaxis)
          front = horizontal_unit_dir_mm(transform.yaxis)
          return nil unless right && front
          return nil unless (right[0] * front[1]) - (right[1] * front[0]) > 1.0 - UNIT_EPSILON
          return nil unless vertical_up_axis?(transform.zaxis)

          envelope = persisted_envelope(entity, metadata_store)
          return nil unless envelope

          { origin_world_mm: point_mm(transform.origin),
            front_dir_mm: front, right_dir_mm: right,
            local_min_mm: envelope[0], local_max_mm: envelope[1] }
        end

        # The persisted layout-derived placement box {min_mm:, max_mm:} as
        # a [min, max] pair of mm triples — nil (fail-closed) when the
        # metadata carries no valid envelope: the unit predates increment
        # 3 or its commit had no authoritative layout.
        def persisted_envelope(entity, metadata_store)
          metadata = metadata_store.respond_to?(:read) ? metadata_store.read(entity) : nil
          envelope = metadata.is_a?(Hash) ? metadata['placementEnvelopeMm'] : nil
          min = mm_triple(envelope.is_a?(Hash) ? envelope['min_mm'] : nil)
          max = mm_triple(envelope.is_a?(Hash) ? envelope['max_mm'] : nil)
          return nil unless min && max

          [min, max]
        end

        # A persisted coordinate triple: exactly 3 finite numerics in mm.
        def mm_triple(value)
          return nil unless value.is_a?(Array) && value.length == 3 &&
                            value.all? { |component| component.is_a?(Numeric) && component.to_f.finite? }

          value.map(&:to_f)
        end

        # Host Point3d (INCHES) → mm triple for frame/descriptor data.
        def point_mm(point)
          mm = 25.4
          [point.x.to_f * mm, point.y.to_f * mm, point.z.to_f * mm]
        end

        # A host axis vector as a horizontal UNIT mm direction — nil when
        # it tilts off the XY plane or leaves unit length (scaled).
        def horizontal_unit_dir_mm(vector)
          return nil unless vector.respond_to?(:x) && vector.respond_to?(:y) && vector.respond_to?(:z)

          x = vector.x.to_f
          y = vector.y.to_f
          z = vector.z.to_f
          return nil unless z.abs < UNIT_EPSILON
          return nil unless (Math.sqrt((x**2) + (y**2)) - 1.0).abs < UNIT_EPSILON

          [x, y, 0.0]
        end

        # zaxis must be exactly +Z: tilt or a flipped frame rejects.
        def vertical_up_axis?(vector)
          vector.respond_to?(:x) && vector.x.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:y) && vector.y.to_f.abs < UNIT_EPSILON &&
            vector.respond_to?(:z) && ((vector.z.to_f - 1.0).abs < UNIT_EPSILON)
        end

        # Display label: the entity's human name without the technical id
        # suffix. Cosmetic only — never identity authority.
        def placement_target_label(entity)
          name = entity.respond_to?(:name) ? entity.name.to_s : ''
          label = name.sub(/\s*\([^()]*\)\s*\z/, '').strip
          label.empty? ? 'Mueble' : label
        end
      end
    end
  end
end
