# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Assets
      # MediaAuthorizer mints short-lived, resource-scoped media read grants
      # (#460 SEC-3). The extension session credential NEVER reaches the
      # HtmlDialog webviews: this class exchanges it (Authorization header,
      # server-side) for per-file signed URLs that expire within minutes, and
      # the webviews only ever see those URLs.
      #
      # A grant is bound to exactly one file of one organization and can only
      # perform GET; it is not a session credential and cannot reach business
      # APIs. Expired grants simply re-authorize through the same flow.
      class MediaAuthorizer
        MEDIA_PATH = %r{/api/media/([0-9a-f]{32}\.(?:jpg|png|webp))}
        MEDIA_FILENAME = /\A([0-9a-f]{32}\.(?:jpg|png|webp))\z/
        BATCH_SIZE = 100

        # @param transport [Transport::Adapter] configured API transport
        # @param auth_provider [Auth::Provider] session that supplies the
        #        Authorization header used ONLY for the authorize call.
        def initialize(transport: nil, auth_provider: nil, logger: nil)
          @transport = transport
          @auth_provider = auth_provider
          @logger = logger
        end

        # Deep-scans a catalog/selector payload for canonical server media
        # paths and returns the deduplicated filename list.
        def collect_media_filenames(value, acc = [])
          case value
          when Hash
            value.each_value { |child| collect_media_filenames(child, acc) }
          when Array
            value.each { |child| collect_media_filenames(child, acc) }
          when String
            MEDIA_PATH.match(value) { |m| acc << m[1] unless acc.include?(m[1]) }
          end
          acc
        end

        # Builds the webview media payload: the origin plus a filename →
        # signed-URL map. Returns nil when the session or transport is not
        # configured, or when nothing could be authorized (callers omit the
        # key entirely so webviews fall back to placeholders).
        def media_payload_for(payload)
          filenames = collect_media_filenames(payload)
          return nil if filenames.empty?

          urls = authorize_urls(filenames)
          return nil if urls.empty?

          { 'baseUrl' => media_origin, 'urls' => urls }
        end

        # Authorizes one filename (webview refresh callback) and returns
        # { 'filename' => ..., 'url' => absolute signed URL } or nil.
        def refresh_url(filename)
          match = MEDIA_FILENAME.match(filename.to_s)
          return nil if match.nil?

          urls = authorize_urls([match[1]])
          return nil if urls.empty?

          { 'filename' => match[1], 'url' => urls[match[1]] }
        end

        private

        def configured?
          @transport.respond_to?(:configured?) && @transport.configured? &&
            @auth_provider.respond_to?(:configured?) && @auth_provider.configured?
        end

        def media_origin
          @transport.base_url.to_s.sub(%r{/api\z}, '').sub(%r{/+\z}, '')
        end

        def authorize_urls(filenames)
          return {} unless configured?

          urls = {}
          filenames.each_slice(BATCH_SIZE) do |batch|
            response = @transport.request(
              { 'method' => 'POST', 'path' => '/media:authorize',
                'body' => { 'resources' => batch } },
              authorization_header: @auth_provider.authorization_header
            )
            next unless response['status'] == 200

            body = response['body'].is_a?(Hash) ? response['body'] : {}
            Array(body['grants']).each do |grant|
              next unless grant.is_a?(Hash) && grant['filename'] && grant['url']

              urls[grant['filename']] = "#{media_origin}#{grant['url']}"
            end
          end
          urls
        rescue Auth::NotConfiguredError, Transport::RequestError, Transport::NotConfiguredError => e
          @logger&.error('media_authorize_failed', error: e)
          {}
        end
      end
    end
  end
end
