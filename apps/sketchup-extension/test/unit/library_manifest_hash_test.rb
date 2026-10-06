# frozen_string_literal: true

require 'json'
require 'test_helper'
require_relative '../../src/granete_for_sketchup/library/manifest_hash'

# #1164: Ruby parity of the backend's manifestHash contract
# (domain.ComputeManifestHash). Pinned by
# contracts/fixtures/library-manifest-hash-parity.json, the same fixture the
# Go suite asserts — either side changing the algorithm alone breaks here.
module Granete
  module SketchUpExtension
    module Library
      class ManifestHashTest < Minitest::Test
        FIXTURE = File.expand_path('../../../../contracts/fixtures/library-manifest-hash-parity.json', __dir__)

        def fixture
          @fixture ||= JSON.parse(File.read(FIXTURE))
        end

        def test_computes_the_pinned_parity_digest
          computed = ManifestHash.compute(fixture['manifest'])
          assert_equal fixture['expectedDigest'], computed
        end

        def test_digest_ignores_the_manifests_own_hash_field
          manifest = fixture['manifest'].dup
          manifest['manifestHash'] = 'sha256:deadbeef'
          assert_equal fixture['expectedDigest'], ManifestHash.compute(manifest),
                       'the manifestHash field is excluded from the pre-hash payload'

          manifest.delete('manifestHash')
          assert_equal fixture['expectedDigest'], ManifestHash.compute(manifest),
                       'its absence changes nothing either'
        end

        def test_digest_is_order_insensitive_for_resources_and_assets
          manifest = fixture['manifest'].dup
          manifest['resources'] = manifest['resources'].reverse
          assert_equal fixture['expectedDigest'], ManifestHash.compute(manifest),
                       'resources arrive sorted by (kind, id, revision) before hashing'
        end

        def test_match_and_normalize_are_prefix_tolerant
          digest = fixture['expectedDigest']
          bare = digest.sub(/\Asha256:/, '')
          assert ManifestHash.match?(digest, bare)
          assert ManifestHash.match?("  #{digest} ", digest)
          refute ManifestHash.match?(digest, 'sha256:0000')
        end

        def test_omitempty_fields_follow_go_pointer_semantics
          base = fixture['manifest'].dup
          base.delete('minPluginVersion')
          base.delete('upstream')

          without = ManifestHash.compute(base)
          base['minPluginVersion'] = ''
          with_empty = ManifestHash.compute(base)
          refute_equal without, with_empty,
                       'nil drops the key (omitempty), an explicit empty string survives — Go pointer semantics'

          base['minPluginVersion'] = '0.1.44'
          with_value = ManifestHash.compute(base)
          refute_equal with_empty, with_value, 'a real minPluginVersion changes the digest'
        end
      end
    end
  end
end
