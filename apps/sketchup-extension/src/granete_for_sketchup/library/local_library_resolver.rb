# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Library
      class ResolutionError < StandardError; end

      # LocalLibraryResolver provides a fast, offline-capable read interface to
      # locally installed manufacturing libraries.
      #
      # Responsibilities:
      # - Immediately resolves the installed current effective release for the active organization.
      # - Resolves historical pinned releases for existing projects without altering the current pointer.
      # - Deserializes content-addressed definition blobs.
      # - Operates completely offline without network fan-out.
      class LocalLibraryResolver
        attr_reader :store

        def initialize(store:)
          @store = store
        end

        def available_offline?(org_id)
          rel_id = @store.current_release_id(org_id)
          return false unless rel_id

          @store.manifest_exist?(rel_id)
        end

        def active_release_id(org_id)
          @store.current_release_id(org_id)
        end

        def resolve_effective_release(org_id)
          rel_id = active_release_id(org_id)
          raise ResolutionError, "no effective release installed for organization #{org_id}" unless rel_id

          resolve_pinned_release(rel_id)
        end

        def resolve_pinned_release(release_id)
          rel_id = release_id.to_s.strip
          manifest = @store.read_manifest(rel_id)
          raise ResolutionError, "library release #{rel_id} not installed in local store" unless manifest

          manifest
        end

        def resolve_resource(definition_hash)
          raw = @store.read_object(definition_hash)
          raise ResolutionError, "resource blob #{definition_hash} not found in local store" unless raw

          JSON.parse(raw)
        rescue JSON::ParserError => e
          raise ResolutionError, "corrupted resource JSON for #{definition_hash}: #{e.message}"
        end

        def resolve_furniture_definition(release_id, resource_id)
          manifest = resolve_pinned_release(release_id)
          resources = manifest['resources'] || []

          res = resources.find { |r| r['id'].to_s == resource_id.to_s }
          raise ResolutionError, "resource #{resource_id} not found in release #{release_id}" unless res

          def_hash = res['definitionHash']
          raise ResolutionError, "resource #{resource_id} has no definitionHash" unless def_hash

          resolve_resource(def_hash)
        end

        def list_furniture_definitions(release_id)
          manifest = resolve_pinned_release(release_id)
          resources = manifest['resources'] || []

          furniture_refs = resources.select { |r| r['kind'] == 'furniture_definition' }
          furniture_refs.map do |r|
            def_hash = r['definitionHash']
            begin
              data = resolve_resource(def_hash)
              {
                'id' => r['id'],
                'revision' => r['revision'],
                'packageKind' => r['packageKind'],
                'definitionHash' => def_hash,
                'definition' => data
              }
            rescue ResolutionError
              nil
            end
          end.compact
        end
      end
    end
  end
end
