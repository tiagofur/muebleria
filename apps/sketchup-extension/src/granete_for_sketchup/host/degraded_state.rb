# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Minimum fail-closed degraded-state model pulled forward from #474
      # (#498 owns the states and mutation guards; #474 keeps the complete
      # cache/reconnect/pending-intent product). States are honest: a state
      # other than resolved_current can never render as ready/manufacturable,
      # and a generic preview is never productive.
      module DegradedState
        STATES = %w[resolved_current resolved_stale unresolved_preview offline_cached
                    sync_required blocked_incompatible].freeze

        PRODUCTIVE_STATE = 'resolved_current'

        module_function

        # Maps a mutation outcome (+ its stable error category / resolve
        # channel) onto the canonical degraded vocabulary. nil keeps the
        # previous degraded state (cancelled/aborted change nothing).
        def for_mutation(outcome, category: nil, resolve_kind: nil)
          case outcome
          when 'committed'
            resolve_kind == 'generic_preview' ? 'unresolved_preview' : PRODUCTIVE_STATE
          when 'unavailable'
            case category
            when 'authentication' then 'sync_required'
            when 'license_capability', 'incompatible_contract' then 'blocked_incompatible'
            else 'offline_cached'
            end
          when 'stale' then 'resolved_stale'
          when 'rejected'
            category == 'incompatible_contract' ? 'blocked_incompatible' : PRODUCTIVE_STATE
          end
        end

        def productive?(state)
          state == PRODUCTIVE_STATE
        end

        # Catalog/session provenance → degraded state for the dialog surface:
        # the local fallback catalog is an explicit non-productive preview.
        def for_catalog_source(source)
          case source
          when 'remote' then PRODUCTIVE_STATE
          when 'local' then 'unresolved_preview'
          when 'unauthenticated' then 'sync_required'
          when 'license_blocked' then 'blocked_incompatible'
          else 'offline_cached'
          end
        end
      end
    end
  end
end
