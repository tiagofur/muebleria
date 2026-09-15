# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Host
      # Pure SketchUp ModelObserver for transaction boundaries (MOVE, ROTATE,
      # UNDO, and REDO). It forwards host events to an injected delegate without
      # knowing about WorkingCopy or backend connections.
      class PositionSyncObserver < (defined?(::Sketchup::ModelObserver) ? ::Sketchup::ModelObserver : Object)
        def initialize(delegate)
          super() if defined?(::Sketchup::ModelObserver)
          @delegate = delegate
        end

        def onTransactionCommit(model)
          @delegate.on_transaction_commit(model) if @delegate.respond_to?(:on_transaction_commit)
        rescue StandardError
          nil
        end

        def onTransactionUndo(model)
          @delegate.on_transaction_undo(model) if @delegate.respond_to?(:on_transaction_undo)
        rescue StandardError
          nil
        end

        def onTransactionRedo(model)
          @delegate.on_transaction_redo(model) if @delegate.respond_to?(:on_transaction_redo)
        rescue StandardError
          nil
        end
      end
    end
  end
end
