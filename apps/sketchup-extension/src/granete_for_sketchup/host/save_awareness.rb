# frozen_string_literal: true

require 'json'

module Granete
  module SketchUpExtension
    module Host
      # In-memory indication that a server-synchronized host mutation still
      # needs the user to save the SketchUp document. It never writes model
      # attributes, so acknowledging a real save cannot dirty the document.
      class SaveAwareness
        def initialize(binding_store_factory:)
          @binding_store_factory = binding_store_factory
          @pending = {}.compare_by_identity
        end

        def mark_synced(model)
          binding = binding_for(model)
          return projection(model) unless binding

          @pending[model] = binding_snapshot(binding)
          projection(model)
        end

        def record_post_save(model)
          @pending.delete(model)
          projection(model)
        end

        def projection(model)
          binding = binding_for(model)
          current = binding && binding_snapshot(binding)
          {
            'needsSave' => !current.nil? && @pending[model] == current,
            'projectId' => binding&.project_id,
            'designId' => binding&.design_id,
            'baseRevisionId' => binding&.base_revision_id
          }.compact
        end

        private

        def binding_for(model)
          return nil unless model

          factory = @binding_store_factory
          store = factory.arity.zero? ? factory.call : factory.call(model)
          store.read
        rescue StandardError
          nil
        end

        def binding_snapshot(binding)
          JSON.generate(binding.to_h.sort.to_h)
        end
      end

      class SaveAwarenessModelObserver < (defined?(::Sketchup::ModelObserver) ? ::Sketchup::ModelObserver : Object)
        def initialize(state:, on_change: nil)
          super() if defined?(::Sketchup::ModelObserver)
          @state = state
          @on_change = on_change
        end

        def onPostSaveModel(model)
          @state.record_post_save(model)
          @on_change&.call(:saved, model)
        rescue StandardError
          nil
        end
      end

      # Persistent application-level observer lifecycle. Unlike the dialog's
      # selection observer, this remains attached while the dialog is closed.
      # The Runtime's single AppLifecycleObserver forwards document changes
      # into #rebind so the extension never stacks competing app observers.
      class SaveAwarenessLifecycle
        def initialize(model_provider:, state:, on_change: nil, logger: nil)
          @model_provider = model_provider
          @state = state
          @on_change = on_change
          @logger = logger
        end

        def start
          return self if @model_observer

          @model_observer = SaveAwarenessModelObserver.new(state: @state, on_change: @on_change)
          rebind(@model_provider.call)
          self
        end

        def shutdown
          detach_model
          @model_observer = nil
          self
        end

        def rebind(model)
          unless @observed_model.equal?(model)
            detach_model
            @observed_model = model
            @observed_model.add_observer(@model_observer) if @observed_model.respond_to?(:add_observer)
          end
          @on_change&.call(:model_changed, model)
        rescue StandardError => e
          @logger&.error('save_awareness_rebind_failed', error: e)
        end

        private

        def detach_model
          @observed_model.remove_observer(@model_observer) if
            @observed_model.respond_to?(:remove_observer) && @model_observer
          @observed_model = nil
        end
      end
    end
  end
end
