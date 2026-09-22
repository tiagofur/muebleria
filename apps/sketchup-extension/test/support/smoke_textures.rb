# frozen_string_literal: true

module Granete
  module SketchUpExtension
    # Pure-stdlib PNG emitter shared by the TestUp host smokes and their
    # portable unit proof (#821 R3). Host smokes need real image files for
    # SketchUp Material#texture=, and neither SketchUp Ruby nor the test
    # environment ships an image gem — so the smoke textures are emitted as
    # minimal valid 8-bit truecolor PNGs (single filter-0 scanline shape).
    # test/unit/smoke_textures_test.rb validates the emitted structure
    # chunk-by-chunk (CRC included) so a typo like Zlib.cRC32 cannot survive
    # outside a real TestUp run.
    module SmokeTextures
      SIGNATURE = "\x89PNG\r\n\x1a\n".b.freeze
      private_constant :SIGNATURE

      # Returns the binary PNG for one uniform rgb ([r, g, b]) color at the
      # given square size. Binary (ASCII-8BIT) throughout: mixing encodings
      # with pack('C*') output raises on frozen_string_literal files.
      def self.png(rgb, size = 4)
        width = height = size
        row = ([0] + (rgb * width)).pack('C*')
        scanlines = Array.new(height) { row }.join
        chunks = [
          chunk('IHDR', [width, height, 8, 2, 0, 0, 0].pack('NNCCCCC')),
          chunk('IDAT', Zlib::Deflate.deflate(scanlines)),
          chunk('IEND', ''.b)
        ]
        (SIGNATURE.dup + chunks.join).b
      end

      # Writes the texture and returns its absolute path.
      def self.write(name, rgb, size = 4)
        require 'tmpdir'
        path = File.join(Dir.mktmpdir('granete_smoke_textures'), name)
        File.binwrite(path, png(rgb, size))
        path
      end

      def self.chunk(type, data)
        [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N')
      end
    end
  end
end
