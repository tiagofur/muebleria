# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      class NestedOperationError < StandardError; end

      # Proxy given to commands during apply_accepted_state.
      # Commands cannot start, commit, or abort transactions;
      # the coordinator owns the transaction lifecycle.
      class CommandHostContext
        def initialize(model, journal)
          @model = model
          @journal = journal
        end

        def start_operation(*)
          raise NestedOperationError,
                'el comando no puede iniciar operaciones; la transacción es propiedad del coordinador'
        end

        def commit_operation(*)
          raise NestedOperationError,
                'el comando no puede commitear operaciones; la transacción es propiedad del coordinador'
        end

        def abort_operation(*)
          raise NestedOperationError,
                'el comando no puede abortar operaciones; la transacción es propiedad del coordinador'
        end

        def record_operation(*)
          raise NestedOperationError,
                'el comando no puede gestionar operaciones; la transacción es propiedad del coordinador'
        end

        def respond_to_missing?(method_name, include_private = false)
          return true if %i[start_operation commit_operation abort_operation record_operation].include?(method_name)

          @model.respond_to?(method_name, include_private) || super
        end

        def method_missing(method_name, *, &)
          if @model.respond_to?(method_name)
            @model.public_send(method_name, *, &)
          else
            super
          end
        end
      end

      # One SketchUp operation per accepted mutation (#498 / native entity
      # model §14): the journal wraps the model so every start/commit/abort
      # inside a mutation is counted and enforced.
      # The coordinator owns the transaction lifecycle (start, commit, abort);
      # commands receive host_context which forbids transaction management.
      # Internal state strictly follows host success: counters and flags are
      # only updated after SketchUp host operations succeed.
      class OperationJournal
        attr_reader :started_count, :committed_count, :aborted_count

        def initialize(model)
          @model = model
          @started_count = 0
          @committed_count = 0
          @aborted_count = 0
          @open = false
        end

        def host_context
          @host_context ||= CommandHostContext.new(@model, self)
        end

        def open?
          @open
        end

        # rubocop:disable-next Style/OptionalBooleanParameter, SketchupPerformance/OperationDisableUI
        def start_operation(name = 'Granete', ui_flag = true)
          raise NestedOperationError, 'una mutación aceptada debe ser UNA operación SketchUp' if @open

          result = @model.start_operation(name, ui_flag)
          @open = true
          @started_count += 1
          result
        end

        def commit_operation
          return false unless @open

          begin
            result = @model.commit_operation
            if result == false
              begin
                abort_operation
              rescue StandardError
                nil
              end
              raise StandardError, 'el host no pudo commitear la operación'
            end
            @open = false
            @committed_count += 1
            result
          rescue StandardError
            begin
              abort_operation
            rescue StandardError
              nil
            end
            raise
          end
        end

        def abort_operation
          return false unless @open

          begin
            @model.abort_operation
          ensure
            @open = false
            @aborted_count += 1
          end
        end

        # Failure-path helper: abort only when an operation is actually open,
        # so a raise before start_operation can never abort an unrelated
        # user operation.
        def abort_if_open!
          abort_operation if @open
          nil
        end

        def respond_to_missing?(method_name, include_private = false)
          @model.respond_to?(method_name, include_private) || super
        end

        def method_missing(method_name, *, &)
          if @model.respond_to?(method_name)
            @model.public_send(method_name, *, &)
          else
            super
          end
        end
      end
    end
  end
end
