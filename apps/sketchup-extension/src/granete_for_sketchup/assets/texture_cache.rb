# frozen_string_literal: true

require 'fileutils'
require 'net/http' # rubocop:disable SketchupPerformance/OpenSSL
require 'uri'

module Granete
  module SketchUpExtension
    module Assets
      # TextureCache resolves and downloads remote material textures (JPG, PNG, WebP)
      # to the local filesystem so SketchUp materials can display actual photographic finishes.
      class TextureCache
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

          filename = File.basename(clean_url.split('?').first)
          return nil if filename.empty?

          local_path = File.join(@cache_dir, filename)
          return local_path if File.file?(local_path) && File.size(local_path).positive?

          is_absolute_url = clean_url.start_with?('http://', 'https://')
          return nil unless is_absolute_url || (@transport&.configured? && @auth_provider&.configured?)

          download_texture(clean_url, local_path)
        rescue StandardError
          nil
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
          uri = if image_url.start_with?('http://', 'https://')
                  URI.parse(image_url)
                else
                  base_url = @transport&.base_url
                  return nil unless base_url

                  clean_path = image_url.start_with?('/api/') ? image_url.sub(%r{\A/api}, '') : image_url
                  clean_path = "/#{clean_path}" unless clean_path.start_with?('/')
                  URI.parse("#{base_url}#{clean_path}")
                end

          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = uri.is_a?(URI::HTTPS)
          http.open_timeout = 10
          http.read_timeout = 10

          req = Net::HTTP::Get.new(uri.request_uri)
          auth_header = @auth_provider&.authorization_header
          req['Authorization'] = auth_header if auth_header && !image_url.start_with?('http://', 'https://')

          res = http.request(req)
          if res.is_a?(::Net::HTTPSuccess) && !res.body.nil? && res.body.bytesize.positive?
            File.binwrite(target_path, res.body)
            target_path
          end
        rescue StandardError
          nil
        end
      end
    end
  end
end
