# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Stable error taxonomy of the shared host runtime (#498 / authoring
      # interaction contract §22). Behavior branches on these categories —
      # never on localized message text. Spanish copy may exist in the UI, but
      # rollback/retry/state decisions consume `category` only.
      module ErrorTaxonomy
        CATEGORIES = %w[authentication license_capability network_unavailable stale_conflict
                        invalid_authoring_input catalog_reference manufacturing_blocker
                        incompatible_contract host_apply_failure].freeze

        # Issue-code → category for the #477 stable code set. PARAMETER_* and
        # MATERIAL_CHOICE_INVALID codes not listed here default to
        # invalid_authoring_input.
        ISSUE_CODE_CATEGORIES = {
          'SCHEMA_ID_MISMATCH' => 'incompatible_contract',
          'SCHEMA_VERSION_UNSUPPORTED' => 'incompatible_contract',
          'CATALOG_REVISION_STALE' => 'stale_conflict',
          'CATALOG_REFERENCE_MISSING' => 'catalog_reference',
          'HARDWARE_REFERENCE_INVALID' => 'catalog_reference',
          'OCCURRENCE_UNKNOWN_TEMPLATE' => 'catalog_reference',
          'RESOLVE_GEOMETRY_INVALID' => 'manufacturing_blocker',
          'TRANSFORM_INVALID' => 'manufacturing_blocker',
          'RELATIONSHIP_INVALID' => 'manufacturing_blocker',
          'RELATIONSHIP_ORPHANED' => 'manufacturing_blocker',
          'JOINERY_SYSTEM_UNSUPPORTED' => 'manufacturing_blocker',
          'HARDWARE_HOST_INVALID' => 'manufacturing_blocker',
          'HARDWARE_PLACEMENT_INVALID' => 'manufacturing_blocker',
          'DRILLING_CONFLICT' => 'manufacturing_blocker',
          'OCCURRENCE_DUPLICATE_ID' => 'invalid_authoring_input',
          'OCCURRENCE_COUNT_UNSUPPORTED' => 'invalid_authoring_input',
          'SNAPSHOT_INCOMPLETE' => 'invalid_authoring_input',
          'PARAMETER_BINDING_CONFLICT' => 'invalid_authoring_input'
        }.freeze

        # HTTP statuses the transport maps structurally: 401 session, 403
        # license, 409 stale base, 5xx/408 remote unavailable. Text of the
        # body is never consulted.
        STATUS_CATEGORIES = {
          401 => 'authentication',
          403 => 'license_capability',
          409 => 'stale_conflict',
          408 => 'network_unavailable',
          502 => 'network_unavailable',
          503 => 'network_unavailable',
          504 => 'network_unavailable'
        }.freeze

        module_function

        def category_for(error)
          case error
          when Library::AuthoringResolveContract::ContractError then 'incompatible_contract'
          when Library::AuthoringResolveError, Library::LayoutResolutionError
            from_resolve_error(error)
          when Transport::RequestError then 'network_unavailable'
          else
            'host_apply_failure'
          end
        end

        def category_for_issues(issues)
          codes = issues.map { |issue| issue.respond_to?(:code) ? issue.code : issue.to_s }
          codes.each do |code|
            return ISSUE_CODE_CATEGORIES[code] if ISSUE_CODE_CATEGORIES.key?(code)
            return 'invalid_authoring_input' if code.start_with?('PARAMETER_')
          end
          return 'invalid_authoring_input' if codes.include?('MATERIAL_CHOICE_INVALID')
          return 'invalid_authoring_input' if codes.include?('REQUEST_INVALID')

          nil
        end

        # Shape-based classification, never message-substring: a contract
        # violation is incompatible, a known HTTP status maps structurally,
        # structured issues map by stable code, and a statusless issueless
        # resolve error is the provider's connection-failure wrapper.
        def from_resolve_error(error)
          issues = error.respond_to?(:issues) ? error.issues.to_a : []
          STATUS_CATEGORIES.fetch(error.status.to_i, nil) ||
            category_for_issues(issues) ||
            (error.status.nil? && issues.empty? ? 'network_unavailable' : 'invalid_authoring_input')
        end
      end
    end
  end
end
