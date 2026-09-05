# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      # Authoritative preflight review projection (#466 / SU-UX-1).
      #
      # Pure consumer of Granete's resolve preflight subset: status and
      # issues arrive structured (code/severity/entityId/path/remediation)
      # and are ONLY grouped, translated to Spanish display copy
      # (PreflightReviewCopy) and enriched with navigation candidates —
      # never re-validated. `ready` exists exclusively as the projection of
      # an authoritative `clear` result; local parameter validity can never
      # mint it.
      class PreflightReview
        AUTHORITATIVE_STATES = %w[ready warning blocked].freeze
        EFFECTIVE_STATES = %w[pending ready warning blocked stale unavailable].freeze

        attr_reader :scope, :target_key, :status, :issues, :message_id, :fingerprint,
                    :catalog_revision, :reason, :operations

        def initialize(scope:, status:, issues:, message_id:, fingerprint: nil,
                       catalog_revision: nil, reason: nil, operations: [], relationships: [])
          @scope = scope
          @target_key = CommandContract.semantic_target_key(CommandContract.furniture_scope(scope))
          @status = status
          @issues = issues
          @message_id = message_id
          @fingerprint = fingerprint
          @catalog_revision = catalog_revision
          @reason = reason
          @operations = operations
          @relationships = relationships
          @last_navigation = nil
        end

        # Review of an ACCEPTED authoritative resolve: the preflight subset is
        # the manufacturing truth. `warning` is the honest projection of an
        # authoritative `clear` that still carries warning-severity issues.
        def self.from_accepted_result(result:, scope:, message_id:)
          new(scope: scope, status: review_status_from(result), issues: result.preflight_issues,
              message_id: message_id, fingerprint: result.manufacturing_fingerprint,
              catalog_revision: result.catalog_revision, operations: result.operations,
              relationships: snapshot_relationships(result))
        end

        # Review of a REJECTED resolve: the server refused the authoring
        # intent, so the furniture is authoritatively NOT ready to fabricate;
        # its structured issues are reviewable like any other.
        def self.from_rejection(issues:, scope:, message_id:, reason:)
          new(scope: scope, status: 'blocked', issues: issues, message_id: message_id,
              reason: reason || 'El servidor autoritativo rechazó la autoría del mueble')
        end

        def self.unavailable(scope:, reason:)
          new(scope: scope, status: 'unavailable', issues: [], message_id: nil,
              reason: reason || 'La revisión de fabricación no está disponible')
        end

        # ready/warning/blocked come exclusively from the authoritative
        # preflight subset — never derived from local parameter validity. A
        # result without an authoritative preflight section cannot mint any
        # review state and fails closed.
        def self.review_status_from(result)
          raise ArgumentError, 'el resultado no lleva preflight autoritativo' if result.preflight_status.nil?

          if result.preflight_status == 'blocked'
            'blocked'
          elsif result.preflight_issues.any? { |issue| issue.severity == 'warning' }
            'warning'
          else
            'ready'
          end
        end

        def self.snapshot_relationships(result)
          result.normalized_snapshot.is_a?(Hash) ? result.normalized_snapshot['relationships'].to_a : []
        end

        def issue_count
          @issues.length
        end

        def issue_by_id(issue_id)
          grouped_payloads.flat_map { |group| group['issues'] }
                          .find { |payload| payload['issueId'] == issue_id }
        end

        # Navigation candidates for a review issueId, resolved from the RAW
        # authoritative issue (its details carry the operation/host identity
        # provenance the payload intentionally omits).
        def candidates_by_issue_id(issue_id)
          index = issue_id.to_s[/\d+\z/]&.to_i
          return [] unless index && @issues[index]

          navigation_candidates(@issues[index])
        end

        def severity_counts
          @issues.each_with_object('error' => 0, 'warning' => 0, 'info' => 0) do |issue, counts|
            counts[issue.severity] = counts.fetch(issue.severity, 0) + 1 if counts.key?(issue.severity)
          end
        end

        # Ordered navigation candidates (most specific first). Identity-only:
        # entity ids and provenance come from the authoritative envelope —
        # never from names, GUIDs or geometry.
        def navigation_candidates(issue)
          candidates = []
          conflict_op = operation_by_id(issue.details['operationId2']) ||
                        operation_by_id(issue.details['operationId1'])
          if conflict_op&.hardware_placement_id
            candidates << { 'kind' => 'hardware', 'id' => conflict_op.hardware_placement_id }
          end
          relationship_source = relationship_source_id(issue)
          candidates << { 'kind' => 'part', 'id' => relationship_source } if relationship_source
          candidates << { 'kind' => 'part', 'id' => issue.entity_id } if issue.entity_id
          host = issue.details['hostComponentInstanceId']
          candidates << { 'kind' => 'part', 'id' => host } if host
          candidates.uniq { |candidate| [candidate['kind'], candidate['id']] }
        end

        # Fix-loop actions exposed for an issue, derived from authoritative
        # provenance: editing hardware is only offered when the conflict's
        # provenance is a MANUAL placement (#468 editor); editing a component
        # is offered when the issue is anchored on a component relationship
        # (#467 internal authoring — the source occurrence is the fix point).
        def actions_for(issue)
          candidates = navigation_candidates(issue)
          relationship_source = relationship_source_id(issue)
          actions = []
          actions << 'navigate' unless candidates.empty?
          actions << 'edit_hardware' if candidates.any? do |candidate|
            candidate['kind'] == 'hardware' && manual_placement?(candidate['id'])
          end
          actions << 'edit_component' if relationship_source && candidates.any? do |candidate|
            candidate['kind'] == 'part' && candidate['id'] == relationship_source
          end
          actions << 'select_part' if candidates.any? { |candidate| candidate['kind'] == 'part' }
          actions << 'edit_material' if PreflightReviewCopy.category_of(issue.code) == 'materials'
          actions << 'select_furniture'
          actions
        end

        def record_navigation(issue_id, navigation)
          @last_navigation = navigation && { 'issueId' => issue_id }.merge(navigation)
        end

        def to_payload(effective_status: nil)
          status = EFFECTIVE_STATES.include?(effective_status) ? effective_status : @status
          {
            'scope' => @scope,
            'targetKey' => @target_key,
            'status' => status,
            'authoritativeStatus' => @status,
            'reason' => @reason,
            'fingerprint' => @fingerprint,
            'catalogRevision' => @catalog_revision,
            'messageId' => @message_id,
            'severityCounts' => severity_counts,
            'issueCount' => issue_count,
            'groups' => grouped_payloads,
            'navigation' => @last_navigation
          }
        end

        private

        def grouped_payloads
          grouped = @issues.group_by { |issue| PreflightReviewCopy.category_of(issue.code) }
          grouped.map do |category, category_issues|
            {
              'key' => category,
              'label' => PreflightReviewCopy.category_label(category),
              'count' => category_issues.length,
              # issueId pins the issue's position in the AUTHORITATIVE order
              # so navigation maps it back to the raw issue deterministically.
              'issues' => category_issues.map { |issue| issue_payload(issue) }
            }
          end
        end

        def issue_payload(issue)
          candidates = navigation_candidates(issue)
          source = candidates.first || { 'kind' => 'furniture', 'id' => nil }
          {
            'issueId' => "issue-#{@issues.index(issue)}",
            'code' => issue.code,
            'severity' => issue.severity,
            'title' => PreflightReviewCopy.title_for(issue.code),
            'message' => issue.message,
            'remediation' => PreflightReviewCopy.remediation_for(issue.code),
            'serverRemediation' => issue.remediation,
            'entityId' => issue.entity_id,
            'path' => issue.path,
            'source' => { 'kind' => source['kind'], 'id' => source['id'],
                          'label' => source_label(source) },
            'actions' => actions_for(issue)
          }
        end

        def source_label(source)
          base = PreflightReviewCopy.source_kind_label(source['kind'])
          source['id'] ? "#{base} · #{source['id']}" : base
        end

        def operation_by_id(operation_id)
          return nil unless operation_id.is_a?(String) && !operation_id.empty?

          @operations.find { |operation| operation.operation_id == operation_id }
        end

        # Relationship-targeted issue → its authoritative source occurrence.
        def relationship_source_id(issue)
          relationship_id = issue.details['relationshipId'] ||
                            (relationship_ids.include?(issue.entity_id) ? issue.entity_id : nil)
          return nil unless relationship_id

          relationship = @relationships.find do |entry|
            entry.is_a?(Hash) && entry['relationshipId'] == relationship_id
          end
          relationship&.dig('source', 'componentInstanceId')
        end

        def relationship_ids
          @relationships.filter_map { |entry| entry['relationshipId'] if entry.is_a?(Hash) }
        end

        def manual_placement?(placement_id)
          @operations.any? do |operation|
            operation.provenance['sourceKind'] == 'manualHardwarePlacement' &&
              operation.provenance['hardwarePlacementId'] == placement_id
          end
        end
      end
    end
  end
end
