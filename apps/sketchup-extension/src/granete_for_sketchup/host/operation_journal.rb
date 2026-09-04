# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Host
      class NestedOperationError < StandardError; end

      # One SketchUp operation per accepted mutation (#498 / native entity
      # model §14): the journal wraps the model so every start/commit/abort
      # inside a mutation is counted and enforced. A second start raises
      # (delete+rebuild+metadata as three undo steps is forbidden); aborting
      # without an open operation is a defensive no-op so failure paths can
      # never cascade. Everything else delegates to the wrapped model, which
      # is why FurnitureBuilder works unmodified on top of the journal.
      class OperationJournal
        attr_reader :started_count, :committed_count, :aborted_count

        def initialize(model)
          @model = model
          @started_count = 0
          @committed_count = 0
          @aborted_count = 0
          @open = false
        end

        def open?
          @open
        end

        def start_operation(name = 'Granete', ui_flag = true)
          raise NestedOperationError, 'una mutación aceptada debe ser UNA operación SketchUp' if @open

          @open = true
          @started_count += 1
          @model.start_operation(name, ui_flag)
        end

        def commit_operation
          return false unless @open

          @open = false
          @committed_count += 1
          @model.commit_operation
          true
        end

        def abort_operation
          return false unless @open

          @open = false
          @aborted_count += 1
          @model.abort_operation
          true
        end

        # Failure-path helper: abort only when an operation is actually open,
        # so a raise before start_operation can never abort an unrelated
        # user operation.
        def abort_if_open!
          abort_operation
          nil
        end

        def respond_to_missing?(method_name, include_private = false)
          @model.respond_to?(method_name, include_private) || super
        end

        def method_missing(method_name, *args, &block)
          if @model.respond_to?(method_name)
            @model.public_send(method_name, *args, &block)
          else
            super
          end
        end
      end
    end
  end
end
