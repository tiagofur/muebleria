# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/assets/glb_writer'
require 'tmpdir'
require 'fileutils'
require 'digest'

class GlbWriterTest < Minitest::Test
  GlbWriter = Granete::SketchUpExtension::Assets::GlbWriter

  # Same asymmetric stepped bracket as the #669 canonical fixture
  # (contracts/fixtures/glb-parity-canonical.json).
  OUTLINE_MM = [
    [17.0, 23.0, 11.0],
    [87.0, 23.0, 11.0],
    [87.0, 41.0, 11.0],
    [31.0, 41.0, 11.0],
    [31.0, 77.0, 11.0],
    [17.0, 77.0, 11.0]
  ].freeze
  HEIGHT_MM = 18.0
  REFERENCE_POINTS_MM = [
    [17.0, 23.0, 11.0],
    [87.0, 23.0, 11.0],
    [31.0, 77.0, 11.0]
  ].freeze
  EXPECTED_GLB_M = [
    [0.017, 0.011, -0.023],
    [0.087, 0.011, -0.023],
    [0.031, 0.011, -0.077]
  ].freeze
  MM = 1.0 / 25.4
  VERTEX_TOLERANCE_M = 1e-6

  def setup
    @tmp_dir = Dir.mktmpdir('glb_writer_test')
    # Self-sufficient model: sibling suites (e.g. digital_thread_contract)
    # leave the shared stub's active_model nil in their teardowns, and
    # minitest's random order decides whether we run after them.
    if defined?(SketchupStub)
      SketchupStub.active_model = SketchupStub::ModelStub.new
    end
    @model = Sketchup.active_model
    refute_nil @model
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir) if @tmp_dir
  end

  def test_writes_self_contained_glb_with_canonical_units_and_axes
    definition = build_bracket_definition
    path = File.join(@tmp_dir, 'bracket.glb')
    summary = GlbWriter.write_definition_to_glb(definition, path)

    # 8 explicit faces (bottom, top, 6 sides); fan triangulation gives
    # 4 + 4 triangles for the 6-gon caps and 2 per quad side = 20 triangles.
    # (The host smoke proves the same counts on the real host triangulator
    # via pushpull solids; this unit test pins the writer contract itself.)
    assert_equal 8, summary['faces']
    assert_equal 20, summary['triangles']
    assert summary['vertices'] >= 12
    assert summary['byteLength'].positive?

    document = parse_glb_json(path)
    assert_equal '2.0', document['asset']['version']
    assert_equal 'granete-sketchup-glb-exporter 1.0.0', document['asset']['generator']
    assert_nil document['buffers'][0]['uri'], 'buffer must be embedded (no uri)'
    assert_equal 1, document['scenes'].length
    assert_equal 1, document['nodes'].length
    assert_equal 1, document['meshes'].length
    document['meshes'][0]['primitives'].each do |primitive|
      position_accessor = document['accessors'][primitive['attributes']['POSITION']]
      assert_equal 'VEC3', position_accessor['type']
      assert_equal 5126, position_accessor['componentType']
      assert_equal 3, position_accessor['min'].length
      assert_equal 3, position_accessor['max'].length
    end
  end

  def test_reference_points_survive_the_canonical_conversion
    definition = build_bracket_definition
    path = File.join(@tmp_dir, 'bracket.glb')
    GlbWriter.write_definition_to_glb(definition, path)

    positions = GlbWriter.read_positions(path)
    REFERENCE_POINTS_MM.each_with_index do |asset_mm, index|
      nearest = nearest_point(positions, EXPECTED_GLB_M[index])
      distance = Math.sqrt(((nearest[0] - EXPECTED_GLB_M[index][0])**2) +
                          ((nearest[1] - EXPECTED_GLB_M[index][1])**2) +
                          ((nearest[2] - EXPECTED_GLB_M[index][2])**2))
      assert distance < VERTEX_TOLERANCE_M,
             "reference point #{index} (#{asset_mm.inspect} mm) not present in GLB within #{VERTEX_TOLERANCE_M} m"
      roundtrip = GlbWriter.glb_point_to_asset_mm(nearest)
      3.times do |axis|
        assert_in_delta asset_mm[axis], roundtrip[axis], 1e-3,
                        "roundtrip axis #{axis} of point #{index}"
      end
    end

    # Extents in asset mm: 70 x 54 x 18.
    extents = extents_asset_mm(positions)
    assert_in_delta 70.0, extents[0], 1e-3
    assert_in_delta 54.0, extents[1], 1e-3
    assert_in_delta 18.0, extents[2], 1e-3
  end

  def test_writer_is_deterministic
    definition = build_bracket_definition
    path_a = File.join(@tmp_dir, 'a.glb')
    path_b = File.join(@tmp_dir, 'b.glb')
    GlbWriter.write_definition_to_glb(definition, path_a)
    GlbWriter.write_definition_to_glb(definition, path_b)
    assert_equal Digest::SHA256.file(path_a).hexdigest, Digest::SHA256.file(path_b).hexdigest,
                 'exporting the same definition twice must be byte-identical'
  end

  def test_reader_rejects_corrupted_containers
    definition = build_bracket_definition
    path = File.join(@tmp_dir, 'bracket.glb')
    GlbWriter.write_definition_to_glb(definition, path)
    bytes = File.binread(path)

    corrupt_magic = bytes.dup
    corrupt_magic[0] = 'X'
    assert_glb_error(corrupt_magic, 'magic')

    truncated = bytes[0, bytes.bytesize / 2]
    assert_glb_error(truncated, 'length')

    json_mutated = bytes.dup
    # Break the JSON chunk: byte 20 is the opening '{', so corrupt the next
    # one to make the document unparseable.
    json_mutated[21] = '{'
    assert_glb_error(json_mutated, 'JSON')
  end

  def test_rejects_definitions_without_faces
    empty = @model.definitions.add('granete-empty-definition')
    error = assert_raises(GlbWriter::WriterError) do
      GlbWriter.write_definition_to_glb(empty, File.join(@tmp_dir, 'empty.glb'))
    end
    assert_includes error.message, 'no faces'
  end

  private

  # Builds the closed bracket as 8 explicit faces (stub-friendly: the unit
  # stub's pushpull is a no-op; the host smoke exercises the real pushpull
  # solid). All faces use the canonical outline/height in mm (inches here).
  def build_bracket_definition
    definition = @model.definitions.add('granete-glb-writer-bracket')
    bottom = OUTLINE_MM.map { |x, y, z| Geom::Point3d.new(x * MM, y * MM, z * MM) }
    top = OUTLINE_MM.map { |x, y, z| Geom::Point3d.new(x * MM, y * MM, (z + HEIGHT_MM) * MM) }
    entities = definition.entities
    assert entities.add_face(bottom)
    assert entities.add_face(top.reverse)
    OUTLINE_MM.each_index do |i|
      j = (i + 1) % OUTLINE_MM.length
      quad = [bottom[i], bottom[j], top[j], top[i]]
      assert entities.add_face(quad)
    end
    definition
  end

  def parse_glb_json(path)
    bytes = File.binread(path)
    json_length = bytes[12, 4].unpack1('V')
    JSON.parse(bytes[20, json_length])
  end

  def nearest_point(points, target)
    points.min_by do |point|
      ((point[0] - target[0])**2) + ((point[1] - target[1])**2) + ((point[2] - target[2])**2)
    end
  end

  def extents_asset_mm(positions)
    asset = positions.map { |point| GlbWriter.glb_point_to_asset_mm(point) }
    asset.transpose.map { |axis| axis.max - axis.min }
  end

  def assert_glb_error(bytes, label)
    path = File.join(@tmp_dir, "corrupt-#{label}.glb")
    File.binwrite(path, bytes)
    error = assert_raises(GlbWriter::WriterError) { GlbWriter.read_positions(path) }
    refute_nil error.message
  end
end
