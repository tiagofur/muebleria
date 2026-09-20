# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Assets
      # Deterministic SKP -> GLB writer for the #669 assisted web representation.
      #
      # Writes a self-contained glTF 2.0 GLB of ONE component definition in the
      # canonical Granete convention:
      #
      #   asset space (definition coordinates, mm Z-up)
      #     -> glb space: metres, +Y up
      #        glbX = assetX / 1000
      #        glbY = assetZ / 1000
      #        glbZ = -assetY / 1000
      #
      # This is the ONLY unit/axis conversion on the GLB boundary. The MountFrame
      # keeps living in asset space (mm Z-up); the web applies inverse(mountFrame)
      # after mapping GLB vertices back to asset mm, exactly like SketchUp does.
      # The inverse map (glb -> asset mm) is: assetX = glbX*1000,
      # assetY = -glbZ*1000, assetZ = glbY*1000 (mirrored by the domain reader).
      #
      # Determinism: face/material iteration follows entities order, JSON keys
      # are emitted in fixed insertion order and no timestamps are written, so
      # exporting the same definition twice yields byte-identical GLB files
      # (required so committed parity fixtures stay reproducible).
      module GlbWriter # rubocop:disable Metrics/ModuleLength
        EXPORTER_NAME = 'granete-sketchup-glb-exporter'
        EXPORTER_VERSION = '1.0.0'
        INCHES_TO_METRES = 0.0254 # SketchUp Ruby lengths are inches; asset mm * 0.001 = metres

        class WriterError < StandardError; end

        # definition: Sketchup::ComponentDefinition whose entities are exported
        # (definition space only; never the active project).
        # path: destination .glb path.
        # Returns a summary hash with counts used by evidence/diagnostics.
        def self.write_definition_to_glb(definition, path)
          unless definition.is_a?(Sketchup::ComponentDefinition)
            raise WriterError, 'definition must be a Sketchup::ComponentDefinition'
          end

          faces = definition.entities.grep(Sketchup::Face)
          raise WriterError, 'definition has no faces to export' if faces.empty?

          groups = collect_material_groups(faces)
          document = assemble_document(definition.name, groups)
          bytes = serialize_container(document[:json], document[:binary])
          File.binwrite(path, bytes)

          triangles = groups.sum { |group| group[:indices].length / 3 }
          vertices = groups.sum { |group| group[:positions].length / 3 }
          {
            'exporter' => EXPORTER_NAME,
            'exporterVersion' => EXPORTER_VERSION,
            'faces' => faces.length,
            'triangles' => triangles,
            'vertices' => vertices,
            'byteLength' => bytes.length
          }
        end

        # Map GLB-space metres back to asset-space mm (mirror of the writer
        # convention; used by tests/evidence to measure exported bytes).
        def self.glb_point_to_asset_mm(point)
          [point[0] * 1000.0, -point[2] * 1000.0, point[1] * 1000.0]
        end

        # Read every POSITION vertex (GLB-space metres, flat triples) from a GLB
        # file. Structural mirror of the domain/TS reader: magic, version 2,
        # chunks, embedded buffer, VEC3/FLOAT accessors. Used by the assisted
        # export to self-check the produced file before upload and by tests to
        # measure committed/exported bytes against contract constants.
        def self.read_positions(path)
          json, bin = parse_container(File.binread(path))
          positions = []
          json['meshes'].each do |mesh|
            mesh['primitives'].each do |primitive|
              accessor_index = primitive.dig('attributes', 'POSITION')
              next if accessor_index.nil?

              positions.concat(read_vec3_accessor(json, bin, accessor_index))
            end
          end
          raise WriterError, 'GLB exposes no POSITION vertices' if positions.empty?

          positions
        end

        def self.parse_container(bytes)
          raise WriterError, 'GLB too short' if bytes.bytesize < 20

          magic, version, total = bytes[0, 12].unpack('VVV')
          raise WriterError, 'invalid GLB magic' unless magic == 0x46546C67
          raise WriterError, "unsupported GLB version #{version}" unless version == 2
          raise WriterError, 'GLB length mismatch' unless total == bytes.bytesize

          json_text, bin = split_chunks(bytes)
          raise WriterError, 'GLB missing JSON chunk' if json_text.nil?
          raise WriterError, 'GLB missing BIN chunk' if bin.nil?

          begin
            json = JSON.parse(json_text)
          rescue JSON::ParserError => e
            raise WriterError, "GLB JSON chunk is not valid JSON: #{e.message}"
          end
          raise WriterError, 'buffer.uri is forbidden' unless json.dig('buffers', 0, 'uri').to_s.empty?

          [json, bin]
        end
        private_class_method :parse_container

        def self.split_chunks(bytes)
          json_text = nil
          bin = nil
          offset = 12
          while offset < bytes.bytesize
            chunk_length, chunk_type = bytes[offset, 8].unpack('VV')
            data_start = offset + 8
            raise WriterError, 'truncated GLB chunk' if data_start + chunk_length > bytes.bytesize

            if chunk_type == 0x4E4F534A && json_text.nil?
              json_text = bytes[data_start, chunk_length].force_encoding(Encoding::UTF_8)
            elsif chunk_type == 0x004E4942 && bin.nil?
              bin = bytes[data_start, chunk_length]
            end
            offset = data_start + chunk_length
          end
          [json_text, bin]
        end
        private_class_method :split_chunks

        def self.read_vec3_accessor(json, bin, accessor_index)
          accessor = json['accessors'][accessor_index]
          raise WriterError, "accessor #{accessor_index} not found" if accessor.nil?
          unless accessor['type'] == 'VEC3' && accessor['componentType'] == 5126
            raise WriterError,
                  'accessor must be VEC3/FLOAT'
          end

          view = json['bufferViews'][accessor['bufferView']]
          view_offset = view['byteOffset'] || 0
          byte_start = view_offset + (accessor['byteOffset'] || 0)
          count = accessor['count']
          byte_end = byte_start + (count * 12)
          if byte_end > view_offset + view['byteLength'] || byte_end > bin.bytesize
            raise WriterError,
                  'accessor range exceeds bufferView'
          end

          bin[byte_start, count * 12].unpack('e*').each_slice(3).to_a
        end
        private_class_method :read_vec3_accessor

        def self.collect_material_groups(faces)
          groups = []
          index_by_key = {}
          faces.each do |face|
            material = face.material
            key = material&.name
            index = index_by_key[key]
            if index.nil?
              index = groups.length
              index_by_key[key] = index
              group = { material: material, positions: [], indices: [], vertex_index: {} }
              groups.push(group)
            end
            append_face_triangles(groups[index], face)
          end
          groups
        end
        private_class_method :collect_material_groups

        # Triangulate each face through SketchUp's mesh (handles polygons with
        # holes). Host contract (probed on SketchUp 2026.2): PolygonMesh#polygons
        # returns 0-based polygon rows whose point indices are 1-based and MAY
        # be negative (hidden edges) — abs then -1 indexes the points array.
        def self.append_face_triangles(group, face)
          mesh = face.mesh
          face_points = mesh.points
          mesh.polygons.each do |polygon|
            points = polygon.map { |index| face_points[index.abs - 1] }
            raise WriterError, 'non-triangular polygon from face mesh' unless points.length == 3

            points.each do |point|
              key = [point.x, point.z, -point.y].pack('e3')
              index = group[:vertex_index][key]
              if index.nil?
                index = group[:positions].length / 3
                group[:vertex_index][key] = index
                glb = vertex_to_glb(point)
                group[:positions].push(glb[0], glb[1], glb[2])
              end
              group[:indices].push(index)
            end
          end
        end
        private_class_method :append_face_triangles

        def self.vertex_to_glb(point)
          [
            to_float32(point.x * INCHES_TO_METRES),
            to_float32(point.z * INCHES_TO_METRES),
            to_float32(-point.y * INCHES_TO_METRES)
          ]
        end
        private_class_method :vertex_to_glb

        def self.to_float32(value)
          [value].pack('e').unpack1('e')
        end
        private_class_method :to_float32

        def self.assemble_document(definition_name, groups)
          binary = String.new(capacity: 4096)
          buffer_views = []
          accessors = []
          materials = []
          primitives = groups.map do |group|
            build_primitive(group, binary, buffer_views, accessors, materials)
          end

          json = {
            'asset' => {
              'version' => '2.0',
              'generator' => "#{EXPORTER_NAME} #{EXPORTER_VERSION}"
            },
            'scene' => 0,
            'scenes' => [{ 'name' => 'granete-asset', 'nodes' => [0] }],
            'nodes' => [{ 'mesh' => 0, 'name' => definition_name }],
            'meshes' => [{ 'primitives' => primitives }],
            'materials' => materials,
            'accessors' => accessors,
            'bufferViews' => buffer_views,
            'buffers' => [{ 'byteLength' => binary.length }]
          }
          { json: json, binary: binary }
        end
        private_class_method :assemble_document

        def self.build_primitive(group, binary, buffer_views, accessors, materials)
          position_view = append_buffer_view(buffer_views, binary, group[:positions].pack('e*'))
          index_view = append_buffer_view(buffer_views, binary, group[:indices].pack('V*'))

          minmax = position_minmax(group[:positions])
          accessors.push(
            'bufferView' => position_view,
            'componentType' => 5126,
            'count' => group[:positions].length / 3,
            'type' => 'VEC3',
            'min' => minmax[0],
            'max' => minmax[1]
          )
          position_accessor_index = accessors.length - 1
          accessors.push(
            'bufferView' => index_view,
            'componentType' => 5125,
            'count' => group[:indices].length,
            'type' => 'SCALAR'
          )
          index_accessor_index = accessors.length - 1

          {
            'attributes' => { 'POSITION' => position_accessor_index },
            'indices' => index_accessor_index,
            'material' => append_material(materials, group[:material])
          }
        end
        private_class_method :build_primitive

        def self.append_buffer_view(buffer_views, binary, packed)
          offset = align4(binary.length)
          binary << ("\0" * (offset - binary.length)) if offset > binary.length
          buffer_views.push('buffer' => 0, 'byteOffset' => offset, 'byteLength' => packed.bytesize)
          binary << packed
          pad4(binary)
          buffer_views.length - 1
        end
        private_class_method :append_buffer_view

        def self.align4(length)
          (length + 3) / 4 * 4
        end
        private_class_method :align4

        def self.pad4(binary)
          padding = align4(binary.length) - binary.length
          binary << ("\0" * padding) if padding.positive?
        end
        private_class_method :pad4

        def self.position_minmax(flat_positions)
          xs = []
          ys = []
          zs = []
          (0...(flat_positions.length / 3)).each do |vertex_index|
            base = vertex_index * 3
            xs.push(flat_positions[base])
            ys.push(flat_positions[base + 1])
            zs.push(flat_positions[base + 2])
          end
          [[xs.min, ys.min, zs.min], [xs.max, ys.max, zs.max]]
        end
        private_class_method :position_minmax

        def self.append_material(materials, material)
          base_color = if material.nil?
                         [0.8, 0.8, 0.8]
                       else
                         color = material.color
                         [color.red / 255.0, color.green / 255.0, color.blue / 255.0]
                       end
          alpha = !material.nil? && material.respond_to?(:alpha) && material.alpha ? material.alpha : 1.0
          materials.push(
            'name' => material.nil? ? 'granete-default' : (material.name || 'granete-material'),
            'pbrMetallicRoughness' => {
              'baseColorFactor' => base_color.map { |channel| round4(channel) } + [round4(alpha)],
              'metallicFactor' => 0.0,
              'roughnessFactor' => 0.6
            }
          )
          materials.length - 1
        end
        private_class_method :append_material

        def self.round4(value)
          (value * 10_000.0).round / 10_000.0
        end
        private_class_method :round4

        def self.serialize_container(json, binary)
          json_text = JSON.generate(json)
          json_padded = json_text + (' ' * ((4 - (json_text.bytesize % 4)) % 4))
          binary_padded = binary + ("\0" * ((4 - (binary.bytesize % 4)) % 4))

          total = 12 + 8 + json_padded.bytesize + 8 + binary_padded.bytesize
          container = [0x46546C67, 2, total].pack('VVV')
          container << [json_padded.bytesize, 0x4E4F534A].pack('VV')
          container << json_padded
          container << [binary_padded.bytesize, 0x004E4942].pack('VV')
          container << binary_padded
          container
        end
        private_class_method :serialize_container
      end
    end
  end
end
