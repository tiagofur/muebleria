# frozen_string_literal: true

require_relative '../test_helper'

# Executes the packaged support entrypoint exactly as SketchUp would after
# installing the RBZ, proving the wiring itself: requires resolved, runtime
# started, menu registered, host observer attached. Removing Runtime.start or
# any support require from main.rb must break this test.
class WiringTest < Minitest::Test
  SOURCE_DIR = File.join(PROJECT_ROOT, 'src')

  def setup
    SketchupStub.reset!
    Granete::SketchUpExtension::Runtime.reset!
    $LOAD_PATH.unshift(SOURCE_DIR) unless $LOAD_PATH.include?(SOURCE_DIR)
    load File.join(SOURCE_DIR, 'granete_for_sketchup', 'main.rb')
  end

  def teardown
    Granete::SketchUpExtension::Runtime.reset!
  end

  def test_support_entrypoint_boots_the_runtime
    assert_equal 1, SketchupStub.menus['Extensions'].items.length
    assert_equal 'Abrir Granete', SketchupStub.menus['Extensions'].items.first.first
    assert_equal 1, SketchupStub.observers.length
    assert Granete::SketchUpExtension::Runtime.application.started?
  end

  def test_support_entrypoint_is_idempotent_per_session
    load File.join(SOURCE_DIR, 'granete_for_sketchup', 'main.rb')

    assert_equal 1, SketchupStub.menus['Extensions'].items.length
    assert_equal 1, SketchupStub.observers.length
  end
end
