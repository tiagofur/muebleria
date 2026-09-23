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

        # Non-secret session-context identity (#469 gesture guard): stable
        # across a technical token refresh, changed by logout/re-enrollment/
        # context switch, nil when the context is unknown or unreadable
        # (callers fail closed — nil never equals nil). Providers without
        # a durable context identity keep the nil default.
        def session_context_id
          nil
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
