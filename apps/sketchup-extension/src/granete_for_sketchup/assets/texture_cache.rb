# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'net/http' # rubocop:disable SketchupPerformance/OpenSSL
require 'uri'

module Granete
  module SketchUpExtension
    module Assets
      # TextureCache resolves and downloads remote material textures (JPG, PNG, WebP)
      # to the local filesystem so SketchUp materials can display actual photographic finishes.
      class TextureCache
        MAX_SIZE_BYTES = 10 * 1024 * 1024 # 10 MB per texture
        ALLOWED_EXTENSIONS = %w[.jpg .jpeg .png .webp].freeze
        ALLOWED_CONTENT_TYPES = %w[image/jpeg image/png image/webp].freeze

        attr_reader :cache_dir

        def initialize(cache_dir: nil, transport: nil, auth_provider: nil)
          @cache_dir = cache_dir || default_cache_dir
          FileUtils.mkdir_p(@cache_dir) unless File.directory?(@cache_dir)
          @transport = transport
          @auth_provider = auth_provider
        end

        # Resolves the local path for an image URL. If not cached locally, downloads it.
        # Returns the absolute path to the local image file, or nil on failure.
        def resolve_texture(image_url)
          return nil if image_url.nil? || image_url.to_s.strip.empty?

          clean_url = image_url.to_s.strip
          return clean_url if File.file?(clean_url)

          filename = cache_filename(clean_url)
          return nil if filename.nil?

          local_path = File.join(@cache_dir, filename)
          return local_path if File.file?(local_path) && File.size(local_path).positive?

          is_absolute_url = clean_url.start_with?('http://', 'https://')
          return nil unless is_absolute_url || (@transport&.configured? && @auth_provider&.configured?)

          download_texture(clean_url, local_path)
        rescue StandardError
          nil
        end

        def cache_filename(url)
          clean = url.to_s.strip
          return nil if clean.empty?

          base = File.basename(clean.split('?').first)
          ext = File.extname(base).downcase
          return nil if ext.empty? || !ALLOWED_EXTENSIONS.include?(ext)

          hash = Digest::SHA256.hexdigest(clean)[0..15]
          "#{hash}-#{base}"
        end

        private

        def default_cache_dir
          base = if defined?(::Sketchup) && ::Sketchup.respond_to?(:temp_dir)
                   ::Sketchup.temp_dir
                 else
                   ENV['TMPDIR'] || '/tmp'
                 end
          File.join(base, 'granete_textures')
        end

        def download_texture(image_url, target_path)
          uri = parse_texture_uri(image_url)
          return nil unless uri.is_a?(URI::HTTP) && uri.host

          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = uri.is_a?(URI::HTTPS)
          http.open_timeout = 10
          http.read_timeout = 10

          req = Net::HTTP::Get.new(uri.request_uri)
          auth_header = @auth_provider&.authorization_header
          req['Authorization'] = auth_header if auth_header && !image_url.start_with?('http://', 'https://')

          res = http.request(req)
          return nil unless valid_response?(res)

          write_atomic(target_path, res.body)
        rescue StandardError
          nil
        end

        def parse_texture_uri(image_url)
          if image_url.start_with?('http://', 'https://')
            URI.parse(image_url)
          else
            base_url = @transport&.base_url
            return nil unless base_url

            clean_path = image_url.start_with?('/api/') ? image_url.sub(%r{\A/api}, '') : image_url
            clean_path = "/#{clean_path}" unless clean_path.start_with?('/')
            URI.parse("#{base_url}#{clean_path}")
          end
        end

        def valid_response?(res)
          return false unless res.is_a?(::Net::HTTPSuccess) && !res.body.nil?
          return false if res.body.bytesize.zero? || res.body.bytesize > MAX_SIZE_BYTES

          content_type = res['content-type'].to_s.downcase.split(';').first.strip
          ALLOWED_CONTENT_TYPES.any? { |type| content_type.start_with?(type) }
        end

        def write_atomic(target_path, data)
          tmp_path = "#{target_path}.tmp.#{Process.pid}.#{rand(10_000)}"
          File.binwrite(tmp_path, data)
          File.rename(tmp_path, target_path)
          target_path
        ensure
          FileUtils.rm_f(tmp_path) if tmp_path && File.exist?(tmp_path)
        end
      end
    end
  end
end
