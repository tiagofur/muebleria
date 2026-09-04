# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Overlay
      # Orchestrates the read-only manufacturing inspection mode (#470):
      # ON/OFF lifecycle, scope (selected managed part or furniture), the
      # authoritative inspection snapshot, CURRENT/STALE correlation with
      # the #498 accepted-state fingerprint, viewport projection and the
      # ephemeral tool.
      #
      # Invariants:
      #   - enabling/disabling/refreshing the overlay NEVER opens a SketchUp
      #     operation, creates entities or writes metadata: turning it OFF
      #     leaves the productive model byte/semantically unchanged;
      #   - the only machining truth drawn is the accepted #477 resolve;
      #     a snapshot whose correlation does not match the current fetch is
      #     discarded (a late F1 can never overwrite a newer F2);
      #   - after a manufacturing-affecting mutation of the scoped furniture
      #     the overlay refreshes from the new accepted fingerprint or shows
      #     STALE — never the old truth as current.
      class Manager
        MODES = %w[off on].freeze
        STATUSES = %w[off current stale unavailable].freeze
        FILTERS = %w[all holes].freeze

        attr_reader :mode, :scope, :active_feature_id, :filter, :unavailable_reason

        def initialize(resolver:, locator:, model_provider:, preflight_tracker:,
                       logger: nil, on_state_change: nil, on_viewport_selection: nil)
          @resolver = resolver
          @locator = locator
          @model_provider = model_provider
          @preflight_tracker = preflight_tracker
          @logger = logger
          @on_state_change = on_state_change
          @on_viewport_selection = on_viewport_selection
          @mode = 'off'
          @scope = nil
          @snapshot = nil
          @active_feature_id = nil
          @filter = 'all'
          @stale_reason = nil
          @unavailable_reason = nil
          @current_fetch_id = nil
          @tool = nil
          @entity_cache = {}
        end

        def mode_on?
          @mode == 'on'
        end

        def stale?
          status == 'stale'
        end

        # Honest status: 'off' | 'current' | 'stale' | 'unavailable'.
        # STALE wins when the #498 tracker holds a NEWER accepted
        # fingerprint for the scoped furniture or an explicit stale mark
        # exists — the overlay never presents outdated machining as current.
        def status
          return 'off' unless mode_on?

          return 'unavailable' if @snapshot.nil?

          return 'stale' if @stale_reason

          tracker_entry = tracker_entry_for_scope
          if tracker_entry && tracker_entry.fingerprint &&
             tracker_entry.fingerprint != @snapshot.manufacturing_fingerprint
            return 'stale'
          end

          'current'
        end

        # Turns inspection ON for a scope (CommandContract semantic target of
        # the selected managed furniture/part). Resolves authoritatively and
        # activates the ephemeral tool; a resolve failure is an honest
        # UNAVAILABLE state, never a guessed overlay.
        def enable(scope)
          scope = normalize_scope(scope)
          raise ArgumentError, 'scope sin identidad de mueble gestionado' if scope.empty?

          @mode = 'on'
          @scope = scope
          @stale_reason = nil
          @unavailable_reason = nil
          @active_feature_id = nil
          refresh(tool: :push)
        end

        def disable
          @mode = 'off'
          @snapshot = nil
          @stale_reason = nil
          @unavailable_reason = nil
          @active_feature_id = nil
          @entity_cache = {}
          pop_tool
          invalidate_view
          notify_state_change
        end

        # Selection changed while ON: re-scope. Same furniture → only the
        # part filter moves (no re-resolve needed: the snapshot covers the
        # whole furniture); different furniture or no managed selection →
        # clear/disable honestly.
        def rescope(new_scope)
          return unless mode_on?

          normalized = normalize_scope(new_scope)
          if normalized.empty?
            @snapshot = nil
            @unavailable_reason = 'Seleccioná una pieza administrada para inspeccionar fabricación'
            @active_feature_id = nil
            notify_state_change
            return
          end

          same_furniture = furniture_key_of(normalized) == furniture_key_of(@scope)
          if same_furniture
            @scope = normalized
            @active_feature_id = nil
            invalidate_view
            notify_state_change
          else
            enable(normalized)
          end
        end

        def select_feature(visual_id)
          return unless mode_on? && @snapshot

          feature = @snapshot.feature_by_visual_id(visual_id)
          @active_feature_id = feature ? visual_id : nil
          invalidate_view
          notify_state_change
        end

        def set_filter(filter)
          return unless FILTERS.include?(filter)

          @filter = filter
          @active_feature_id = nil
          invalidate_view
          notify_state_change
        end

        # Marks the overlay as stale without dropping the snapshot: the
        # markers stay visible but dimmed and the dialog says so (#470 §32).
        def mark_stale(reason = 'un cambio de fabricación comenzó')
          return unless mode_on? && @snapshot

          @stale_reason = reason
          invalidate_view
          notify_state_change
        end

        # Re-resolves authoritatively. Success replaces the snapshot (F2);
        # failure keeps the previous one marked stale/unavailable — never a
        # local recalculation.
        def refresh(tool: :none)
          return unless mode_on?

          furniture_entity = @locator.locate_furniture(@scope || {})
          if furniture_entity.nil?
            @unavailable_reason = 'El mueble inspeccionado ya no está en el modelo'
            @snapshot = nil
            notify_state_change
            return
          end

          @current_fetch_id = next_fetch_id
          fetch_id = @current_fetch_id
          resolved = @resolver.resolve(furniture_entity: furniture_entity, model: @model_provider.call)
          apply_snapshot(resolved[:result], resolved[:message_id], fetch_id: fetch_id)
          push_tool if tool == :push && @tool.nil?
        rescue Library::AuthoringResolveError, Library::LayoutResolutionError,
               Library::AuthoringResolveContract::ContractError => e
          @logger&.warn('manufacturing_inspection_resolve_failed', error: e.message)
          if @snapshot
            # The previous truth stays visible but honestly marked STALE —
            # never silently current, never locally recomputed (#470 §32).
            @stale_reason = e.message
          else
            @unavailable_reason = e.message
          end
          notify_state_change
        end

        # Late-response guard (#470 §34): only the snapshot of the CURRENT
        # fetch may become state; an answer for an older correlation is
        # discarded instead of overwriting newer truth.
        def apply_snapshot(result, message_id, fetch_id: nil)
          return if fetch_id && @current_fetch_id && fetch_id != @current_fetch_id

          @snapshot = InspectionSnapshot.new(scope: @scope, result: result, message_id: message_id)
          @stale_reason = nil
          @unavailable_reason = nil
          @entity_cache = {}
          invalidate_view
          notify_state_change
        end

        # #498 hook: every mutation outcome touching the scoped furniture
        # invalidates the current overlay. A committed authoritative resolve
        # refreshes from the NEW fingerprint; anything else marks STALE.
        def handle_mutation_outcome(outcome)
          return unless mode_on? && @scope && outcome.respond_to?(:semantic_target)

          return unless same_furniture?(outcome.semantic_target)

          if outcome.committed? && outcome.resolve_kind == 'authoring_resolve'
            refresh
          else
            mark_stale('una mutación de autoría quedó sin resolver en el servidor')
          end
        end

        # A manufacturing-affecting mutation of the scoped furniture STARTED:
        # the current snapshot immediately stops being presentable as current
        # (#470 §32) — it stays visible but marked STALE until F2 arrives.
        def mutation_started(semantic_target)
          return unless mode_on? && @scope && same_furniture?(semantic_target)

          mark_stale('una mutación de fabricación está en curso')
        end

        # Viewport picking fell through to an entity: forward it (the dialog
        # bridge resolves the semantic context and re-scopes).
        def on_viewport_selection(entity)
          @on_viewport_selection&.call(entity)
        end

        # Features in scope for drawing: snapshot features filtered by the
        # selected part (board-level inspection) and the active filter.
        def scoped_features
          return [] unless @snapshot && mode_on?

          features = @snapshot.features
          features = features_for_selected_part(features) if part_scoped?
          features = features.select { |feature| feature.kind == 'hole' } if @filter == 'holes'
          features
        end

        def snapshot
          @snapshot
        end

        def feature_by_projected_id(visual_id)
          @snapshot&.feature_by_visual_id(visual_id)
        end

        # World-space markers for the current frame. Transforms are read LIVE
        # from the model so moved/rotated furniture is followed exactly; only
        # the entity lookup is cached per snapshot/scope.
        def projected_features
          return [] unless @snapshot && mode_on?

          scoped_features.filter_map do |feature|
            board = @snapshot.board_for(feature.host_component_instance_id)
            transforms = world_transforms_for(feature.host_component_instance_id)
            next nil unless board && transforms

            FeatureProjector.project(feature, board: board,
                                            part_transform: transforms[:part],
                                            furniture_transform: transforms[:furniture])
          end
        end

        def to_payload
          {
            'mode' => @mode,
            'status' => status,
            'staleReason' => @stale_reason,
            'unavailableReason' => @unavailable_reason,
            'filter' => @filter,
            'scope' => @scope ? @scope.dup : nil,
            'fingerprint' => @snapshot&.manufacturing_fingerprint,
            'catalogRevision' => @snapshot&.catalog_revision,
            'messageId' => @snapshot&.message_id,
            'activeFeatureId' => @active_feature_id,
            'featureCount' => scoped_features.length,
            'hostCount' => scoped_features.map(&:host_component_instance_id).uniq.length,
            'features' => scoped_features.map(&:to_payload)
          }
        end

        private

        def normalize_scope(scope)
          scope.to_h.select do |key, value|
            Host::CommandContract::SEMANTIC_TARGET_KEYS.include?(key) &&
              value.is_a?(String) && !value.strip.empty?
          end
        end

        def furniture_key_of(scope)
          scope ? [scope['furnitureInstanceId'], scope['furnitureInstanceRef']].compact : []
        end

        def same_furniture?(semantic_target)
          !furniture_key_of(semantic_target).empty? &&
            furniture_key_of(semantic_target) == furniture_key_of(@scope)
        end

        def part_scoped?
          @scope && @scope['componentInstanceId']
        end

        def features_for_selected_part(features)
          features.select { |feature| feature.host_component_instance_id == @scope['componentInstanceId'] }
        end

        def tracker_entry_for_scope
          return nil unless @preflight_tracker && @scope

          key = Host::CommandContract.semantic_target_key(
            @scope.slice('furnitureInstanceId', 'furnitureInstanceRef')
          )
          entry = @preflight_tracker.state_for(key)
          return nil unless entry && entry != 'unknown'

          fingerprint = @preflight_tracker.payload_for(key).first&.[]('fingerprint')
          Struct.new(:state, :fingerprint).new(entry, fingerprint)
        end

        def world_transforms_for(component_instance_id)
          cached = @entity_cache[component_instance_id]
          root = cached ? cached[:root] : @locator.locate_furniture(@scope || {})
          return nil unless root.respond_to?(:transformation)

          part = if cached && cached[:part]&.respond_to?(:transformation)
                   cached[:part]
                 else
                   located = @locator.locate_child(root, component_instance_id)
                   @entity_cache[component_instance_id] = { root: root, part: located } if located
                   located
                 end
          return nil unless part.respond_to?(:transformation)

          { furniture: root.transformation, part: part.transformation }
        rescue StandardError
          # Erased/regenerated entities leave dead references: the marker
          # simply stops drawing until the next snapshot refresh.
          nil
        end

        def push_tool
          model = @model_provider.call
          @tool = InspectionTool.new(self)
          if model.respond_to?(:select_tool)
            model.select_tool(@tool)
          elsif model.respond_to?(:tools) && model.tools.respond_to?(:push_tool)
            model.tools.push_tool(@tool)
          end
          invalidate_view
        end

        def pop_tool
          return unless @tool

          model = @model_provider.call
          if model.respond_to?(:select_tool)
            model.select_tool(nil)
          elsif model.respond_to?(:tools) && model.tools.respond_to?(:pop_tool)
            model.tools.pop_tool
          end
          @tool = nil
        end

        def invalidate_view
          model = @model_provider.call
          view = model.active_view if model.respond_to?(:active_view)
          view.invalidate if view.respond_to?(:invalidate)
        end

        def next_fetch_id
          @fetch_sequence = (@fetch_sequence || 0) + 1
        end

        def notify_state_change
          @on_state_change&.call(to_payload)
        rescue StandardError => e
          @logger&.warn('manufacturing_overlay_state_change_failed', error: e)
        end
      end
    end
  end
end
