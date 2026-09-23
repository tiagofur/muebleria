# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Library
      # Domain placement vocabulary (backend ComponentPlacement) published by
      # the authoritative layout through each board's slotId. Display/identity
      # data only: direct-authoring rights come exclusively from the
      # #467 `authoringCapability` the engine publishes per board — the
      # resolve-time guard reads it from the fresh layout and Granete stays
      # the authority for every consequence.
      MOVABLE_INTERNAL_PLACEMENT = 'interno'

      # #467 authoring capability vocabulary: the assembly axes a movable
      # internal may be authored along. Closed set mirroring the wire schema.
      AUTHORING_AXES = %w[x y z].freeze

      # One resolved board with its authoritative local→furniture transform
      # (#414). AABB accessors are convenience/preview passthrough and may
      # be nil — orientation lives exclusively in basis/translation.
      # componentDefinitionId is the #346 stable authoring-definition ID
      # published by the server (#415): shared by every copy of one
      # component, Granete-owned, and never the host SU definition GUID.
      # catalogComponentId is the optional, separately-namespaced catalog
      # reference — the two identities never alias each other.
      class LayoutBoardTransform
        attr_reader :component_instance_id, :slot_id, :name, :authoring_capability

        def initialize(component_instance_id:, slot_id:, name:, dims:,
                       local_transform:, identity: {}, material: {}, aabb: {},
                       authoring_capability: nil)
          @component_instance_id = component_instance_id
          @slot_id = slot_id
          @name = name
          @dims = dims
          @local_transform = local_transform
          @identity = identity
          @material = material
          @aabb = aabb
          @authoring_capability = authoring_capability
        end

        # Explicit direct-authoring affordance published by the engine for
        # movable internals (#467). Nil = not directly authorable — callers
        # fail closed instead of inferring from slot/role/name.
        def movable_internal?
          @authoring_capability.is_a?(Hash) && @authoring_capability['movable'] == true
        end

        def authoring_axis
          movable_internal? ? @authoring_capability['axis'] : nil
        end

        def width_mm
          @dims['width']
        end

        def thickness_mm
          @dims['thickness']
        end

        def length_mm
          @dims['length']
        end

        def translation
          @local_transform['translation']
        end

        def basis
          @local_transform['basis']
        end

        # Canonical non-secret fingerprint of the geometry that defines
        # this board's placement: size + translation + BASIS (the full
        # #414 frame). Rotation-only changes — same ids, same sizes, same
        # translation — still change the fingerprint, so gesture guards
        # and preview derivation see exactly the same frame.
        def geometry_fingerprint
          basis = @local_transform['basis'] || {}
          axes = %w[x y z].map do |axis|
            vector = basis[axis].is_a?(Array) ? basis[axis] : [0.0, 0.0, 0.0]
            vector.map { |value| value.to_f.round(6) }.join(',')
          end
          translation = @local_transform['translation'].to_a.map { |value| value.to_f.round(3) }
          "#{@dims['width']}x#{@dims['thickness']}x#{@dims['length']}" \
            "@#{translation.join(',')}/#{axes.join(';')}"
        end

        def component_definition_id
          @identity['componentDefinitionId']
        end

        def catalog_component_id
          @identity['catalogComponentId']
        end

        def role
          @identity['role']
        end

        def option_role
          @identity['optionRole']
        end

        def aabb_min
          @aabb['min']
        end

        def aabb_size
          @aabb['size']
        end

        def material_id
          @material['materialId']
        end

        def material_code
          @material['materialCode']
        end

        def material_name
          @material['materialName']
        end

        def material_color_hex
          @material['materialColorHex']
        end

        def material_image_url
          @material['materialImageUrl']
        end

        def material_texture_url
          @material['materialTextureUrl']
        end

        def material_texture_tile_width_mm
          @material['materialTextureTileWidthMm']
        end

        def material_texture_tile_length_mm
          @material['materialTextureTileLengthMm']
        end

        def material_roughness
          @material['materialRoughness']
        end

        def material_metalness
          @material['materialMetalness']
        end

        def material_clearcoat
          @material['materialClearcoat']
        end

        def material_grain
          @material['materialGrain']
        end
      end

      # A visible hardware placement. Hardware keeps the resolved AABB shape
      # (#414 decision: the server anchors it against the final host board);
      # identity stays tied to componentInstanceId via
      # host_component_instance_id. placement_kind carries the #350
      # provenance discriminator published by the server ('manual' for
      # override-authored placements, 'derived' for placements generated by
      # part relationships/unions); a missing/unknown value parses as nil and the
      # selection context must fail closed on it — never guess 'derived'.
      class LayoutHardwarePlacement
        PLACEMENT_KINDS = %w[manual derived].freeze

        attr_reader :placement_id, :hardware_id, :asset_id, :name, :placement_kind,
                    :host_component_instance_id, :translation, :dimensions, :color_hex,
                    :anchor_face, :offset_mm,
                    :asset_revision_id, :sha256, :expected_bytes, :representation,
                    :validation_state, :local_transform,
                    :preparation_state, :mount_frame, :is_historical

        # rubocop:disable-next Metrics/ParameterLists
        def initialize(placement_id:, hardware_id: nil, asset_id: nil, name: nil,
                       placement_kind: nil, host_component_instance_id: nil, translation: nil,
                       dimensions: nil, color_hex: nil, anchor_face: nil, offset_mm: nil,
                       asset_revision_id: nil, sha256: nil, expected_bytes: nil,
                       representation: nil, validation_state: nil, local_transform: nil,
                       preparation_state: nil, mount_frame: nil, is_historical: false)
          @placement_id = placement_id
          @hardware_id = hardware_id
          @asset_id = asset_id
          @name = name
          @placement_kind = placement_kind
          @host_component_instance_id = host_component_instance_id
          @translation = translation
          @dimensions = dimensions
          @color_hex = color_hex
          @anchor_face = anchor_face
          @offset_mm = offset_mm
          @asset_revision_id = asset_revision_id
          @sha256 = sha256
          @expected_bytes = expected_bytes
          @representation = representation
          @validation_state = validation_state
          @local_transform = local_transform
          @preparation_state = preparation_state
          @mount_frame = mount_frame
          @is_historical = is_historical
        end

        def basis
          @local_transform ? @local_transform['basis'] : nil
        end

        def local_translation
          @local_transform ? @local_transform['translation'] : @translation
        end

        def historical?
          @is_historical == true
        end
      end

      # One resolved parametric assembly instance with rigid hardware members and fabricated components (#670-D).
      class LayoutAssembly
        attr_reader :assembly_instance_id, :agregado_id, :recipe_revision,
                    :snapshot_id, :is_historical, :dimensions_mm, :placement,
                    :rigid_members, :fabricated_components

        def initialize(assembly_instance_id:, agregado_id:, placement:,
                       rigid_members: [], fabricated_components: [],
                       recipe_revision: nil, snapshot_id: nil, is_historical: false,
                       dimensions_mm: nil)
          @assembly_instance_id = assembly_instance_id
          @agregado_id = agregado_id
          @placement = placement
          @rigid_members = rigid_members
          @fabricated_components = fabricated_components
          @recipe_revision = recipe_revision
          @snapshot_id = snapshot_id
          @is_historical = is_historical
          @dimensions_mm = dimensions_mm
        end

        def historical?
          @is_historical == true
        end

        def translation
          @placement['translation']
        end

        def basis
          @placement['basis']
        end
      end

      # One rigid hardware member of an assembly (#670-D). Subclasses
      # LayoutHardwarePlacement so AssetLoader and NativeHardwareRenderer consume
      # a single unified hardware placement contract authority (R1).
      class LayoutAssemblyRigidMember < LayoutHardwarePlacement
        attr_reader :member_id, :assembly_instance_id, :agregado_id, :role, :render_status,
                    :recipe_revision, :snapshot_id

        # rubocop:disable-next Metrics/ParameterLists
        def initialize(member_id:, assembly_instance_id:, agregado_id:, local_transform:,
                       name: nil, role: nil, hardware_id: nil, asset_id: nil, asset_revision_id: nil,
                       sha256: nil, expected_bytes: nil, representation: nil,
                       preparation_state: nil, mount_frame: nil, render_status: nil,
                       is_historical: false, recipe_revision: nil, snapshot_id: nil,
                       dimensions: nil, color_hex: nil, anchor_face: nil, offset_mm: nil,
                       host_component_instance_id: nil, placement_kind: 'derived')
          @member_id = member_id
          @assembly_instance_id = assembly_instance_id
          @agregado_id = agregado_id
          @role = role
          @render_status = render_status
          @recipe_revision = recipe_revision
          @snapshot_id = snapshot_id
          placement_id = "#{assembly_instance_id}:#{member_id}"
          resolved_name = name || role || member_id
          super(
            placement_id: placement_id,
            hardware_id: hardware_id,
            asset_id: asset_id,
            name: resolved_name,
            placement_kind: placement_kind,
            host_component_instance_id: host_component_instance_id,
            translation: local_transform ? local_transform['translation'] : nil,
            dimensions: dimensions,
            color_hex: color_hex,
            anchor_face: anchor_face,
            offset_mm: offset_mm,
            asset_revision_id: asset_revision_id,
            sha256: sha256,
            expected_bytes: expected_bytes,
            representation: representation,
            local_transform: local_transform,
            preparation_state: preparation_state,
            mount_frame: mount_frame,
            is_historical: is_historical
          )
        end
      end

      # One fabricated panel/board of an assembly (#670-D). Duck-types as a
      # board transform for LocalGeometry and ChildMetadataWriter.
      class LayoutAssemblyFabricatedComponent
        attr_reader :component_id, :assembly_instance_id, :agregado_id,
                    :name, :slot_id, :dims, :local_transform, :material, :identity

        def initialize(component_id:, assembly_instance_id:, agregado_id:, dims:,
                       local_transform:, name: nil, slot_id: nil, material: {}, identity: {})
          @component_id = component_id
          @assembly_instance_id = assembly_instance_id
          @agregado_id = agregado_id
          @dims = dims
          @local_transform = local_transform
          @name = name || component_id
          @slot_id = slot_id || component_id
          @material = material
          @identity = identity
        end

        def component_instance_id
          "#{@assembly_instance_id}:#{@component_id}"
        end

        def width_mm
          @dims['width']
        end

        def thickness_mm
          @dims['thickness']
        end

        def length_mm
          @dims['length']
        end

        def translation
          @local_transform['translation']
        end

        def basis
          @local_transform['basis']
        end

        # Canonical non-secret fingerprint of the geometry that defines
        # this board's placement: size + translation + BASIS (the full
        # #414 frame). Rotation-only changes — same ids, same sizes, same
        # translation — still change the fingerprint, so gesture guards
        # and preview derivation see exactly the same frame.
        def geometry_fingerprint
          basis = @local_transform['basis'] || {}
          axes = %w[x y z].map do |axis|
            vector = basis[axis].is_a?(Array) ? basis[axis] : [0.0, 0.0, 0.0]
            vector.map { |value| value.to_f.round(6) }.join(',')
          end
          translation = @local_transform['translation'].to_a.map { |value| value.to_f.round(3) }
          "#{@dims['width']}x#{@dims['thickness']}x#{@dims['length']}" \
            "@#{translation.join(',')}/#{axes.join(';')}"
        end

        def authoring_capability
          nil
        end

        def component_definition_id
          @identity['componentDefinitionId']
        end

        def catalog_component_id
          @identity['catalogComponentId']
        end

        def role
          @identity['role']
        end

        def option_role
          @identity['optionRole']
        end

        def material_id
          @material['materialId']
        end

        def material_code
          @material['materialCode']
        end

        def material_name
          @material['materialName']
        end

        def material_color_hex
          @material['materialColorHex']
        end

        def material_image_url
          @material['materialImageUrl']
        end

        def material_texture_url
          @material['materialTextureUrl']
        end

        def material_texture_tile_width_mm
          @material['materialTextureTileWidthMm']
        end

        def material_texture_tile_length_mm
          @material['materialTextureTileLengthMm']
        end

        def material_roughness
          @material['materialRoughness']
        end

        def material_metalness
          @material['materialMetalness']
        end

        def material_clearcoat
          @material['materialClearcoat']
        end

        def material_grain
          @material['materialGrain']
        end
      end

      # A parsed resolved layout: contract marker + board transforms + hardware + assemblies.
      class NativeLayout
        attr_reader :transform_contract, :boards, :hardware, :assemblies, :furniture_definition_id,
                    :definition_name, :dimensions_mm

        def initialize(transform_contract, boards, hardware = [], assemblies_pos = nil,
                       furniture_definition_id: nil, definition_name: nil, dimensions_mm: nil,
                       assemblies: nil)
          @transform_contract = transform_contract
          @boards = boards
          @hardware = hardware
          @assemblies = assemblies || assemblies_pos || []
          @furniture_definition_id = furniture_definition_id
          @definition_name = definition_name
          @dimensions_mm = dimensions_mm
        end

        def find_board(component_instance_id)
          boards.find { |board| board.component_instance_id == component_instance_id }
        end

        def find_assembly(assembly_instance_id)
          assemblies.find { |assembly| assembly.assembly_instance_id == assembly_instance_id }
        end
      end

      # Low-level coercions shared by the contract parsers: every malformed
      # input fails loudly — the extension never guesses or repairs a
      # server payload.
      module ContractCoercions
        module_function

        def numeric_triple(raw, label)
          unless raw.is_a?(Array) && raw.length == 3 && raw.all?(Numeric)
            raise LayoutContract::ContractError, "#{label} debe ser un triple numérico [x, y, z]"
          end

          values = raw.map { |v| Float(v) }
          raise LayoutContract::ContractError, "#{label} contiene valores no finitos" unless values.all?(&:finite?)

          values
        end

        def optional_triple(raw, label)
          return nil if raw.nil?

          numeric_triple(raw, label)
        end

        def positive_number(raw, label)
          unless raw.is_a?(Numeric) && Float(raw).finite? && Float(raw).positive?
            raise LayoutContract::ContractError, "#{label} debe ser un número positivo"
          end

          Float(raw)
        end

        def optional_positive_number(raw, label)
          return nil if raw.nil?

          positive_number(raw, label)
        end

        def optional_finite_number(raw, label)
          return nil if raw.nil?

          unless raw.is_a?(Numeric) && Float(raw).finite?
            raise LayoutContract::ContractError, "#{label} debe ser un número finito"
          end

          Float(raw)
        end

        def optional_boolean(raw, label)
          return nil if raw.nil?

          raise LayoutContract::ContractError, "#{label} debe ser booleano" unless [true, false].include?(raw)

          raw
        end

        # Contract IDs are opaque server-owned strings: preserve them verbatim
        # (never derive/repair them client-side), reject anything malformed.
        def optional_opaque_string(raw, label)
          return nil if raw.nil?

          unless raw.is_a?(String) && !raw.strip.empty?
            raise LayoutContract::ContractError, "#{label} debe ser un string opaco no vacío"
          end

          raw
        end

        def dot(vec_a, vec_b)
          (vec_a[0] * vec_b[0]) + (vec_a[1] * vec_b[1]) + (vec_a[2] * vec_b[2])
        end

        def cross(vec_a, vec_b)
          [(vec_a[1] * vec_b[2]) - (vec_a[2] * vec_b[1]),
           (vec_a[2] * vec_b[0]) - (vec_a[0] * vec_b[2]),
           (vec_a[0] * vec_b[1]) - (vec_a[1] * vec_b[0])]
        end
      end

      # Parsing + enforcement of the published orientation contract: unit,
      # orthogonal, right-handed (det = +1) basis. A mirrored or collapsed
      # basis would flip/collapse the board in SketchUp — reject, never repair.
      module BasisValidation
        VECTOR_TOLERANCE = 1e-4

        module_function

        def parse(raw, id)
          raise LayoutContract::ContractError, "Componente #{id}: falta localTransform.basis" unless raw.is_a?(Hash)

          basis = {
            'x' => ContractCoercions.numeric_triple(raw['x'], "basis.x de #{id}"),
            'y' => ContractCoercions.numeric_triple(raw['y'], "basis.y de #{id}"),
            'z' => ContractCoercions.numeric_triple(raw['z'], "basis.z de #{id}")
          }
          validate!(basis, id)
          basis
        end

        def validate!(basis, id)
          basis.each do |axis, v|
            norm = Math.sqrt(ContractCoercions.dot(v, v))
            next if (norm - 1.0).abs <= VECTOR_TOLERANCE

            raise LayoutContract::ContractError, "Componente #{id}: basis.#{axis} no es unitario (|v|=#{norm})"
          end
          %w[x y z].each do |a|
            %w[x y z].each do |b|
              next if a >= b

              d = ContractCoercions.dot(basis[a], basis[b])
              next if d.abs <= VECTOR_TOLERANCE

              raise LayoutContract::ContractError,
                    "Componente #{id}: basis.#{a}·basis.#{b} = #{d}, no es ortonormal"
            end
          end
          det = ContractCoercions.dot(basis['x'], ContractCoercions.cross(basis['y'], basis['z']))
          return if (det - 1.0).abs <= VECTOR_TOLERANCE

          raise LayoutContract::ContractError,
                "Componente #{id}: base no es diestra (det=#{det}); un espejo nunca se aplica"
        end
      end

      # Hardware parsing of the resolved layout (#414 decision): hardware
      # keeps the server-resolved AABB placement — already anchored against
      # the final host board — so the renderer applies a plain translation,
      # never an orientation guess.
      module HardwareContractParsing
        module_function

        def parse(raw)
          return [] if raw.nil?
          raise LayoutContract::ContractError, 'hardware debe ser una lista' unless raw.is_a?(Array)

          raw.map { |entry| parse_placement(entry) }
        end

        # rubocop:disable-next Metrics/AbcSize, Metrics/MethodLength
        def parse_placement(raw)
          raise LayoutContract::ContractError, 'Herraje de composición inválido' unless raw.is_a?(Hash)

          placement_id = ContractCoercions.optional_opaque_string(raw['placementId'], 'placementId de herraje')
          raise LayoutContract::ContractError, 'Herraje sin placementId' if placement_id.nil?

          placement_kind = ContractCoercions.optional_opaque_string(
            raw['placementKind'], "placementKind de #{placement_id}"
          )
          if placement_kind && !LayoutHardwarePlacement::PLACEMENT_KINDS.include?(placement_kind)
            raise LayoutContract::ContractError,
                  "placementKind de #{placement_id} debe ser manual o derived " \
                  '(procedencia #350); el cliente nunca adivina la procedencia'
          end

          anchor_face = ContractCoercions.optional_opaque_string(raw['anchorFace'],
                                                                 "anchorFace de #{placement_id}")
          offset_mm = if raw['offsetMm'].is_a?(Array)
                        raw['offsetMm'].map(&:to_f)
                      elsif raw['offsetMm'].is_a?(Numeric)
                        raw['offsetMm'].to_f
                      end

          local_transform = if raw['localTransform'].is_a?(Hash)
                              {
                                'translation' => ContractCoercions.numeric_triple(
                                  raw.dig('localTransform', 'translationMm'),
                                  "translationMm de localTransform de herraje #{placement_id}"
                                ),
                                'basis' => BasisValidation.parse(raw.dig('localTransform', 'basis'), placement_id)
                              }
                            end

          preparation_state = ContractCoercions.optional_opaque_string(
            raw['preparationState'], "preparationState de #{placement_id}"
          )
          mount_frame = parse_mount_frame(raw['mountFrame'], placement_id)
          if preparation_state == 'prepared' && mount_frame.nil?
            raise LayoutContract::ContractError, "Herraje #{placement_id} marcado como prepared sin mountFrame"
          end

          LayoutHardwarePlacement.new(
            placement_id: placement_id,
            hardware_id: ContractCoercions.optional_opaque_string(raw['hardwareId'],
                                                                  "hardwareId de #{placement_id}"),
            asset_id: ContractCoercions.optional_opaque_string(raw['assetId'],
                                                               "assetId de #{placement_id}"),
            asset_revision_id: ContractCoercions.optional_opaque_string(raw['assetRevisionId'],
                                                                        "assetRevisionId de #{placement_id}"),
            sha256: ContractCoercions.optional_opaque_string(raw['sha256'],
                                                             "sha256 de #{placement_id}"),
            expected_bytes: ContractCoercions.optional_finite_number(raw['expectedBytes'],
                                                                     "expectedBytes de #{placement_id}")&.to_i,
            representation: ContractCoercions.optional_opaque_string(raw['representation'],
                                                                     "representation de #{placement_id}"),
            validation_state: ContractCoercions.optional_opaque_string(raw['validationState'],
                                                                       "validationState de #{placement_id}"),
            local_transform: local_transform,
            name: ContractCoercions.optional_opaque_string(raw['name'], "name de #{placement_id}"),
            placement_kind: placement_kind,
            host_component_instance_id: ContractCoercions.optional_opaque_string(
              raw['hostComponentInstanceId'], "hostComponentInstanceId de #{placement_id}"
            ),
            translation: ContractCoercions.optional_triple(raw.dig('transform', 'translationMm'),
                                                           "translationMm de #{placement_id}"),
            dimensions: ContractCoercions.optional_triple(raw['dimensionsMm'],
                                                          "dimensionsMm de #{placement_id}"),
            color_hex: ContractCoercions.optional_opaque_string(raw['colorHex'],
                                                                "colorHex de #{placement_id}"),
            anchor_face: anchor_face,
            offset_mm: offset_mm,
            preparation_state: preparation_state,
            mount_frame: mount_frame
          )
        end

        def parse_mount_frame(raw, placement_id)
          return nil if raw.nil?

          raise LayoutContract::ContractError, "mountFrame de #{placement_id} no es un Hash" unless raw.is_a?(Hash)

          origin_mm = ContractCoercions.numeric_triple(raw['originMm'], "originMm de mountFrame de #{placement_id}")
          raw_basis = raw['basis']
          unless raw_basis.is_a?(Hash)
            msg = "basis de mountFrame de #{placement_id} no es un Hash"
            raise LayoutContract::ContractError, msg
          end

          basis_x = ContractCoercions.numeric_triple(raw_basis['x'], "basis.x de mountFrame de #{placement_id}")
          basis_y = ContractCoercions.numeric_triple(raw_basis['y'], "basis.y de mountFrame de #{placement_id}")
          basis_z = ContractCoercions.numeric_triple(raw_basis['z'], "basis.z de mountFrame de #{placement_id}")

          basis = Assets::MountFrame::BasisData.new(x: basis_x, y: basis_y, z: basis_z)
          begin
            Assets::MountFrame.validate_basis!(basis, "mountFrame.basis de #{placement_id}")
          rescue ArgumentError => e
            raise LayoutContract::ContractError, e.message
          end

          Assets::MountFrame::MountFrameData.new(origin_mm: origin_mm, basis: basis)
        end
      end

      # Assembly parsing of the resolved layout (#670-D).
      # SketchUp receives pre-resolved assemblies with rigid members and
      # fabricated components, materializing them without evaluating rules or variants.
      module AssemblyContractParsing # rubocop:disable Metrics/ModuleLength
        module_function

        def parse(raw)
          return [] if raw.nil?
          raise LayoutContract::ContractError, 'assemblies debe ser una lista' unless raw.is_a?(Array)

          raw.map { |entry| parse_assembly(entry) }
        end

        # rubocop:disable-next Metrics/AbcSize
        def parse_assembly(raw)
          raise LayoutContract::ContractError, 'Assembly de composición inválido' unless raw.is_a?(Hash)

          inst_id = ContractCoercions.optional_opaque_string(raw['assemblyInstanceId'],
                                                             'assemblyInstanceId de assembly')
          raise LayoutContract::ContractError, 'Assembly sin assemblyInstanceId' if inst_id.nil?

          agr_id = ContractCoercions.optional_opaque_string(raw['agregadoId'], "agregadoId de assembly #{inst_id}")
          raise LayoutContract::ContractError, "Assembly #{inst_id} sin agregadoId" if agr_id.nil?

          is_hist = raw['isHistorical'] == true
          recipe_rev = parse_recipe_revision(raw, inst_id)
          snapshot_id = ContractCoercions.optional_opaque_string(raw['snapshotId'], "snapshotId de #{inst_id}")

          if is_hist
            if recipe_rev.nil? || recipe_rev <= 0
              raise LayoutContract::ContractError,
                    "Assembly histórico #{inst_id} requiere recipeRevision > 0 (obtenido: #{recipe_rev.inspect})"
            end
            if snapshot_id.nil?
              raise LayoutContract::ContractError,
                    "Assembly histórico #{inst_id} requiere snapshotId no vacío"
            end
          end

          placement = parse_placement(raw['placement'] || raw['localTransform'] || raw['transform'], inst_id)
          dims = ContractCoercions.optional_triple(
            raw['dimensionsMm'] || raw['resolvedDimensionsMm'], "dimensionsMm de #{inst_id}"
          )

          rigid_members = parse_rigid_members_list(raw['rigidMembers'], inst_id, agr_id, is_hist,
                                                   recipe_revision: recipe_rev, snapshot_id: snapshot_id)
          fabricated_components = parse_fabricated_components_list(raw['fabricatedComponents'], inst_id, agr_id)

          if rigid_members.empty? && fabricated_components.empty?
            raise LayoutContract::ContractError, "Assembly #{inst_id} no contiene miembros ni piezas fabricadas"
          end

          LayoutAssembly.new(
            assembly_instance_id: inst_id,
            agregado_id: agr_id,
            placement: placement,
            rigid_members: rigid_members,
            fabricated_components: fabricated_components,
            recipe_revision: recipe_rev,
            snapshot_id: snapshot_id,
            is_historical: is_hist,
            dimensions_mm: dims
          )
        end

        def parse_recipe_revision(raw, inst_id)
          ContractCoercions.optional_positive_number(
            raw['recipeRevision'] || raw['agregadoRevisionNumber'], "recipeRevision de #{inst_id}"
          )&.to_i
        end

        def parse_rigid_members_list(raw_list, inst_id, agr_id, is_hist, recipe_revision: nil, snapshot_id: nil)
          return [] if raw_list.nil?

          unless raw_list.is_a?(Array)
            raise LayoutContract::ContractError, "rigidMembers de #{inst_id} debe ser una lista"
          end

          raw_list.map do |m|
            parse_rigid_member(m, inst_id, agr_id, is_hist,
                               recipe_revision: recipe_revision, snapshot_id: snapshot_id)
          end
        end

        def parse_fabricated_components_list(raw_list, inst_id, agr_id)
          return [] if raw_list.nil?

          unless raw_list.is_a?(Array)
            raise LayoutContract::ContractError, "fabricatedComponents de #{inst_id} debe ser una lista"
          end

          raw_list.map { |c| parse_fabricated_component(c, inst_id, agr_id) }
        end

        def parse_placement(raw, id)
          raise LayoutContract::ContractError, "Falta placement en assembly #{id}" unless raw.is_a?(Hash)

          trans = ContractCoercions.numeric_triple(
            raw['translationMm'] || raw['translation'], "translationMm de placement de assembly #{id}"
          )
          basis = BasisValidation.parse(raw['basis'], "placement de assembly #{id}")
          { 'translation' => trans, 'basis' => basis }
        end

        def validate_member_historical_consistency(raw, member_id, assembly_instance_id,
                                                   is_historical, recipe_revision, snapshot_id)
          placement_id = "#{assembly_instance_id}:#{member_id}"
          validate_member_historical_flag(raw, member_id, assembly_instance_id, is_historical)
          validate_member_recipe_revision(raw, member_id, assembly_instance_id, placement_id, recipe_revision)
          validate_member_snapshot_id(raw, member_id, assembly_instance_id, placement_id, snapshot_id)
        end

        def validate_member_historical_flag(raw, member_id, assembly_instance_id, is_historical)
          return unless raw.key?('isHistorical')

          member_is_hist = raw['isHistorical'] == true
          return if member_is_hist == is_historical

          raise LayoutContract::ContractError,
                "Miembro #{member_id} de #{assembly_instance_id} contradice isHistorical del assembly padre " \
                "(member=#{member_is_hist}, assembly=#{is_historical})"
        end

        def validate_member_recipe_revision(raw, member_id, assembly_instance_id, placement_id, recipe_revision)
          return unless raw.key?('recipeRevision') || raw.key?('agregadoRevisionNumber')

          member_recipe_rev = parse_recipe_revision(raw, placement_id)
          return if member_recipe_rev == recipe_revision

          raise LayoutContract::ContractError,
                "Miembro #{member_id} de #{assembly_instance_id} contradice recipeRevision del assembly padre " \
                "(member=#{member_recipe_rev.inspect}, assembly=#{recipe_revision.inspect})"
        end

        def validate_member_snapshot_id(raw, member_id, assembly_instance_id, placement_id, snapshot_id)
          return unless raw.key?('snapshotId')

          member_snapshot_id = ContractCoercions.optional_opaque_string(raw['snapshotId'],
                                                                        "snapshotId de #{placement_id}")
          return if member_snapshot_id == snapshot_id

          raise LayoutContract::ContractError,
                "Miembro #{member_id} de #{assembly_instance_id} contradice snapshotId del assembly padre " \
                "(member=#{member_snapshot_id.inspect}, assembly=#{snapshot_id.inspect})"
        end

        # rubocop:disable-next Metrics/AbcSize, Metrics/MethodLength
        def parse_rigid_member(raw, assembly_instance_id, agregado_id, is_historical,
                               recipe_revision: nil, snapshot_id: nil)
          unless raw.is_a?(Hash)
            raise LayoutContract::ContractError, "Miembro rígido inválido en assembly #{assembly_instance_id}"
          end

          member_id = ContractCoercions.optional_opaque_string(raw['memberId'], "memberId en #{assembly_instance_id}")
          if member_id.nil?
            raise LayoutContract::ContractError, "Miembro rígido sin memberId en #{assembly_instance_id}"
          end

          validate_member_historical_consistency(raw, member_id, assembly_instance_id,
                                                 is_historical, recipe_revision, snapshot_id)

          placement_id = "#{assembly_instance_id}:#{member_id}"
          lt_raw = raw['localTransform'] || raw['transform']
          unless lt_raw.is_a?(Hash)
            raise LayoutContract::ContractError,
                  "Falta localTransform en miembro #{member_id} de #{assembly_instance_id}"
          end

          trans = ContractCoercions.numeric_triple(
            lt_raw['translationMm'] || lt_raw['translation'], "translationMm de #{placement_id}"
          )
          basis = BasisValidation.parse(lt_raw['basis'], placement_id)
          local_transform = { 'translation' => trans, 'basis' => basis }

          prep_state = ContractCoercions.optional_opaque_string(
            raw['preparationState'], "preparationState de #{placement_id}"
          )
          mount_frame = HardwareContractParsing.parse_mount_frame(raw['mountFrame'], placement_id)
          if prep_state == 'prepared' && mount_frame.nil?
            raise LayoutContract::ContractError,
                  "Miembro #{member_id} de #{assembly_instance_id} marcado como prepared sin mountFrame"
          end

          LayoutAssemblyRigidMember.new(
            member_id: member_id,
            assembly_instance_id: assembly_instance_id,
            agregado_id: agregado_id,
            local_transform: local_transform,
            name: ContractCoercions.optional_opaque_string(raw['name'], "name de #{placement_id}"),
            role: ContractCoercions.optional_opaque_string(raw['role'], "role de #{placement_id}"),
            hardware_id: ContractCoercions.optional_opaque_string(raw['hardwareId'], "hardwareId de #{placement_id}"),
            asset_id: ContractCoercions.optional_opaque_string(raw['assetId'], "assetId de #{placement_id}"),
            asset_revision_id: ContractCoercions.optional_opaque_string(raw['assetRevisionId'],
                                                                        "assetRevisionId de #{placement_id}"),
            sha256: ContractCoercions.optional_opaque_string(raw['sha256'], "sha256 de #{placement_id}"),
            expected_bytes: ContractCoercions.optional_finite_number(raw['expectedBytes'],
                                                                     "expectedBytes de #{placement_id}")&.to_i,
            representation: ContractCoercions.optional_opaque_string(raw['representation'],
                                                                     "representation de #{placement_id}"),
            preparation_state: prep_state,
            mount_frame: mount_frame,
            render_status: ContractCoercions.optional_opaque_string(raw['renderStatus'],
                                                                    "renderStatus de #{placement_id}"),
            is_historical: is_historical,
            recipe_revision: recipe_revision,
            snapshot_id: snapshot_id,
            dimensions: ContractCoercions.optional_triple(raw['dimensionsMm'], "dimensionsMm de #{placement_id}"),
            color_hex: ContractCoercions.optional_opaque_string(raw['colorHex'], "colorHex de #{placement_id}"),
            anchor_face: ContractCoercions.optional_opaque_string(raw['anchorFace'], "anchorFace de #{placement_id}"),
            offset_mm: raw['offsetMm']&.to_f
          )
        end

        def parse_fabricated_component(raw, assembly_instance_id, agregado_id)
          unless raw.is_a?(Hash)
            raise LayoutContract::ContractError, "Pieza fabricada inválida en assembly #{assembly_instance_id}"
          end

          component_id = ContractCoercions.optional_opaque_string(raw['componentId'],
                                                                  "componentId en #{assembly_instance_id}")
          if component_id.nil?
            raise LayoutContract::ContractError, "Pieza fabricada sin componentId en #{assembly_instance_id}"
          end

          comp_uid = "#{assembly_instance_id}:#{component_id}"
          ct_raw = raw['localTransform'] || raw['transform']
          unless ct_raw.is_a?(Hash)
            raise LayoutContract::ContractError, "Falta transform en pieza #{component_id} de #{assembly_instance_id}"
          end

          trans = ContractCoercions.numeric_triple(
            ct_raw['translationMm'] || ct_raw['translation'], "translationMm de #{comp_uid}"
          )
          basis = BasisValidation.parse(ct_raw['basis'], comp_uid)
          local_transform = { 'translation' => trans, 'basis' => basis }

          dims = {
            'width' => ContractCoercions.positive_number(raw['widthMm'] || raw['width'], "widthMm de #{comp_uid}"),
            'thickness' => ContractCoercions.positive_number(raw['thicknessMm'] || raw['thickness'],
                                                             "thicknessMm de #{comp_uid}"),
            'length' => ContractCoercions.positive_number(raw['lengthMm'] || raw['length'],
                                                          "lengthMm de #{comp_uid}")
          }

          material = LayoutContract.parse_material_fields(raw, comp_uid)
          identity = LayoutContract.parse_identity_fields(raw, comp_uid)

          LayoutAssemblyFabricatedComponent.new(
            component_id: component_id,
            assembly_instance_id: assembly_instance_id,
            agregado_id: agregado_id,
            dims: dims,
            local_transform: local_transform,
            name: ContractCoercions.optional_opaque_string(raw['name'], "name de #{comp_uid}"),
            slot_id: ContractCoercions.optional_opaque_string(raw['slotId'], "slotId de #{comp_uid}"),
            material: material,
            identity: identity
          )
        end
      end

      # Parser of the authoritative board-local transform contract (#414 /
      # ADR-0004 §9). The resolved layout publishes, per board:
      #
      #   transformContract: 'granete.local-basis.v1'
      #   components[].localTransform = { translationMm, basis: { x, y, z } }
      #   components[].widthMm/thicknessMm/lengthMm (local box extents:
      #     local X = width, local Y = thickness, local Z = length)
      #
      # with furniture_point = translationMm + basis · local_point for the
      # local box [0,width]×[0,thickness]×[0,length]. The basis is
      # orthonormal and right-handed in the furniture (workshop) frame, so
      # applying it is a pure rigid placement — never a mirror. This parser
      # NEVER derives orientation from slotId, role, name or AABB shape
      # (those cannot recover orientation; see the negative-proof tests) and
      # has NO fallback path: a missing/unknown transform contract or a
      # malformed basis fails loudly so clients never place pieces on a guess.
      module LayoutContract
        SUPPORTED_TRANSFORM_CONTRACT = 'granete.local-basis.v1'
        IDENTITY_KEYS = %w[componentDefinitionId catalogComponentId role optionRole].freeze
        MATERIAL_STRING_KEYS = %w[materialId materialCode materialName materialColorHex
                                  materialImageUrl materialTextureUrl].freeze

        class ContractError < LayoutResolutionError; end

        module_function

        # Parses and validates a resolved layout body. Raises ContractError
        # (a LayoutResolutionError) on any contract violation.
        def parse!(body)
          raise ContractError, 'Respuesta de composición inválida del servidor' unless body.is_a?(Hash)

          contract = body['transformContract']
          unless contract == SUPPORTED_TRANSFORM_CONTRACT
            raise ContractError,
                  "Contrato de transform no soportado: #{contract.inspect} " \
                  "(esta extensión entiende #{SUPPORTED_TRANSFORM_CONTRACT}). " \
                  'Actualizá la extensión; la orientación no se infiere desde slot/AABB.'
          end

          components = body['components']
          unless components.is_a?(Array) && !components.empty?
            raise ContractError, 'La composición resuelta no trae componentes'
          end

          NativeLayout.new(contract,
                           components.map { |raw| parse_board(raw) },
                           HardwareContractParsing.parse(body['hardware']),
                           AssemblyContractParsing.parse(body['assemblies']),
                           furniture_definition_id: ContractCoercions.optional_opaque_string(
                             body['furnitureDefinitionId'], 'furnitureDefinitionId'
                           ),
                           definition_name: ContractCoercions.optional_opaque_string(
                             body['definitionName'], 'definitionName'
                           ),
                           dimensions_mm: ContractCoercions.optional_triple(
                             body['dimensionsMm'], 'dimensionsMm'
                           ))
        end

        def parse_board(raw)
          raise ContractError, 'Componente de composición inválido' unless raw.is_a?(Hash)

          id = raw['componentInstanceId']
          raise ContractError, 'Componente sin componentInstanceId' unless id.is_a?(String) && !id.empty?

          local = raw['localTransform']
          unless local.is_a?(Hash)
            raise ContractError,
                  "Componente #{id}: falta localTransform (contrato #{SUPPORTED_TRANSFORM_CONTRACT})"
          end

          LayoutBoardTransform.new(
            component_instance_id: id,
            slot_id: ContractCoercions.optional_opaque_string(raw['slotId'], "slotId de #{id}"),
            name: raw['name'],
            dims: {
              'width' => ContractCoercions.positive_number(raw['widthMm'], "widthMm de #{id}"),
              'thickness' => ContractCoercions.positive_number(raw['thicknessMm'], "thicknessMm de #{id}"),
              'length' => ContractCoercions.positive_number(raw['lengthMm'], "lengthMm de #{id}")
            },
            local_transform: {
              'translation' => ContractCoercions.numeric_triple(local['translationMm'],
                                                                "translationMm de #{id}"),
              'basis' => BasisValidation.parse(local['basis'], id)
            },
            identity: parse_identity_fields(raw, id),
            material: parse_material_fields(raw, id),
            aabb: parse_aabb_fields(raw, id),
            authoring_capability: parse_authoring_capability(raw['authoringCapability'], id)
          )
        end

        # #467: closed-shape authoring capability published by the engine.
        # Anything malformed fails closed (contract error) — the plugin never
        # repairs or infers authoring rights.
        def parse_authoring_capability(raw, id)
          return nil if raw.nil?

          unless raw.is_a?(Hash) && raw.keys.sort == %w[axis movable] &&
                 raw['movable'] == true && AUTHORING_AXES.include?(raw['axis'])
            raise ContractError,
                  "authoringCapability de #{id} inválida (se espera {movable: true, axis: x|y|z})"
          end

          { 'movable' => true, 'axis' => raw['axis'] }
        end

        def parse_identity_fields(raw, id)
          IDENTITY_KEYS.to_h do |key|
            [key, ContractCoercions.optional_opaque_string(raw[key], "#{key} de #{id}")]
          end
        end

        def parse_material_fields(raw, id)
          material = MATERIAL_STRING_KEYS.to_h do |key|
            [key, ContractCoercions.optional_opaque_string(raw[key], "#{key} de #{id}")]
          end
          material['materialTextureTileWidthMm'] = ContractCoercions.optional_positive_number(
            raw['materialTextureTileWidthMm'], "materialTextureTileWidthMm de #{id}"
          )
          material['materialTextureTileLengthMm'] = ContractCoercions.optional_positive_number(
            raw['materialTextureTileLengthMm'], "materialTextureTileLengthMm de #{id}"
          )
          %w[materialRoughness materialMetalness materialClearcoat].each do |key|
            material[key] = ContractCoercions.optional_finite_number(raw[key], "#{key} de #{id}")
          end
          material['materialGrain'] = ContractCoercions.optional_boolean(raw['materialGrain'],
                                                                         "materialGrain de #{id}")
          material
        end

        def parse_aabb_fields(raw, id)
          {
            'min' => ContractCoercions.optional_triple(raw.dig('transform', 'translationMm'),
                                                       "AABB min de #{id}"),
            'size' => ContractCoercions.optional_triple(raw['dimensionsMm'], "AABB size de #{id}")
          }
        end
      end
    end
  end
end
