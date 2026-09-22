# frozen_string_literal: true

require 'fileutils'
require 'zlib'

require_relative '../test_helper'
require_relative '../support/smoke_textures'

# Portable structural proof of the smoke PNG emitter (#821 R3): the host
# smokes depend on SketchUp loading these files as material textures, but
# TestUp runs only on the real host. This test validates the emitted PNG
# chunk-by-chunk — signature, IHDR fields, per-chunk CRC32 (recomputed with
# the correct Zlib.crc32), and IDAT scanline payload — so a generator typo
# cannot survive outside a TestUp session.
class SmokeTexturesTest < Minitest::Test
  BLANCO = [0xF3, 0xF7, 0xFA].freeze
  MOSCATO = [0x8A, 0x69, 0x4C].freeze

  def test_png_is_structurally_valid_and_carries_the_uniform_color
    png = Granete::SketchUpExtension::SmokeTextures.png(BLANCO, 4)

    assert_equal "\x89PNG\r\n\x1a\n".b, png.byteslice(0, 8).b, 'PNG signature'
    chunks = parse_chunks(png)
    assert_equal(%w[IHDR IDAT IEND], chunks.map { |c| c[:type] })

    ihdr = chunks[0][:data].unpack('NNCCCCC')
    assert_equal [4, 4, 8, 2, 0, 0, 0], ihdr, '4x4 8-bit truecolor, no interlace'

    scanlines = Zlib::Inflate.inflate(chunks[1][:data])
    assert_equal 4 * (1 + (3 * 4)), scanlines.bytesize, 'four filter-0 RGB scanlines'
    expected_row = ([0] + (BLANCO * 4)).pack('C*')
    assert_equal expected_row * 4, scanlines

    assert_empty chunks[2][:data], 'IEND carries no payload'
  end

  def test_written_file_matches_the_emitted_png
    path = Granete::SketchUpExtension::SmokeTextures.write('moscato.png', MOSCATO, 2)
    assert_equal Granete::SketchUpExtension::SmokeTextures.png(MOSCATO, 2), File.binread(path)
  ensure
    FileUtils.rm_f(path) if path
  end

  private

  # Parses length/type/data/CRC tuples and recomputes every CRC — the exact
  # integrity check a decoder performs before loading the image.
  def parse_chunks(png)
    chunks = []
    offset = 8
    while offset < png.bytesize
      length = png.byteslice(offset, 4).unpack1('N')
      type = png.byteslice(offset + 4, 4)
      data = png.byteslice(offset + 8, length)
      crc = png.byteslice(offset + 8 + length, 4).unpack1('N')
      recomputed = Zlib.crc32(type + data)
      assert_equal recomputed, crc, "chunk #{type} CRC32 must match the recomputed value"
      chunks << { type: type, data: data }
      offset += 12 + length
    end
    chunks
  end
end
