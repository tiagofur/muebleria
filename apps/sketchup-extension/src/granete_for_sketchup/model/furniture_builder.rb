# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Model
      # Paints entities with namespaced SketchUp materials so the workshop's
      # board choices and photographic textures are visible in the model. No-op
      # when the runtime exposes no materials API (pure stubs). Rendering only:
      # a material here is never manufacturing truth.
      module MaterialApplier
        DEFAULT_TILE_MM = 600.0
        MM_TO_INCHES = 1.0 / 25.4

        class << self
          def apply(model, target, name, color_hex, texture_path: nil, tile_width_mm: nil, tile_length_mm: nil,
                    grain: nil)
            return unless model.respond_to?(:materials)

            _ = grain
            material = find_or_create_material(model.materials, name)
            return unless material

            apply_color(material, color_hex)
            apply_texture(material, texture_path, tile_width_mm, tile_length_mm)
            target.material = material if target.respond_to?(:material=)
          end

          private

          def find_or_create_material(materials, name)
            return nil unless materials

            material_name = "Granete · #{name}"
            material = materials[material_name] if materials.respond_to?(:[])
            material || (materials.add(material_name) if materials.respond_to?(:add))
          end

          def apply_color(material, color_hex)
            return unless color_hex.is_a?(String) && color_hex.start_with?('#') && material.respond_to?(:color=)

            material.color = color_hex
          end

          def apply_texture(material, texture_path, tile_width_mm, tile_length_mm)
            return unless texture_path && File.file?(texture_path) && material.respond_to?(:texture=)

            material.texture = texture_path
            apply_texture_dimensions(material.texture, tile_width_mm, tile_length_mm) if material.respond_to?(:texture)
          rescue StandardError
            # Fall back to color if SketchUp fails to load texture format
            nil
          end

          def apply_texture_dimensions(texture, tile_width_mm, tile_length_mm)
            return unless texture

            w_mm = tile_width_mm&.to_f&.positive? ? tile_width_mm.to_f : DEFAULT_TILE_MM
            l_mm = tile_length_mm&.to_f&.positive? ? tile_length_mm.to_f : DEFAULT_TILE_MM
            w_in = w_mm * MM_TO_INCHES
            l_in = l_mm * MM_TO_INCHES

            if texture.respond_to?(:size=)
              texture.size = [w_in, l_in]
            elsif texture.respond_to?(:width=) && texture.respond_to?(:height=)
              texture.width = w_in
              texture.height = l_in
            end
          end
        end
      end

      # Local solid geometry + authoritative transform application (#414 →
      # #415). Pure host mechanics: build the definition-local box at origin
      # and turn the contract basis/translation into a Geom::Transformation.
      # Never world/AABB coordinates, never a mirror, never a scale.
      module LocalGeometry # rubocop:disable Metrics/ModuleLength
        MM_TO_INCHES = 1.0 / 25.4

        module_function

        # furniture_point = translationMm + basis · local_point. The basis is
        # orthonormal right-handed (parser-validated), so this is a pure
        # rigid placement — mirrors and non-uniform scale are impossible here.
        def axes_transform(translation_mm, basis)
          Geom::Transformation.axes(
            Geom::Point3d.new(translation_mm[0] * MM_TO_INCHES,
                              translation_mm[1] * MM_TO_INCHES,
                              translation_mm[2] * MM_TO_INCHES),
            Geom::Vector3d.new(basis['x'][0], basis['x'][1], basis['x'][2]),
            Geom::Vector3d.new(basis['y'][0], basis['y'][1], basis['y'][2]),
            Geom::Vector3d.new(basis['z'][0], basis['z'][1], basis['z'][2])
          )
        end

        def translation_only(translation_mm)
          Geom::Transformation.translation(
            Geom::Vector3d.new(translation_mm[0] * MM_TO_INCHES,
                               translation_mm[1] * MM_TO_INCHES,
                               translation_mm[2] * MM_TO_INCHES)
          )
        end

        # Builds the LOCAL solid box at the definition origin: the local box
        # spans [0,width]×[0,thickness]×[0,length] on X/Y/Z (engine
        # convention the #414 basis maps onto the furniture frame). World/AABB
        # coordinates are never baked into definition geometry. The bevel
        # wedge consumes the board's PUBLISHED basis: the cut corner and the
        # prism span derive from where furniture-front/top actually land in
        # local coordinates — inferring them from the band's own extents is
        # the guess that mirrored/flipped doors proved wrong.
        def build_local_box(definition, width_mm, thickness_mm, length_mm, notches: [], bevels: [], basis: nil)
          extents = [width_mm, thickness_mm, length_mm].map { |value| value * MM_TO_INCHES }

          local_box_segments(extents, notches, bevels, basis).each do |segment|
            if segment[:faces]
              add_prism_faces(definition, segment)
            else
              add_box_segment(definition, segment)
            end
          end
        end

        def add_box_segment(definition, segment)
          x0 = segment[:x0]
          x1 = segment[:x1]
          y0 = segment[:y0]
          y1 = segment[:y1]
          pts = [
            Geom::Point3d.new(x0, y0, segment[:z0]),
            Geom::Point3d.new(x1, y0, segment[:z0]),
            Geom::Point3d.new(x1, y1, segment[:z0]),
            Geom::Point3d.new(x0, y1, segment[:z0])
          ]
          face = definition.entities.add_face(pts)
          return unless face

          face.reverse! if face.respond_to?(:normal) && face.normal.respond_to?(:z) && face.normal.z.negative?
          face.pushpull(segment[:z1] - segment[:z0]) if (segment[:z1] - segment[:z0]).positive?
        end

        # Adds a segment whose solid is given EXPLICITLY as faces with
        # outward-wound point rings: no add_face-normal guessing, no
        # pushpull direction guessing — the two host behaviors that put the
        # bevel prism outside the door (#1327 feedback 5). Each face is
        # added independently; a degenerate ring fails loudly.
        def add_prism_faces(definition, segment)
          segment[:faces].each do |ring|
            pts = ring.map { |p| Geom::Point3d.new(p[0], p[1], p[2]) }
            face = definition.entities.add_face(pts)
            raise ArgumentError, 'el bisel generó una cara degenerada' unless face
          end
        end

        # #1287 / §13.3: a notched board builds as stacked segments along the
        # local Z (the vertical axis of the opening notch): full cross-section
        # below and above, and the front-reduced cross-section across the
        # notch band — the visible subtraction without boolean operations.
        # Axis-agnostic like the engine: the local width/thickness naming is
        # a catalog convention (a lateral may carry X=thickness and Y=depth
        # or the mirror), so the through axis is whichever span the notch
        # covers FULLY. Only a through corner notch with its height band on
        # the local Z is representable; anything else fails loudly instead
        # of silently rendering a plain box.
        # #1327 / §13.3 twin: a beveled board (#1327: the italian gola's
        # 45° door cut) builds as the plain-box stack PLUS a slanted capped
        # solid over the wedge band — the removed triangle prism leaves a
        # visible 45° shoulder instead of a plain front face. Representable
        # only as a through-edge wedge on local Z with its two legs equal
        # (the v1 45° cut); anything else fails loudly like the notch.
        # rubocop:disable-next Metrics/AbcSize, Metrics/CyclomaticComplexity, Metrics/PerceivedComplexity
        def local_box_segments(extents, notches, bevels = [], basis = nil)
          full = { x0: 0.0, x1: extents[0], y0: 0.0, y1: extents[1], z0: 0.0, z1: extents[2] }
          return [full] if (bevels.nil? || bevels.empty?) && (notches.nil? || notches.empty?)

          raise ArgumentError, 'sólo se materializa un bisel por tablero' if !bevels.nil? && bevels.size > 1

          if notches.nil? || notches.empty?
            return [full] if bevels.nil? || bevels.empty?

            return bevel_box_segments(full, bevels.first, extents, basis)
          end

          raise ArgumentError, 'sólo se materializa una muesca por tablero' if notches.size > 1
          raise ArgumentError, 'un tablero no combina muesca y bisel en v1' if !bevels.nil? && !bevels.empty?

          band = notch_band_in_inches(notches.first, extents)
          reduced = reduced_cross_section(band, extents)

          segments = []
          segments << full.merge(z0: 0.0, z1: band[:z0]) if band[:z0].positive?
          segments << full.merge(x0: reduced[:x0], x1: reduced[:x1], y0: reduced[:y0], y1: reduced[:y1],
                                 z0: band[:z0], z1: band[:z1])
          segments << full.merge(z0: band[:z1], z1: extents[2]) if band[:z1] < extents[2] - 1.0e-6
          segments
        end

        def notch_band_in_inches(notch, extents)
          band = notch_band_mm(notch).transform_values { |value| value * MM_TO_INCHES }
          through_axis?(band, extents) || raise_full_thickness
          unless band[:z1] <= extents[2] + 1.0e-6
            raise ArgumentError, 'la muesca excede la dimensión vertical del tablero'
          end

          band
        end

        def notch_band_mm(notch)
          start_mm = notch['startMm']
          size_mm = notch['sizeMm']
          {
            x0: start_mm[0], x1: start_mm[0] + size_mm[0],
            y0: start_mm[1], y1: start_mm[1] + size_mm[1],
            z0: start_mm[2], z1: start_mm[2] + size_mm[2]
          }
        end

        def through_axis?(band, extents)
          full_x = (band[:x1] - band[:x0] - extents[0]).abs < 1.0e-6
          full_y = (band[:y1] - band[:y0] - extents[1]).abs < 1.0e-6
          full_x || full_y
        end

        def raise_full_thickness
          raise ArgumentError, 'la muesca debe atravesar todo el espesor del tablero'
        end

        # #1327: the wedge band sits at the boundary end of local Z, covers
        # ONE full horizontal axis (the through span), meets one cross edge
        # of the other horizontal axis, and runs only PART of Z — otherwise
        # it is not the v1 bevel and fails loudly. The solid is emitted as
        # EXPLICIT faces with outward-wound rings (never add_face-normal +
        # pushpull guessing: that pair put the prism outside the door when
        # the host wound the section against the guess). The cut corner and
        # the prism's span derive from the PUBLISHED basis.
        def bevel_box_segments(full, bevel, extents, basis)
          band = bevel_band_in_inches(bevel, extents)

          segments = []
          segments << full.merge(z0: 0.0, z1: band[:z0]) if band[:z0].positive?
          segments << { faces: bevel_wedge_faces(band, extents, basis) }
          segments << full.merge(z0: band[:z1], z1: extents[2]) if band[:z1] < extents[2] - 1.0e-6
          segments
        end

        # rubocop:disable-next Metrics/AbcSize
        def bevel_band_in_inches(bevel, extents)
          start_mm = bevel['startMm']
          size_mm = bevel['sizeMm']
          band = {
            x0: start_mm[0] * MM_TO_INCHES, x1: (start_mm[0] + size_mm[0]) * MM_TO_INCHES,
            y0: start_mm[1] * MM_TO_INCHES, y1: (start_mm[1] + size_mm[1]) * MM_TO_INCHES,
            z0: start_mm[2] * MM_TO_INCHES, z1: (start_mm[2] + size_mm[2]) * MM_TO_INCHES,
            angle: bevel['angleDeg'],
            edge: bevel['edge']
          }
          angle_ok = (band[:angle] - 45.0).abs < 1.0e-6
          raise ArgumentError, 'sólo se materializa el bisel a 45° en v1' unless angle_ok
          unless %w[top_front bottom_front].include?(band[:edge])
            raise ArgumentError, 'el bisel no declara un borde válido'
          end

          through_x = ((band[:x1] - band[:x0]) - extents[0]).abs < 1.0e-6
          through_y = ((band[:y1] - band[:y0]) - extents[1]).abs < 1.0e-6
          unless through_x ^ through_y
            raise ArgumentError,
                  'el bisel debe atravesar exactamente un eje horizontal del tablero'
          end

          z_span = band[:z1] - band[:z0]
          edge_span = through_x ? (band[:y1] - band[:y0]) : (band[:x1] - band[:x0])
          raise ArgumentError, 'el bisel debe ser más bajo que el tablero' unless z_span < extents[2] - 1.0e-6
          unless (z_span - edge_span).abs < 1.0e-6
            raise ArgumentError, 'el bisel a 45° exige patas iguales sobre Z y el borde'
          end

          touches_z_top = (band[:z1] - extents[2]).abs < 1.0e-6
          touches_z_bottom = band[:z0] <= 1.0e-6
          edge_ok = (band[:edge] == 'top_front' && touches_z_top) ||
                    (band[:edge] == 'bottom_front' && touches_z_bottom)
          raise ArgumentError, 'el borde del bisel no coincide con la banda vertical' unless edge_ok

          band.merge(through: through_x ? :x : :y)
        end

        # The wedge's 5 faces (2 section triangles + 3 side quads), each with
        # an outward-wound ring. The section is the band rectangle minus the
        # 45° corner triangle at the corner the PUBLISHED BASIS derives —
        # in v1 (patas iguales) la sección siempre es un TRIÁNGULO.
        # rubocop:disable-next Metrics/AbcSize
        def bevel_wedge_faces(band, extents, basis)
          through = band[:through]
          raise ArgumentError, 'el bisel no declaró un eje through' if through.nil?

          edge_axis = through == :x ? :y : :x
          edge_extent = through == :x ? extents[1] : extents[0]
          front_local_end = published_axis_end(basis, 1, edge_axis, edge_extent)
          top_local_end = published_axis_end(basis, 2, :z, extents[2])
          z_end = band[:edge] == 'top_front' ? top_local_end : opposite_end(top_local_end)

          e_lo = band[edge_axis == :y ? :y0 : :x0]
          e_hi = band[edge_axis == :y ? :y1 : :x1]
          z_lo = band[:z0]
          z_hi = band[:z1]
          t_lo = band[through == :x ? :x0 : :y0]
          t_hi = band[through == :x ? :x1 : :y1]

          section = remaining_section(e_lo, e_hi, z_lo, z_hi, front_local_end, z_end)
          to_point = ->(t, e, z) { through == :x ? [t, e, z] : [e, t, z] }

          section_lo = section.map { |(e, z)| to_point.call(t_lo, e, z) }
          section_hi = section.map { |(e, z)| to_point.call(t_hi, e, z) }
          faces = [section_lo, section_hi]
          section.each_with_index do |(e1, z1), index|
            e2, z2 = section[(index + 1) % section.size]
            faces << [to_point.call(t_lo, e1, z1), to_point.call(t_hi, e1, z1),
                      to_point.call(t_hi, e2, z2), to_point.call(t_lo, e2, z2)]
          end

          centroid = wedge_centroid(faces)
          faces.map { |ring| orient_ring!(ring, centroid) }
        end

        # The local end (start|end) of `axis` whose published image points at
        # furniture axis `furniture_axis`: the basis column of the local axis
        # carries the furniture image of that local direction (≈ +1 ⇒ the
        # local END faces furniture-positive; ≈ −1 ⇒ the local START does).
        def published_axis_end(basis, furniture_axis, axis, extent)
          _ = extent
          column = basis_local_column(basis, axis_index(axis))
          raise ArgumentError, 'el tablero no publica base para ubicar el bisel' if column.nil?

          image = column[furniture_axis]
          raise ArgumentError, 'la base no alinea el eje del bisel con el mueble' if image.abs < 0.999

          image.positive? ? :end : :start
        end

        def basis_local_column(basis, local_axis)
          return nil if basis.nil?

          key = %w[x y z][local_axis]
          column = basis.is_a?(Hash) ? basis[key] : nil
          return nil unless column.is_a?(Array) && column.size == 3 && column.all?(Numeric)

          column.map(&:to_f)
        end

        def axis_index(axis)
          { x: 0, y: 1, z: 2 }[axis]
        end

        def opposite_end(end_sym)
          end_sym == :end ? :start : :end
        end

        # The band rectangle's three surviving corners once the 45° corner
        # triangle (edge_end, z_end) is removed.
        def remaining_section(e_lo, e_hi, z_lo, z_hi, edge_end, z_end)
          corners = {
            a: [e_lo, z_lo], b: [e_hi, z_lo], c: [e_hi, z_hi], d: [e_lo, z_hi]
          }
          cut = { %i[end end] => :c, %i[end start] => :b,
                  %i[start end] => :d, %i[start start] => :a }[[edge_end, z_end]]
          raise ArgumentError, 'esquina de corte del bisel no clasificable' if cut.nil?

          corners.reject { |key, _corner| key == cut }.values
        end

        def wedge_centroid(faces)
          points = faces.flatten(1)
          [0, 1, 2].map do |axis|
            points.map { |point| point[axis] }.sum / points.size.to_f
          end
        end

        # Newell normal of the ring; reversed when it points into the solid
        # (toward the centroid) — outward winding without hand-derived tables.
        def orient_ring!(ring, centroid)
          normal = ring_normal(ring)
          center = ring.transpose.map { |axis| axis.sum / ring.size.to_f }
          outward = center.zip(centroid).map { |f, c| f - c }
          dot = normal.zip(outward).sum { |n, o| (n * o).to_f }
          dot.negative? ? ring.reverse : ring
        end

        def ring_normal(ring)
          nx = ny = nz = 0.0
          ring.each_with_index do |point, index|
            next_point = ring[(index + 1) % ring.size]
            nx += (point[1] - next_point[1]) * (point[2] - next_point[2])
            ny += (point[2] - next_point[2]) * (point[0] - next_point[0])
            nz += (point[0] - next_point[0]) * (point[1] - next_point[1])
          end
          [nx, ny, nz]
        end

        # The cross-section complement of the notch band is representable as
        # ONE rectangle only when the partial span reaches one edge; an
        # interior strip is not representable and fails loudly.
        def reduced_cross_section(band, extents)
          if (band[:y1] - band[:y0] - extents[1]).abs < 1.0e-6
            touches_start = band[:x0] <= 1.0e-6
            touches_end = band[:x1] >= extents[0] - 1.0e-6
            raise ArgumentError, 'la muesca debe alcanzar un borde del tablero' unless touches_start || touches_end

            return { x0: touches_start ? band[:x1] : 0.0, x1: touches_start ? extents[0] : band[:x0],
                     y0: 0.0, y1: extents[1] }
          end

          touches_start = band[:y0] <= 1.0e-6
          touches_end = band[:y1] >= extents[1] - 1.0e-6
          raise ArgumentError, 'la muesca debe alcanzar un borde del tablero' unless touches_start || touches_end

          { x0: 0.0, x1: extents[0],
            y0: touches_start ? band[:y1] : 0.0, y1: touches_start ? extents[1] : band[:y0] }
        end
      end

      # Generic authoring fallback for catalogs that cannot resolve layouts
      # (offline/static): locally authored axis-aligned boards with identity
      # basis by construction — not an orientation guess — still rendered as
      # native ComponentInstances.
      module GenericAuthoringRenderer
        DEFAULT_THICKNESS_MM = 18.0
        PART_DEFINITION_PREFIX = 'Granete · Parte · '

        # The generic furniture box as [width, height, depth] mm — the ONE
        # authority shared by the renderer, the #469 local-lane preview
        # extents and the persisted placement envelope, so the preview box
        # and the committed generic composition can never drift apart.
        def self.generic_dimensions(parameters)
          [
            (parameters['widthMm'] || parameters['lengthMm'] || 600.0).to_f,
            (parameters['heightMm'] || 720.0).to_f,
            (parameters['depthMm'] || 590.0).to_f
          ]
        end

        # Generic-box extents in the placement-engine convention
        # (X=width, Y=depth, Z=height, origin at the box minimum).
        def self.generic_extents(parameters)
          width_mm, height_mm, depth_mm = generic_dimensions(parameters)
          { x: width_mm, y: depth_mm, z: height_mm, origin_mm: [0.0, 0.0, 0.0] }
        end

        def render_generic_parametric_layout(model, furniture_definition, instance_id, _definition, parameters)
          width_mm, height_mm, depth_mm = GenericAuthoringRenderer.generic_dimensions(parameters)
          thickness_mm = DEFAULT_THICKNESS_MM
          count = 2

          create_generic_component(model, furniture_definition, instance_id, 'left_side', 'Lateral Izquierdo',
                                   [0, 0, 0], [thickness_mm, depth_mm, height_mm])
          create_generic_component(model, furniture_definition, instance_id, 'right_side', 'Lateral Derecho',
                                   [width_mm - thickness_mm, 0, 0], [thickness_mm, depth_mm, height_mm])

          count += render_generic_shelves(model, furniture_definition, instance_id, parameters,
                                          width_mm, height_mm, depth_mm, thickness_mm)
          count += render_generic_doors(model, furniture_definition, instance_id, parameters,
                                        width_mm, height_mm, depth_mm, thickness_mm)
          count
        end

        private

        def render_generic_shelves(model, furniture_definition, instance_id, parameters,
                                   width_mm, height_mm, depth_mm, thickness_mm)
          shelf_count = (parameters['shelfCount'] || 0).to_i
          return 0 if shelf_count <= 0

          spacing = height_mm / (shelf_count + 1)
          (1..shelf_count).each do |i|
            create_generic_component(model, furniture_definition, instance_id, "shelf_#{i}", "Entrepaño #{i}",
                                     [thickness_mm, 0, spacing * i],
                                     [width_mm - (2 * thickness_mm), depth_mm, thickness_mm])
          end
          shelf_count
        end

        def render_generic_doors(model, furniture_definition, instance_id, parameters,
                                 width_mm, height_mm, depth_mm, thickness_mm)
          door_count = (parameters['doorCount'] || 0).to_i
          return 0 if door_count <= 0

          create_generic_component(model, furniture_definition, instance_id, 'door_1', 'Puerta',
                                   [0, depth_mm, 0], [width_mm, thickness_mm, height_mm])
          1
        end

        def create_generic_component(model, parent_definition, furniture_instance_id, slot_id, name, pos_mm, dims_mm)
          comp_id = "comp-#{furniture_instance_id}-#{slot_id}"
          component_definition = model.definitions.add("#{PART_DEFINITION_PREFIX}#{name} · #{comp_id}")
          LocalGeometry.build_local_box(component_definition, dims_mm[0], dims_mm[1], dims_mm[2])
          instance = parent_definition.entities.add_instance(component_definition,
                                                             LocalGeometry.translation_only(pos_mm))
          instance.name = name
          ChildMetadataWriter.write_part(@metadata_store, instance, comp_id, slot_id,
                                         furniture_ref: furniture_instance_id)
          instance
        end
      end

      # Normalizes editable furniture intent without resolving manufacturing
      # geometry. Material choices are merged as role-keyed authoring intent;
      # only Granete's NativeLayout may supply their physical consequences.
      module FurnitureIntent
        # Single normalization authority shared by the commit (insert/update)
        # and the #469 local-lane preview preparation — the normalized map is
        # what the generic renderer consumes, so the preview box is derived
        # from exactly the values the commit will use.
        def self.normalize_parameters(definition, raw_parameters)
          (definition['parameters'] || []).each_with_object({}) do |parameter, params|
            name = parameter['name']
            if raw_parameters.key?(name)
              params[name] = raw_parameters[name]
            elsif parameter.key?('defaultValue')
              params[name] = parameter['defaultValue']
            end
          end
        end

        private

        def normalize_parameters(definition, raw_parameters)
          FurnitureIntent.normalize_parameters(definition, raw_parameters)
        end

        # R3: material_choices semantics at this boundary:
        #   * Hash (partial or complete) → PATCH (#405 contract: a role edit
        #     sends just that role and every omitted persisted role survives);
        #   * CLEAR_MATERIAL_CHOICES     → the explicit total-clear statement
        #     (the minimal canonical representation of "remove every choice";
        #     none existed before — a Hash can't express it because {} is the
        #     identity of the patch);
        #   * nil                        → NO statement: the persisted intent
        #     survives untouched (MetadataWriter then omits the key and the
        #     working-copy merger preserves the server value, per #810/R2).
        def merge_material_choices(existing_meta, incoming_choices)
          existing = existing_meta&.dig('intent', 'materialChoices')
          existing = {} unless existing.is_a?(Hash)
          return {} if incoming_choices == FurnitureBuilder::CLEAR_MATERIAL_CHOICES
          return existing.merge(incoming_choices) if incoming_choices.is_a?(Hash)

          existing.dup
        end

        def material_choices_changed?(existing_meta, merged_choices)
          existing = existing_meta&.dig('intent', 'materialChoices')
          existing = {} unless existing.is_a?(Hash)
          merged_choices != existing
        end

        # Layout-less local inserts still persist their GENERIC box — the
        # same shared authority as the #469 local-lane preview extents — so a
        # placed local furniture is a valid side-snap target later without
        # inventing any server identity.
        def generic_placement_envelope(parameters)
          ext = GenericAuthoringRenderer.generic_extents(parameters || {})
          origin = ext[:origin_mm]
          { 'min_mm' => origin.dup,
            'max_mm' => [origin[0] + ext[:x], origin[1] + ext[:y], origin[2] + ext[:z]] }
        end

        # #469 increment 3 — the placement envelope this commit persists:
        # the SAME layout-derived local box the transient preview uses
        # (dimensionsMm, falling back to the resolved boards AABB). This
        # is the semantic authority later side-snapping reads — the host
        # definition bounds aggregate hardware/visual assets that may
        # protrude past the cabinet sides and must never displace a side
        # plane. nil for a layout-less path (the stored envelope survives).
        def placement_envelope(resolved_layout)
          Tools::PlacementPreviewExtents.envelope_from_layout(resolved_layout)
        end
      end

      # #389 / DT-5 — Place EXISTING project FurnitureInstance. Extracted
      # from FurnitureBuilder to keep the class within its length budget; it
      # shares the builder's private helpers and metadata writer.
      module ProjectPlacement
        # Renders the same native hierarchy as insert_furniture but stamps
        # the BACKEND's furnitureInstanceId as the authoritative business
        # identity. The ID arrives from the server (project furniture list)
        # and is never generated, derived from a definition/name/position or
        # reused from any local ref. Returns the placed entity handle so the
        # caller can read the final transform and sync the design working
        # copy; on any host error the operation aborts leaving no partial
        # hierarchy. relationships follows the MetadataWriter tri-state.
        # rubocop:disable-next Metrics/ParameterLists
        def place_existing_furniture(model, furniture_instance_id:, definition:, parameters: {},
                                     resolved_layout: nil, material_choices: nil,
                                     material_choice_modes: nil,
                                     project_id: nil, design_id: nil, relationships: nil,
                                     transformation: nil, prepare: true, preserve_parameters: false,
                                     transaction: true)
          unless furniture_instance_id.is_a?(String) && !furniture_instance_id.strip.empty?
            return { 'success' => false,
                     'error' => 'Se requiere la identidad (furnitureInstanceId) del mueble del proyecto' }
          end

          params = if preserve_parameters
                     JSON.parse(JSON.generate(parameters || {}))
                   else
                     normalize_parameters(definition, parameters)
                   end
          prefetch_visual_assets(model, resolved_layout)
          prep_err = insertion_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          host_transform = transformation || Geom::Transformation.new
          model.start_operation("Colocar Mueble del Proyecto #{definition['name']}", true) if transaction
          begin
            furniture_definition = create_furniture_definition(model, definition, furniture_instance_id)
            # FurnitureInstance roots are TOP-LEVEL (native entity model
            # §5/§12 + ManagedFurniture locator): insert into model.entities
            # regardless of any open editing context, so the unit can never
            # land nested inside another group/component and become
            # untraceable.
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            furniture = model.entities.add_instance(furniture_definition,
                                                    host_transform)
            furniture.name = "#{definition['name']} (#{furniture_instance_id})"
            counts = render_layout(model, furniture_definition, furniture_instance_id, definition,
                                   params, resolved_layout)
            MetadataWriter.write_furniture(@metadata_store, furniture, furniture_instance_id,
                                           definition, params,
                                           material_choices: material_choices,
                                           material_choice_modes: material_choice_modes,
                                           identity: { server: true, project_id: project_id,
                                                       design_id: design_id },
                                           relationships: relationships,
                                           placement_envelope: placement_envelope(resolved_layout))
            model.commit_operation if transaction
          rescue StandardError => e
            model.abort_operation if transaction
            return { 'success' => false, 'error' => e.message }
          end

          prepare_placement(model, furniture) if prepare
          { 'entity' => furniture }.merge(build_result(furniture_instance_id, definition, params, counts))
        end

        # Placement assist after commit: the furniture spawns at the
        # workshop-frame origin, so keep it selected and hand the user the
        # Move tool to land it where intended (interim step toward north-star
        # drag/placement). Never fails the reported operation: selection and
        # tool activation are UI state, not model geometry.
        def prepare_placement(model, furniture)
          selection = model.respond_to?(:selection) ? model.selection : nil
          return unless selection

          selection.clear
          selection.add(furniture)
          ::Sketchup.send_action('selectMoveTool:') if defined?(::Sketchup) && ::Sketchup.respond_to?(:send_action)
        rescue StandardError
          nil
        end

        # Reverts a JUST-placed furniture when the backend working-copy sync
        # failed (#389 failure atomicity): the insertion was new and its
        # generated definitions are isolated, so erasing the top-level entity
        # plus purging orphan Granete definitions restores the pre-place
        # state. Only ever call this with an entity this builder just created
        # in this session — never with user-authored or adopted geometry.
        def rollback_placement(model, furniture)
          model.start_operation('Revertir Colocación', true)
          begin
            # Destroy the managed children first so their part definitions
            # lose the last live instance and the scoped purge below can
            # remove them (same order update_furniture uses). The root is
            # erased from the model root — where place_existing_furniture
            # inserted it.
            furniture.definition.entities.clear! if furniture.respond_to?(:definition)
            # rubocop:disable-next SketchupSuggestions/ModelEntities
            model.entities.erase_entities([furniture])
            purge_orphan_generated_definitions(model)
            model.commit_operation
            true
          rescue StandardError
            model.abort_operation
            false
          end
        end
      end

      # Legacy Group → native migration build (#416 / SU-ENT-3). Extracted
      # from FurnitureBuilder to keep the class within its length budget;
      # it shares the builder's private helpers and metadata writer.
      module LegacyMigrationBuild
        # Builds the native ComponentInstance replacement for a legacy Group
        # furniture (#416 / SU-ENT-3) INSIDE the caller's undoable operation.
        # The migration migrator owns the single SketchUp operation: this
        # method must never start/commit its own (nested operations invalidate
        # Ruby entity references on the real host — Metadata::Store rule).
        #
        # Identity is preserved verbatim through existing_metadata (same
        # instanceRef/projectRef — a representation change NEVER allocates new
        # business identity); the world transform comes from the legacy Group;
        # the layout must be an authoritative NativeLayout, never a local
        # guess. The legacy source is NOT erased here — the migrator erases it
        # only after the replacement validates.
        def build_migrated_furniture(model, legacy_group, definition, parameters, resolved_layout,
                                     existing_metadata, material_choices: nil)
          instance_id = existing_metadata&.dig('identity', 'instanceRef')
          unless instance_id.is_a?(String) && !instance_id.strip.empty?
            raise ArgumentError, 'el mueble anterior no tiene instanceRef preservable'
          end
          unless resolved_layout.is_a?(Library::NativeLayout)
            raise ArgumentError, 'la migración requiere un layout resuelto autoritativo (NativeLayout)'
          end

          furniture_definition = create_furniture_definition(model, definition, instance_id)
          furniture = model.active_entities.add_instance(furniture_definition, legacy_group.transformation)
          furniture.name = "#{definition['name']} (#{instance_id})"
          counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                 resolved_layout)
          purge_orphan_generated_definitions(model)
          MetadataWriter.write_furniture(
            @metadata_store, furniture, instance_id, definition, parameters,
            material_choices: material_choices, existing_metadata: existing_metadata,
            migrated_from: MetadataWriter::PROVENANCE_FROM_LEGACY_GROUP,
            placement_envelope: placement_envelope(resolved_layout)
          )
          validate_migrated_replacement(furniture, instance_id, counts)
          furniture
        end

        # Post-build validation gate (#416 step 5): the migrator may only
        # erase the legacy source after this passes. Raises on any mismatch so
        # the caller aborts the operation and the legacy Group survives.
        def validate_migrated_replacement(furniture, instance_id, counts)
          unless furniture.is_a?(::Sketchup::ComponentInstance)
            raise 'migración: el reemplazo no es una ComponentInstance nativa'
          end
          raise 'migración: el layout resuelto no produjo componentes' if counts['total'].to_i <= 0

          replaced_metadata = @metadata_store&.read(furniture)
          unless replaced_metadata&.dig('identity', 'instanceRef') == instance_id
            raise 'migración: la identidad preservada no sobrevivió al reemplazo'
          end

          provenance = replaced_metadata&.dig('provenance', 'representationMigration')
          unless provenance&.dig('from') == MetadataWriter::PROVENANCE_FROM_LEGACY_GROUP
            raise 'migración: falta el marcador de provenance de representación'
          end

          nil
        end
      end

      # Hardware rendering for Library::NativeLayout (#414 / #668).
      module NativeHardwareRenderer # rubocop:disable Metrics/ModuleLength
        # Prefetches visual assets, passing model so AssetLoader can probe
        # R2 SKP loadability before any destructive rebuild (R1/R2, #668-C1 / #670-D).
        def prefetch_visual_assets(model, resolved_layout)
          return unless resolved_layout.is_a?(Library::NativeLayout)
          return unless @asset_loader.respond_to?(:prefetch_hardware_assets)

          @asset_loader.clear_diagnostics if @asset_loader.respond_to?(:clear_diagnostics)
          placements = resolved_layout.hardware.dup
          if resolved_layout.respond_to?(:assemblies) && resolved_layout.assemblies
            resolved_layout.assemblies.each do |assembly|
              placements.concat(assembly.rigid_members) if assembly.respond_to?(:rigid_members)
            end
          end
          @asset_loader.prefetch_hardware_assets(placements, model: model)
        end

        # Returns a typed error message when any prefetched placement is
        # :missing (download/loadability failure) or :invalid (bad MountFrame).
        # Falls back to the original asset_preparation_invalid scan when the
        # loader does not support rebuild_preflight_ok? (backward-compatible).
        def rebuild_preflight_error
          if @asset_loader.respond_to?(:rebuild_preflight_ok?)
            ok, msg = @asset_loader.rebuild_preflight_ok?
            return msg unless ok

            return nil
          end

          # Fallback: original behavior for loaders without preflight support.
          return nil unless @asset_loader.respond_to?(:diagnostics)

          diag = @asset_loader.diagnostics.find { |d| d['code'] == 'asset_preparation_invalid' }
          diag ? "Preparación de herraje inválida: #{diag['reason']}" : nil
        end

        # Policy B (insertion fallback, R4): returns a typed error only when
        # preparation is :invalid. Placements that are :missing (download failure
        # or loadability failure) return nil here so new furniture insertion
        # (insert_furniture / place_existing_furniture) falls back to parametric
        # proxy geometry without blocking the designer workflow.
        def insertion_preflight_error
          if @asset_loader.respond_to?(:insertion_preflight_ok?)
            ok, msg = @asset_loader.insertion_preflight_ok?
            return msg unless ok

            return nil
          end

          return nil unless @asset_loader.respond_to?(:diagnostics)

          diag = @asset_loader.diagnostics.find { |d| d['code'] == 'asset_preparation_invalid' }
          diag ? "Preparación de herraje inválida: #{diag['reason']}" : nil
        end

        def render_native_hardware(model, parent_definition, furniture_instance_id, placement,
                                   placement_transform: nil)
          name = placement.name || 'Herraje'
          pos = placement_transform || placement.local_translation || placement.translation || [0.0, 0.0, 0.0]

          instance = try_load_hardware_asset(model, parent_definition, placement, pos)
          if instance
            scale_linear_hardware(instance, placement)
            return attach_hardware_metadata(instance, placement, name, furniture_instance_id, exact: true)
          end
          return nil if invalid_hardware_preparation?(placement.placement_id)

          fallback = build_fallback_hardware(model, parent_definition, name, placement, pos)
          attach_hardware_metadata(fallback, placement, name, furniture_instance_id, exact: false)
        end

        private

        def try_load_hardware_asset(model, parent_definition, placement, pos)
          asset_id = placement.asset_id || placement.hardware_id
          return nil unless @asset_loader && asset_id

          @asset_loader.load_asset_instance(
            model, asset_id, parent_definition, pos,
            basis: placement.basis,
            revision_id: placement.asset_revision_id,
            sha256: placement.sha256,
            expected_bytes: placement.expected_bytes,
            mount_frame: placement.respond_to?(:mount_frame) ? placement.mount_frame : nil,
            preparation_state: placement.respond_to?(:preparation_state) ? placement.preparation_state : nil,
            placement_id: placement.placement_id
          )
        end

        # #1276: linear extruded hardware runs (gola profile) stretch
        # across the target cabinet width. The component's extrusion axis (X)
        # scales to match placement.dimensions[0], leaving Y and Z unscaled
        # so the profile's cross section is never distorted.
        def scale_linear_hardware(instance, placement)
          return unless placement.respond_to?(:placement_kind) && placement.placement_kind == 'derived'
          return unless placement.respond_to?(:dimensions) && placement.dimensions.is_a?(Array)

          target_length_mm = placement.dimensions[0].to_f
          return unless target_length_mm.positive?
          return unless placement.placement_id.to_s.include?('profile')

          bounds = instance.definition.respond_to?(:bounds) ? instance.definition.bounds : nil
          return unless bounds.respond_to?(:width)

          current_length_mm = bounds.width.to_f * 25.4
          return if current_length_mm <= 0 || (current_length_mm - target_length_mm).abs < 1.0

          scale_x = target_length_mm / current_length_mm
          return unless defined?(::Geom::Transformation.scaling)

          scaling = ::Geom::Transformation.scaling(scale_x, 1.0, 1.0)
          instance.transformation = instance.transformation * scaling
        rescue StandardError
          nil
        end

        def invalid_hardware_preparation?(placement_id)
          return false unless @asset_loader.respond_to?(:diagnostics)

          @asset_loader.diagnostics.any? do |d|
            d['code'] == 'asset_preparation_invalid' && d['placementId'] == placement_id
          end
        end

        def build_fallback_hardware(model, parent_definition, name, placement, pos)
          dims = placement.dimensions || FurnitureBuilder::DEFAULT_HARDWARE_DIMS_MM
          hardware_definition = model.definitions.add(
            "#{FurnitureBuilder::HARDWARE_DEFINITION_PREFIX}#{name} · #{placement.placement_id}"
          )
          LocalGeometry.build_local_box(hardware_definition, dims[0], dims[1], dims[2])
          transform = if defined?(::Geom::Transformation) && pos.is_a?(::Geom::Transformation)
                        pos
                      elsif placement.basis
                        LocalGeometry.axes_transform(pos, placement.basis)
                      else
                        LocalGeometry.translation_only(pos)
                      end
          instance = parent_definition.entities.add_instance(hardware_definition, transform)
          instance.name = name
          MaterialApplier.apply(model, instance, name, placement.color_hex)
          instance
        end

        def attach_hardware_metadata(instance, placement, name, furniture_instance_id, exact: true)
          instance.name = name
          rep = exact ? (placement.representation || 'exact') : 'proxy'
          ChildMetadataWriter.write_hardware(
            @metadata_store, instance, placement.placement_id,
            furniture_ref: furniture_instance_id,
            hardware_definition_id: placement.hardware_id,
            host_component_instance_id: placement.host_component_instance_id,
            placement_kind: placement.placement_kind,
            option_role: placement.respond_to?(:option_role) ? placement.option_role : nil,
            anchor_face: placement.anchor_face,
            offset_mm: placement.offset_mm,
            asset_id: placement.asset_id,
            asset_revision_id: placement.asset_revision_id,
            representation: rep,
            preparation_state: placement.respond_to?(:preparation_state) ? placement.preparation_state : nil,
            assembly_instance_id: placement.respond_to?(:assembly_instance_id) ? placement.assembly_instance_id : nil,
            agregado_id: placement.respond_to?(:agregado_id) ? placement.agregado_id : nil,
            member_id: placement.respond_to?(:member_id) ? placement.member_id : nil,
            recipe_revision: placement.respond_to?(:recipe_revision) ? placement.recipe_revision : nil,
            snapshot_id: placement.respond_to?(:snapshot_id) ? placement.snapshot_id : nil,
            is_historical: placement.respond_to?(:historical?) ? placement.historical? : false
          )
          instance
        end
      end

      # Renders resolved Library::NativeLayout composition (#414 contract / #670-D).
      # Extracted from FurnitureBuilder to keep the class within its length budget.
      module NativeLayoutRenderer # rubocop:disable Metrics/ModuleLength
        def render_native_layout(model, furniture_definition, instance_id, native_layout)
          native_layout.boards.each do |board|
            render_native_board(model, furniture_definition, instance_id, board)
          end
          native_layout.hardware.each do |placement|
            render_native_hardware(model, furniture_definition, instance_id, placement)
          end
          assembly_counts = render_native_assemblies(model, furniture_definition, instance_id, native_layout)
          total_boards = native_layout.boards.length + assembly_counts['boards']
          total_hardware = native_layout.hardware.length + assembly_counts['hardware']
          {
            'total' => total_boards + total_hardware,
            'boards' => total_boards,
            'hardware' => total_hardware,
            'assemblies' => assembly_counts['assemblies']
          }
        end

        def render_native_assemblies(model, furniture_definition, instance_id, native_layout)
          boards_count = 0
          hardware_count = 0
          assemblies_count = 0
          if native_layout.respond_to?(:assemblies) && native_layout.assemblies
            native_layout.assemblies.each do |assembly|
              counts = render_native_assembly(model, furniture_definition, instance_id, assembly)
              boards_count += counts['boards']
              hardware_count += counts['hardware']
              assemblies_count += 1
            end
          end
          { 'boards' => boards_count, 'hardware' => hardware_count, 'assemblies' => assemblies_count }
        end

        def render_native_assembly(model, furniture_definition, instance_id, assembly)
          t_assembly = LocalGeometry.axes_transform(assembly.translation, assembly.basis)
          boards = render_assembly_fabricated_components(model, furniture_definition, instance_id,
                                                         assembly, t_assembly)
          hardware = render_assembly_rigid_members(model, furniture_definition, instance_id,
                                                   assembly, t_assembly)
          { 'boards' => boards, 'hardware' => hardware }
        end

        def render_assembly_fabricated_components(model, furniture_definition, instance_id, assembly, t_assembly)
          count = 0
          assembly.fabricated_components.each do |comp|
            t_comp = LocalGeometry.axes_transform(comp.translation, comp.basis)
            t_furniture = t_assembly * t_comp
            render_native_board(
              model, furniture_definition, instance_id, comp,
              placement_transform: t_furniture,
              assembly_instance_id: assembly.assembly_instance_id,
              agregado_id: assembly.agregado_id,
              component_id: comp.component_id,
              recipe_revision: assembly.recipe_revision,
              snapshot_id: assembly.snapshot_id,
              is_historical: assembly.historical?
            )
            count += 1
          end
          count
        end

        def render_assembly_rigid_members(model, furniture_definition, instance_id, assembly, t_assembly)
          count = 0
          assembly.rigid_members.each do |member|
            t_member = LocalGeometry.axes_transform(member.translation, member.basis)
            t_furniture = t_assembly * t_member
            render_native_hardware(
              model, furniture_definition, instance_id, member,
              placement_transform: t_furniture
            )
            count += 1
          end
          count
        end

        # rubocop:disable-next Metrics/ParameterLists
        def render_native_board(model, parent_definition, furniture_instance_id, board,
                                placement_transform: nil, assembly_instance_id: nil,
                                agregado_id: nil, component_id: nil,
                                recipe_revision: nil, snapshot_id: nil, is_historical: false)
          name = board.name || board.slot_id || board.component_instance_id
          board_definition = model.definitions.add(
            "#{FurnitureBuilder::PART_DEFINITION_PREFIX}#{name} · #{board.component_instance_id}"
          )
          # Assembly fabricated components are plain boxes today — the notch
          # is a body-board effect (#1287) only the layout contract carries.
          notches = board.respond_to?(:notches) ? board.notches : []
          # #1327: the door bevel wedge rides the same local-geometry channel
          # (absent on everything the layout contract did not decorate). The
          # published basis decides WHERE the cut lands and WHICH way the
          # prism spans — never a guess from the band's own coordinates.
          bevels = board.respond_to?(:bevels) ? board.bevels : []
          LocalGeometry.build_local_box(board_definition, board.width_mm, board.thickness_mm,
                                        board.length_mm, notches: notches, bevels: bevels,
                                                         basis: board.respond_to?(:basis) ? board.basis : nil)

          transform = placement_transform || LocalGeometry.axes_transform(board.translation, board.basis)
          instance = parent_definition.entities.add_instance(board_definition, transform)
          instance.name = name

          paint_board(model, instance, board)
          ChildMetadataWriter.write_part(
            @metadata_store, instance, board.component_instance_id, board.slot_id,
            component_definition_id: board.component_definition_id,
            catalog_component_id: board.catalog_component_id,
            furniture_ref: furniture_instance_id,
            role: board.role,
            material_binding_role: board.option_role,
            assembly_translation_mm: board.translation,
            authoring_capability: board.authoring_capability,
            assembly_instance_id: assembly_instance_id,
            agregado_id: agregado_id,
            component_id: component_id,
            recipe_revision: recipe_revision,
            snapshot_id: snapshot_id,
            is_historical: is_historical
          )
          instance
        end

        def paint_board(model, instance, board)
          material_name = board.material_name || board.option_role || board.slot_id || 'Tablero'
          texture_url = board.material_texture_url || board.material_image_url
          texture_path = @texture_cache&.resolve_texture(texture_url)
          MaterialApplier.apply(
            model, instance, material_name, board.material_color_hex,
            texture_path: texture_path,
            tile_width_mm: board.material_texture_tile_width_mm,
            tile_length_mm: board.material_texture_tile_length_mm,
            grain: board.material_grain
          )
        end
      end

      # Native SketchUp renderer (#415 / ADR-0004). Every managed furniture is
      # a top-level Sketchup::ComponentInstance with an isolated generated
      # ComponentDefinition; every managed board/hardware is a nested
      # ComponentInstance whose definition holds LOCAL geometry at origin and
      # whose transform is the authoritative #414 local→furniture placement.
      #
      # Pure visual adapter: zero manufacturing rules/thickness calculation,
      # zero orientation inference, zero world-AABB baking and zero
      # non-uniform scaling. Granete IDs never derive from host IDs.
      class FurnitureBuilder
        include GenericAuthoringRenderer
        include FurnitureIntent
        include ProjectPlacement
        include LegacyMigrationBuild
        include NativeHardwareRenderer
        include NativeLayoutRenderer

        MM_TO_INCHES = 1.0 / 25.4
        DEFAULT_HARDWARE_DIMS_MM = [96.0, 32.0, 25.0].freeze

        FURNITURE_DEFINITION_PREFIX = 'Granete · Mueble · '
        PART_DEFINITION_PREFIX = 'Granete · Parte · '
        HARDWARE_DEFINITION_PREFIX = 'Granete · Herraje · '
        LEGACY_REPRESENTATION_ERROR =
          'El mueble usa una representación anterior del plugin (Group) que aún no fue ' \
          'migrada a ComponentInstance nativo. Usá Granete → Migrar modelos ' \
          'anteriores para actualizarlo.'
        MATERIAL_RESOLUTION_REQUIRED_ERROR =
          'El cambio de material requiere una composición nativa resuelta por Granete; ' \
          'el mueble anterior no fue modificado.'
        # R3/#810: explicit total-clear statement for update_furniture's
        # material_choices (never a data map; see merge_material_choices).
        CLEAR_MATERIAL_CHOICES = :clear_material_choices

        def initialize(metadata_store: nil, asset_loader: nil, texture_cache: nil)
          @metadata_store = metadata_store
          @asset_loader = asset_loader
          @texture_cache = texture_cache
        end

        # Local catalog insertion (#469 increment 4): `transformation` is
        # the ACCEPTED placement-tool transform — the root is created
        # TOP-LEVEL (managed roots must never land inside an open edit
        # context) directly at its final pose inside the ONE undoable
        # operation, and `prepare` stays false (the click IS the placement;
        # no Move handoff). Legacy callers without a transformation keep the
        # historical origin + Move behavior as the compat fallback.
        def insert_furniture(model, definition, raw_parameters = {}, resolved_layout: nil, material_choices: nil,
                             transformation: nil, prepare: true)
          parameters = normalize_parameters(definition, raw_parameters)
          instance_id = generate_instance_id

          prefetch_visual_assets(model, resolved_layout)
          prep_err = insertion_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          envelope = placement_envelope(resolved_layout) || generic_placement_envelope(parameters)
          model.start_operation("Insertar Mueble #{definition['name']}", true)
          begin
            furniture_definition = create_furniture_definition(model, definition, instance_id)
            # Transformation.new IS the identity transform on the real host
            # (there is no Transformation.identity constructor).
            host_transform = transformation || Geom::Transformation.new
            container = transformation ? top_level_entities(model) : model.active_entities
            furniture = container.add_instance(furniture_definition, host_transform)
            furniture.name = "#{definition['name']} (#{instance_id})"
            counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                   resolved_layout)
            MetadataWriter.write_furniture(@metadata_store, furniture, instance_id, definition, parameters,
                                           material_choices: material_choices,
                                           placement_envelope: envelope)
            model.commit_operation
          rescue StandardError => e
            model.abort_operation
            return { 'success' => false, 'error' => e.message }
          end

          prepare_placement(model, furniture) if prepare
          build_result(instance_id, definition, parameters, counts)
        end

        # Managed furniture roots are TOP-LEVEL (#469 + native entity model):
        # the preview-commit insert goes to the model root regardless of any
        # open editing context, exactly like the Project lanes.
        def top_level_entities(model)
          # rubocop:disable-next SketchupSuggestions/ModelEntities
          model.entities
        end

        # Rebuilds the furniture INSIDE its existing isolated host definition:
        # the top-level instance (identity + world transform) is never
        # replaced, only its definition's children are regenerated. Child
        # persistent_ids may change; Granete contract IDs are the durable link.
        def update_furniture(model, furniture, definition, raw_parameters = {}, resolved_layout: nil,
                             material_choices: nil, material_choice_modes: nil, transaction: true,
                             relationships: nil, authoring_dirty: true)
          # Host-accurate native check: in SketchUp a Group ALSO responds to
          # #definition, so entity type — not duck typing — is the only safe
          # discriminator. Legacy Group representations fail closed: use the
          # migration workflow (Granete → Migrar modelos anteriores).
          unless furniture.is_a?(::Sketchup::ComponentInstance)
            return { 'success' => false, 'error' => LEGACY_REPRESENTATION_ERROR }
          end

          parameters = normalize_parameters(definition, raw_parameters)
          existing_meta = @metadata_store&.read(furniture)
          instance_id = existing_meta&.dig('identity', 'instanceRef') || generate_instance_id
          merged_material_choices = merge_material_choices(existing_meta, material_choices)

          if material_choices_changed?(existing_meta, merged_material_choices) &&
             !resolved_layout.is_a?(Library::NativeLayout)
            return { 'success' => false, 'error' => MATERIAL_RESOLUTION_REQUIRED_ERROR }
          end

          prefetch_visual_assets(model, resolved_layout)
          prep_err = rebuild_preflight_error
          return { 'success' => false, 'error' => prep_err } if prep_err

          model.start_operation("Editar Mueble #{definition['name']}", true) if transaction
          begin
            # A native copy/paste can temporarily leave two top-level furniture
            # instances sharing one host definition. Isolate the target before
            # touching its children so FI-A can never mutate FI-B. make_unique
            # returns this same instance and preserves its world transform.
            furniture.make_unique if furniture.definition.instances.length > 1
            furniture_definition = furniture.definition
            furniture_definition.entities.clear!
            counts = render_layout(model, furniture_definition, instance_id, definition, parameters,
                                   resolved_layout)
            purge_orphan_generated_definitions(model)
            MetadataWriter.write_furniture(
              @metadata_store, furniture, instance_id, definition, parameters,
              material_choices: merged_material_choices, existing_metadata: existing_meta,
              material_choice_modes: material_choice_modes,
              relationships: relationships, authoring_dirty: authoring_dirty,
              placement_envelope: placement_envelope(resolved_layout)
            )
            model.commit_operation if transaction
          rescue StandardError => e
            if transaction
              model.abort_operation
              return { 'success' => false, 'error' => e.message }
            end
            raise
          end

          build_result(instance_id, definition, parameters, counts)
        end

        private

        def generate_instance_id
          "inst-#{rand(0x1000..0xffff).to_s(16)}#{rand(0x1000..0xffff).to_s(16)}"
        end

        def build_result(instance_id, definition, parameters, counts)
          res = {
            'success' => true,
            'instance_id' => instance_id,
            'name' => definition['name'],
            'component_count' => counts['total'],
            'board_count' => counts['boards'],
            'hardware_count' => counts['hardware'],
            'parameters' => parameters
          }
          res['assembly_count'] = counts['assemblies'] if counts['assemblies']
          if @asset_loader.respond_to?(:diagnostics) && !@asset_loader.diagnostics.empty?
            res['diagnostics'] = @asset_loader.diagnostics.dup
          end
          res
        end

        # The top-level host definition is isolated per FurnitureInstance
        # (ADR-0004 §6): two units of the same Granete FurnitureDefinition
        # each get their own generated definition, so a rebuild of FI-A can
        # never mutate FI-B through a shared definition.
        def create_furniture_definition(model, definition, instance_id)
          model.definitions.add("#{FURNITURE_DEFINITION_PREFIX}#{definition['name']} · #{instance_id}")
        end

        def render_layout(model, furniture_definition, instance_id, definition, parameters, resolved_layout)
          case resolved_layout
          when Library::NativeLayout
            render_native_layout(model, furniture_definition, instance_id, resolved_layout)
          when nil
            count = render_generic_parametric_layout(model, furniture_definition, instance_id,
                                                     definition, parameters)
            { 'total' => count, 'boards' => count, 'hardware' => 0 }
          else
            raise ArgumentError,
                  'resolved_layout debe ser un Library::NativeLayout parseado vía LayoutContract.parse! ' \
                  '(contrato granete.local-basis.v1); el renderer no consume bodies crudos ni infiere AABBs'
          end
        end

        # Scoped generated-definition cleanup (ADR-0004 §22): only Granete
        # BOARD/HARDWARE definitions with zero live instances are removed after
        # a rebuild. Never a broad purge — user/third-party definitions stay.
        def purge_orphan_generated_definitions(model)
          definitions = model.respond_to?(:definitions) ? model.definitions : nil
          return unless definitions.respond_to?(:each) && definitions.respond_to?(:remove)

          orphans = definitions.select do |definition|
            (definition.name.to_s.start_with?(PART_DEFINITION_PREFIX) ||
             definition.name.to_s.start_with?(HARDWARE_DEFINITION_PREFIX)) &&
              definition.respond_to?(:instances) && definition.instances.empty?
          end
          orphans.each { |definition| definitions.remove(definition) }
        end
      end

      # Managed child (part/hardware) metadata writer, extracted to keep
      # MetadataWriter within its length budget. Same store, same envelope.
      module ChildMetadataWriter
        module_function

        # write_part: managed physical part/aggregate occurrence.
        # component_definition_id is the #346 stable authoring-definition ID
        # (Granete-owned); catalog_component_id is a separate optional
        # catalog reference namespace that never aliases it. placement,
        # assembly_translation_mm and authoring_capability carry the
        # server-resolved state of the occurrence (#467): display/affordance
        # seeds only — the authoring resolve re-reads the fresh authoritative
        # layout before mutating.
        # rubocop:disable-next Metrics/ParameterLists
        def write_part(store, entity, comp_id, slot_id, component_definition_id: nil,
                       catalog_component_id: nil, furniture_ref: nil, role: nil,
                       material_binding_role: nil, entity_class: 'part',
                       assembly_translation_mm: nil, authoring_capability: nil,
                       assembly_instance_id: nil, agregado_id: nil, component_id: nil,
                       recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless store

          identity = child_identity(store, comp_id, furniture_ref)
          identity['componentDefinitionId'] = component_definition_id if component_definition_id
          identity['catalogComponentId'] = catalog_component_id if catalog_component_id
          apply_assembly_metadata(identity, assembly_instance_id, agregado_id, component_id, 'componentId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          intent = { 'entityClass' => entity_class }
          intent['semanticRole'] = slot_id if slot_id
          intent['placement'] = slot_id if slot_id
          intent['role'] = role if role
          intent['materialBindingRole'] = material_binding_role if material_binding_role
          intent['assemblyTranslationMm'] = assembly_translation_mm if assembly_translation_mm
          intent['authoringCapability'] = authoring_capability if authoring_capability
          apply_assembly_metadata(intent, assembly_instance_id, agregado_id, component_id, 'componentId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          write_child(store, entity, identity, intent)
        end

        # write_hardware: managed hardware placement occurrence (#476 / #670-D).
        # rubocop:disable-next Metrics/ParameterLists
        # rubocop:disable Metrics/CyclomaticComplexity, Metrics/PerceivedComplexity
        # — un campo opcional de intent más (#1046 S3 optionRole) supera el
        # umbral; el writer documenta el contrato de metadata hijo campo a
        # campo y un hash builder lo escondería.
        def write_hardware(store, entity, placement_id, furniture_ref:,
                           hardware_definition_id: nil, host_component_instance_id: nil,
                           placement_kind: nil, anchor_face: nil, offset_mm: nil,
                           asset_id: nil, asset_revision_id: nil, representation: nil,
                           preparation_state: nil, option_role: nil,
                           assembly_instance_id: nil, agregado_id: nil, member_id: nil,
                           recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          identity = {
            'instanceRef' => placement_id,
            'hardwarePlacementId' => placement_id,
            'projectRef' => proj_ref
          }
          identity['furnitureInstanceRef'] = furniture_ref if furniture_ref
          identity['assetRevisionId'] = asset_revision_id if asset_revision_id && assembly_instance_id
          apply_assembly_metadata(identity, assembly_instance_id, agregado_id, member_id, 'memberId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          intent = { 'entityClass' => 'hardware' }
          intent['semanticRole'] = "hardware_#{placement_id}"
          intent['hardwareDefinitionId'] = hardware_definition_id if hardware_definition_id
          intent['hostComponentInstanceId'] = host_component_instance_id if host_component_instance_id
          # Only the contract's #350 provenance is stored; a missing/legacy
          # value stays absent so the resolver reports 'unknown' fail-closed.
          intent['placementKind'] = placement_kind if placement_kind
          # #1046 S3: grupo que gobierna este placement (el modelo se elige por
          # grupo en Herrajes del mueble, nunca pinnendo la ocurrencia).
          intent['optionRole'] = option_role if option_role
          intent['anchorFace'] = anchor_face if anchor_face
          intent['offsetMm'] = offset_mm if offset_mm
          intent['assetId'] = asset_id if asset_id
          intent['assetRevisionId'] = asset_revision_id if asset_revision_id
          intent['representation'] = representation if representation
          intent['preparationState'] = preparation_state if preparation_state
          apply_assembly_metadata(intent, assembly_instance_id, agregado_id, member_id, 'memberId',
                                  recipe_revision: recipe_revision, snapshot_id: snapshot_id,
                                  is_historical: is_historical)

          write_child(store, entity, identity, intent)
        end
        # rubocop:enable Metrics/CyclomaticComplexity, Metrics/PerceivedComplexity

        def apply_assembly_metadata(hash, assembly_instance_id, agregado_id, item_id, item_key,
                                    recipe_revision: nil, snapshot_id: nil, is_historical: false)
          return unless assembly_instance_id

          hash['assemblyInstanceId'] = assembly_instance_id
          hash['agregadoId'] = agregado_id if agregado_id
          hash[item_key] = item_id if item_id
          hash['recipeRevision'] = recipe_revision if recipe_revision
          hash['snapshotId'] = snapshot_id if snapshot_id
          hash['isHistorical'] = true if is_historical
        end

        def child_identity(store, comp_id, furniture_ref)
          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          identity = {
            'instanceRef' => comp_id,
            'componentInstanceId' => comp_id,
            'projectRef' => proj_ref
          }
          identity['furnitureInstanceRef'] = furniture_ref if furniture_ref
          identity
        end

        def write_child(store, entity, identity, intent)
          store.write(entity, {
                        'namespace' => 'com.granete.sketchup_extension',
                        'metadataVersion' => 1,
                        'kind' => 'componentInstance',
                        'identity' => identity,
                        'intent' => intent
                      })
        end
      end

      # Writes the semantic metadata dictionaries (furniture + component
      # levels) through the metadata store. Granete contract IDs are
      # namespaced authoring identity: host GUID/persistent_id/name are never
      # stored as business identity and rename never mutates them. Piezas y
      # herrajes keep SEPARATE occurrence namespaces (componentInstanceId vs
      # hardwarePlacementId) that never alias each other.
      module MetadataWriter
        module_function

        # #416 representation-migration provenance source (marker, never
        # identity): rebuilt from the legacy Group model.
        PROVENANCE_FROM_LEGACY_GROUP = 'legacy-group'

        # identity (optional, #389): { server: true, project_id:, design_id: }
        # marks a placement whose instance_id IS the backend
        # furnitureInstanceId; a copied existing_metadata keeps a previously
        # stored server identity through rebuilds with no flag.
        # authoring_dirty (#810 rule C): true marks a local authoring edit
        # (parameters/materials) whose fields the working copy has not
        # confirmed yet; the explicit design sync clears it after readback.
        # placement_envelope (#469 increment 3): the layout-derived local
        # placement box {min_mm:, max_mm:} later semantic side-snapping
        # consumes. Tri-state like relationships: nil preserves whatever
        # the existing metadata carries; a Hash replaces it.
        # rubocop:disable-next Metrics/ParameterLists
        def write_furniture(store, furniture, instance_id, definition, parameters,
                            material_choices: nil, material_choice_modes: nil, existing_metadata: nil,
                            migrated_from: nil, identity: nil, relationships: nil,
                            authoring_dirty: false, placement_envelope: nil)
          return unless store

          proj_ref = store.respond_to?(:project_ref) ? store.project_ref : 'project-sketchup-active'
          rev_ref = definition['revisionId'] || definition['version'] || 'rev-1'
          metadata_payload = json_copy(existing_metadata.is_a?(Hash) ? existing_metadata : {})
          write_envelope(metadata_payload)
          apply_placement_envelope(metadata_payload, placement_envelope)
          metadata_payload['identity'] = furniture_identity(metadata_payload, instance_id, proj_ref,
                                                            rev_ref, identity: identity)
          metadata_payload['intent'] = furniture_intent(
            metadata_payload, definition, parameters, material_choices,
            material_choice_modes: material_choice_modes
          )
          if authoring_dirty
            metadata_payload['authoringDirty'] = true
          else
            metadata_payload.delete('authoringDirty')
          end
          metadata_payload['provenance'] = representation_migration(migrated_from) if migrated_from
          apply_relationship_state(metadata_payload, relationships)
          store.write(furniture, metadata_payload)
        end

        # Relationship persistence is tri-state (#558): nil means the caller
        # supplied NO relationship state and the existing metadata must survive
        # verbatim; [] is the authoritative empty set and clears; a non-empty
        # Array replaces with the authoritative resolve output. Anything else
        # is a programming error, never a silent guess.
        def apply_relationship_state(payload, relationships)
          case relationships
          when nil
            nil
          when Array
            if relationships.empty?
              payload.delete('relationships')
            else
              payload['relationships'] = relationships
            end
          else
            raise ArgumentError, 'relationships debe ser nil o un Array de relaciones resueltas'
          end
        end

        # #389 identity convergence: with a server identity the
        # furnitureInstanceId is the authority and instanceRef aliases the
        # SAME value — a compat locator, never a second business identity.
        # Local insertions keep a local ref until #390; rebuilds preserve
        # whatever the copied identity already carries.
        def furniture_identity(payload, instance_id, project_ref, revision_ref, identity: nil)
          identity_hash = payload['identity'].is_a?(Hash) ? payload['identity'] : {}
          if identity.is_a?(Hash) && identity[:server]
            identity_hash['furnitureInstanceId'] = instance_id
            identity_hash['instanceRef'] = instance_id
          else
            identity_hash['instanceRef'] ||= instance_id
          end
          project_id = identity.is_a?(Hash) ? identity[:project_id] : nil
          design_id = identity.is_a?(Hash) ? identity[:design_id] : nil
          identity_hash['projectId'] = project_id if project_id && !project_id.to_s.strip.empty?
          identity_hash['designId'] = design_id if design_id && !design_id.to_s.strip.empty?
          identity_hash['projectRef'] ||= project_ref
          identity_hash['sourceRevisionRef'] = revision_ref
          identity_hash
        end

        # Provenance marker retained after a successful migration (#416 step
        # 6): historical fact, so later edits keep it; only the migration
        # itself sets it.
        def representation_migration(from)
          { 'representationMigration' => { 'from' => from, 'markerVersion' => 1 } }
        end

        def json_copy(value)
          JSON.parse(JSON.generate(value))
        end

        def write_envelope(payload)
          payload['namespace'] = 'com.granete.sketchup_extension'
          payload['metadataVersion'] = 1
          payload['kind'] = 'furnitureInstance'
        end

        # Tri-state placement envelope: nil (caller supplied none — a
        # layout-less rebuild keeps the previously stored box) vs a Hash
        # (the fresh authoritative layout-derived box replaces it).
        def apply_placement_envelope(payload, placement_envelope)
          case placement_envelope
          when nil
            nil
          when Hash
            payload['placementEnvelopeMm'] = placement_envelope
          else
            raise ArgumentError, 'placement_envelope debe ser nil o un Hash de envelope (min_mm/max_mm)'
          end
        end

        def furniture_intent(payload, definition, parameters, material_choices, material_choice_modes: nil)
          intent = payload['intent'].is_a?(Hash) ? payload['intent'] : {}
          intent['semanticRole'] ||= 'furniture-instance'
          intent['furnitureDefinitionId'] = definition['furniture_definition_id']
          version = definition['definition_version'] || definition['definitionVersion'] || definition['version']
          intent['definitionVersion'] = version unless version.nil?
          intent['parameters'] = parameters
          # R2: a Hash material_choices — INCLUDING the empty one — is an
          # explicit authoring statement ({} is the canonical "no material
          # choices" state and must reach the working copy as a clear). nil
          # means no statement: the key is omitted and the server value
          # survives.
          intent['materialChoices'] = material_choices if material_choices.is_a?(Hash)
          # #784 R3: explicit lineage markers ride the intent (a role
          # restore carries design). The working-copy merger turns them
          # into the full-parity statement the backend requires.
          if material_choice_modes.is_a?(Hash) && !material_choice_modes.empty?
            intent['materialChoiceModes'] = material_choice_modes
          end
          intent
        end
      end
    end
  end
end
