# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Library
      # Production adapter for the LibrarySynchronizer port (#774), wired in
      # #1102 Slice D: it reads the PUBLISHED-release consumer surface —
      # current discovery, exact manifest and content-addressed blobs. The
      # manifest and blob bodies travel RAW (request_raw) because the store
      # verifies sha256 over the exact server bytes; only the current-release
      # discovery is parsed JSON.
      class ReleaseApiClient
        def initialize(transport:, auth_provider:, logger: nil)
          @transport = transport
          @auth_provider = auth_provider
          @logger = logger
        end

        def configured?
          @transport.respond_to?(:configured?) && @transport.configured? &&
            @auth_provider.respond_to?(:configured?) && @auth_provider.configured?
        end

        # Parsed summary of the published release the server currently
        # advertises (LibraryReleaseSummary), or nil when unreachable.
        def fetch_current_release
          response = authenticated_get('/manufacturing-libraries/standard/releases/current')
          return nil unless response && response['status'] == 200

          body = response['body']
          body.is_a?(Hash) ? body : nil
        rescue Transport::NotConfiguredError, Transport::RequestError => e
          @logger&.info('library_current_release_unreachable', error: e)
          nil
        end

        # RAW manifest JSON string for the synchronizer, or nil on failure.
        def fetch_manifest(release_id)
          raw_authenticated_get("/manufacturing-libraries/standard/releases/#{release_id}/manifest")
        end

        # RAW blob body (exact server bytes) for sha256 verification, or nil.
        def fetch_blob(release_id, resource_id, hash)
          raw_authenticated_get(
            "/manufacturing-libraries/standard/releases/#{release_id}/resources/#{resource_id}/blobs/#{hash}"
          )
        end

        private

        def authenticated_get(path)
          return nil unless configured?

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          @transport.request({ 'method' => 'GET', 'path' => path },
                             authorization_header: @auth_provider.authorization_header)
        rescue Transport::NotConfiguredError, Transport::RequestError => e
          @logger&.info('library_release_get_failed', path: path, error: e)
          nil
        end

        def raw_authenticated_get(path)
          return nil unless configured?

          @auth_provider.refresh_if_needed if @auth_provider.respond_to?(:refresh_if_needed)
          response = @transport.request_raw({ 'method' => 'GET', 'path' => path },
                                            authorization_header: @auth_provider.authorization_header)
          return nil unless response && response['status'] == 200

          raw = response['body'].to_s
          raw.empty? ? nil : raw
        rescue Transport::NotConfiguredError, Transport::RequestError => e
          @logger&.info('library_release_raw_get_failed', path: path, error: e)
          nil
        end
      end
    end
  end
end
