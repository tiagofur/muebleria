# frozen_string_literal: true

require 'digest'
require 'json'

module Granete
  module SketchUpExtension
    module Library
      # Ruby parity of the backend's manifestHash contract
      # (domain.ComputeManifestHash + CanonicalizeJSON in
      # backend-go/internal/domain/manufacturing_library_manifest.go).
      #
      # The recorded manifestHash covers the canonical PRE-HASH payload: the
      # manifest WITHOUT its own manifestHash field, keys in the Go struct
      # declaration order, resources sorted by (kind, id, revision), assets
      # sorted by (kind, sha256), omitempty fields dropped, compact JSON with
      # no HTML escaping. It does NOT cover the served bytes — jsonb storage
      # on the server re-serializes them — so verification MUST recompute
      # instead of hashing what arrived (#1164). Parity is pinned by
      # contracts/fixtures/library-manifest-hash-parity.json in both the Go
      # and Ruby suites.
      module ManifestHash
        # Field declaration order of the mirrored Go structs: the payload
        # clone inside ComputeManifestHash, ManifestResourceRef,
        # ManifestAssetRef and ManifestUpstreamRef. Non-omitempty struct
        # strings marshal as "" when absent, matching Go semantics.
        PAYLOAD_KEYS = %w[
          schemaVersion libraryId libraryCode libraryVersion
          effectiveReleaseId minPluginVersion upstream resources
        ].freeze
        OPTIONAL_PAYLOAD_KEYS = %w[minPluginVersion upstream].freeze
        RESOURCE_KEYS = %w[kind id revision definitionHash packageKind].freeze
        ASSET_KEYS = %w[kind sha256 size].freeze
        UPSTREAM_KEYS = %w[libraryId releaseId version].freeze

        module_function

        # Canonical "sha256:<hex>" digest of the manifest's pre-hash payload.
        def compute(manifest)
          manifest = {} if manifest.nil?
          payload = {}
          PAYLOAD_KEYS.each do |key|
            value = project(key, manifest[key])
            # Go omitempty: nil drops the key; an explicit value survives.
            payload[key] = value unless value.nil?
          end
          "sha256:#{Digest::SHA256.hexdigest(JSON.generate(payload))}"
        end

        # Prefix-tolerant comparison of two digest forms.
        def normalize(digest)
          digest.to_s.strip.sub(/\Asha256:/, '')
        end

        def match?(computed, expected)
          normalize(computed) == normalize(expected)
        end

        def project(key, value)
          case key
          when 'resources'
            sorted_resources(value).map { |r| canonical_resource(r) }
          when 'upstream'
            # Go omitempty on the pointer: an absent upstream drops the key
            # entirely (never a null-valued object).
            return nil if value.nil?

            canonical_keys(UPSTREAM_KEYS, value)
          else
            value
          end
        end

        def canonical_resource(resource)
          resource = {} if resource.nil?
          out = {}
          RESOURCE_KEYS.each do |key|
            out[key] = resource[key].nil? ? '' : resource[key]
          end
          assets = resource['assets']
          unless assets.nil? || assets.empty?
            # assets is omitempty and sorted by (kind, sha256) when > 1.
            out['assets'] = sorted_assets(assets).map { |a| canonical_keys(ASSET_KEYS, a) }
          end
          out
        end

        def canonical_keys(keys, object)
          object = {} if object.nil?
          keys.to_h { |key| [key, object[key]] }
        end

        # SortManifestResources semantics without input mutation.
        def sorted_resources(resources)
          (resources || []).sort_by { |r| [r['kind'].to_s, r['id'].to_s, r['revision'].to_s] }
        end

        def sorted_assets(assets)
          assets.sort_by { |a| [a['kind'].to_s, a['sha256'].to_s] }
        end
      end
    end
  end
end
