# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Transport
      class NotConfiguredError < StandardError; end

      class Adapter
        def configured?
          raise NotImplementedError, 'Transport adapters must implement configured?'
        end

        def request(_payload, authorization_header:)
          raise NotImplementedError, 'Transport adapters must implement request'
        end

        # Multipart file upload (#392 / DT-8): payload carries 'path' plus
        # optional 'headers'; the file streams from disk. Adapters that cannot
        # stream raise; there is no fallback to base64 JSON for design
        # artifacts.
        def upload(_payload, _file_path:, _content_type:, _authorization_header: nil)
          raise NotImplementedError, 'Transport adapters must implement upload'
        end
      end

      class NullAdapter < Adapter
        def configured?
          false
        end

        def request(_payload, authorization_header:) # rubocop:disable Lint/UnusedMethodArgument
          raise NotConfiguredError, 'Transport is not configured'
        end

        def upload(payload, file_path:, content_type:, authorization_header: nil) # rubocop:disable Lint/UnusedMethodArgument
          raise NotConfiguredError, 'Transport is not configured'
        end
      end
    end
  end
end
