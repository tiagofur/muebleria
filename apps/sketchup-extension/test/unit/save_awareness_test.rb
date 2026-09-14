# frozen_string_literal: true

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/connection/model_binding'
require_relative '../../src/granete_for_sketchup/host/save_awareness'

class SaveAwarenessTest < Minitest::Test
  PROJECT_ID = '41000000-0000-0000-0000-000000000001'
  DESIGN_ID = '52000000-0000-0000-0000-000000000001'
  REVISION_ID = '53000000-0000-0000-0000-000000000001'

  def setup
    SketchupStub.reset!
    @model = SketchupStub.active_model
    write_binding(@model)
    @state = Granete::SketchUpExtension::Host::SaveAwareness.new(
      binding_store_factory: ->(model) { binding_store(model) }
    )
  end

  def test_synced_mutation_is_visible_and_only_post_save_clears_it
    operations = @model.operations.dup
    attributes = @model.attributes.dup

    assert_equal true, @state.mark_synced(@model)['needsSave']
    assert_equal operations, @model.operations
    assert_equal attributes, @model.attributes

    observer = Granete::SketchUpExtension::Host::SaveAwarenessModelObserver.new(state: @state)
    observer.onPostSaveModel(@model)
    assert_equal false, @state.projection(@model)['needsSave']
    assert_equal operations, @model.operations
    assert_equal attributes, @model.attributes

    assert_equal true, @state.mark_synced(@model)['needsSave'], 'a later synced mutation must show again'
  end

  def test_pending_state_is_scoped_to_the_exact_binding_snapshot
    @state.mark_synced(@model)
    write_binding(@model, base: '53000000-0000-0000-0000-000000000002')

    assert_equal false, @state.projection(@model)['needsSave']
  end

  def test_lifecycle_stays_attached_and_follows_activated_models_without_polling
    events = []
    lifecycle = Granete::SketchUpExtension::Host::SaveAwarenessLifecycle.new(
      model_provider: -> { SketchupStub.active_model }, state: @state,
      on_change: ->(event, model) { events << [event, model] }
    )
    lifecycle.start
    assert_empty SketchupStub.observers
    assert_equal 1, @model.observers.length

    other = SketchupStub::ModelStub.new
    write_binding(other)
    SketchupStub.active_model = other
    lifecycle.rebind(other)
    assert_empty @model.observers
    assert_equal 1, other.observers.length
    assert_includes events, [:model_changed, other]

    @state.mark_synced(other)
    other.notify_post_save
    assert_equal false, @state.projection(other)['needsSave']
    assert_includes events, [:saved, other]

    lifecycle.shutdown
    assert_empty other.observers
  end

  private

  def binding_store(model)
    Granete::SketchUpExtension::Connection::ModelBinding::Store.new(model)
  end

  def write_binding(model, base: REVISION_ID)
    binding_store(model).write!(
      Granete::SketchUpExtension::Connection::ModelBinding::Binding.new(
        project_id: PROJECT_ID, design_id: DESIGN_ID, base_revision_id: base
      )
    )
  end
end
