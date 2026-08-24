# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Auth
      class NotConfiguredError < StandardError; end

      class Provider
        def configured?
          raise NotImplementedError, 'Auth providers must implement configured?'
        end

        def authorization_header
          raise NotImplementedError, 'Auth providers must implement authorization_header'
        end
      end

      class NullProvider < Provider
        def configured?
          false
        end

        def authorization_header
          raise NotConfiguredError, 'Authentication is not configured'
        end
      end
    end
  end
end
