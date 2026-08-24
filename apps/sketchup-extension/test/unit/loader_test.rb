# frozen_string_literal: true

require_relative '../test_helper'

class LoaderTest < Minitest::Test
  LOADER_PATH = File.join(PROJECT_ROOT, 'src', 'granete_for_sketchup.rb')

  def setup
    SketchupStub.reset!
  end

  def test_registers_once_with_literal_metadata
    load LOADER_PATH
    load LOADER_PATH

    assert_equal 1, SketchupStub.registered_extensions.length

    extension, enabled = SketchupStub.registered_extensions.first
    assert enabled
    assert_equal 'Granete for SketchUp', extension.name
    assert_equal 'granete_for_sketchup/main', extension.loader
    assert_equal '0.1.0', extension.version
  end
end
