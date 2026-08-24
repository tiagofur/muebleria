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
      end

      class NullAdapter < Adapter
        def configured?
          false
        end

        def request(_payload, authorization_header:) # rubocop:disable Lint/UnusedMethodArgument
          raise NotConfiguredError, 'Transport is not configured'
        end
      end
    end
  end
end
