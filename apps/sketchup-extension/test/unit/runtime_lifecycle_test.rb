# frozen_string_literal: true

require_relative '../test_helper'

# Boots the real support entrypoint (composition root) exactly as the host
# would after enabling the installed extension.
require_relative '../../src/granete_for_sketchup/main'

class RuntimeLifecycleTest < Minitest::Test
  def setup
    SketchupStub.reset!
    Granete::SketchUpExtension::Runtime.reset!
  end

  def teardown
    Granete::SketchUpExtension::Runtime.reset!
  end

  def test_start_registers_one_host_observer_bound_to_this_extension
    Granete::SketchUpExtension::Runtime.start

    assert_equal 1, SketchupStub.observers.length
    observer = SketchupStub.observers.first
    assert_equal 'Granete for SketchUp', observer.extension_name
    assert_equal 'granete_for_sketchup', observer.extension_id
  end

  def test_repeated_start_does_not_stack_observers
    Granete::SketchUpExtension::Runtime.start
    Granete::SketchUpExtension::Runtime.start

    assert_equal 1, SketchupStub.observers.length
  end

  def test_start_returns_the_same_application
    application = Granete::SketchUpExtension::Runtime.start

    assert_same application, Granete::SketchUpExtension::Runtime.start
    assert_same application, Granete::SketchUpExtension::Runtime.application
  end

  def test_host_unload_notification_shuts_the_session_down_and_deregisters
    Granete::SketchUpExtension::Runtime.start
    application = Granete::SketchUpExtension::Runtime.application
    application.open_dialog

    SketchupStub.observers.first.onUnloadExtension('Granete for SketchUp')

    refute application.started?
    refute UI::HtmlDialog.instances.first.visible?
    assert_empty SketchupStub.observers
  end

  def test_host_unload_notification_accepts_the_technical_extension_id
    Granete::SketchUpExtension::Runtime.start

    SketchupStub.observers.first.onUnloadExtension('granete_for_sketchup')

    refute Granete::SketchUpExtension::Runtime.application.started?
  end

  def test_unrelated_extension_unload_is_ignored
    Granete::SketchUpExtension::Runtime.start

    SketchupStub.observers.first.onUnloadExtension('Another Extension')

    assert Granete::SketchUpExtension::Runtime.application.started?
  end

  def test_shutdown_without_start_is_safe
    Granete::SketchUpExtension::Runtime.shutdown

    assert_nil Granete::SketchUpExtension::Runtime.application
    assert_empty SketchupStub.observers
  end
end
