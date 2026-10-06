# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Library
      # ConsumerPin (#1102 LIB-AUTH Slice D): the plugin-side release pin.
      #
      # Best-effort boot refresh: discovers the server's current published
      # release and, when the organization's local pointer differs, syncs it
      # into LibraryStore (verified, atomic — #774 invariants). Any failure
      # keeps the previous pin: an offline consumer stays on the release it
      # already has until its OWN successful update — exactly the
      # "otro consumidor sigue en la vieja hasta su propio update" contract.
      class ConsumerPin
        def initialize(store:, api_client:, synchronizer:, auth_provider:, logger: nil)
          @store = store
          @api_client = api_client
          @synchronizer = synchronizer
          @auth_provider = auth_provider
          @logger = logger
        end

        def configured?
          @api_client.configured?
        end

        # :refreshed | :current | :no_org | :unconfigured | :unavailable
        # (or the synchronizer's result hash). Raises on unexpected errors so
        # the caller's single rescue logs them; never mutates state partially
        # (the synchronizer owns atomicity).
        def refresh!
          return :unconfigured unless configured?

          org = active_org_id.to_s.strip
          return :no_org if org.empty?

          current = @api_client.fetch_current_release
          return :unavailable unless current.is_a?(Hash)

          release_id = current['effectiveReleaseId'].to_s.strip
          return :unavailable if release_id.empty?

          return :current if @store.current_release_id(org) == release_id

          result = @synchronizer.sync_release(
            release_id: release_id,
            org_id: org,
            expected_manifest_hash: current['manifestHash'],
            active_org_checker: -> { active_org_id }
          )
          @logger&.info('library_pin_refreshed', release_id: release_id, downloaded: result[:downloaded_count])
          result
        end

        private

        def active_org_id
          return '' unless @auth_provider.respond_to?(:current_organization_id)

          @auth_provider.current_organization_id.to_s
        end
      end
    end
  end
end
