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
    # #416: the Extensions menu carries the main entry plus the legacy
    # migration review entry.
    labels = SketchupStub.menus['Extensions'].items.map(&:first)
    assert_equal ['Abrir Granete', 'Migrar modelos anteriores…'], labels
    assert_equal 1, SketchupStub.observers.length
    assert Granete::SketchUpExtension::Runtime.application.started?
  end

  def test_toolbar_command_opens_the_dialog_with_packaged_icons
    toolbars = SketchupStub.toolbars
    assert_equal 1, toolbars.length
    command = toolbars.first.items.first
    refute_nil command

    command.call

    assert_equal 1, UI::HtmlDialog.instances.length, 'toolbar click must open the panel'
    icon_paths = [command.small_icon, command.large_icon].compact
    refute_empty icon_paths
    icon_paths.each { |path| assert File.exist?(path), "icon missing: #{path}" }
  end

  def test_support_entrypoint_is_idempotent_per_session
    load File.join(SOURCE_DIR, 'granete_for_sketchup', 'main.rb')

    labels = SketchupStub.menus['Extensions'].items.map(&:first)
    assert_equal ['Abrir Granete', 'Migrar modelos anteriores…'], labels
    assert_equal 1, SketchupStub.observers.length
  end
end
