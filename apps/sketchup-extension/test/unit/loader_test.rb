# frozen_string_literal: true

require 'pathname'
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
    assert_equal Granete::SketchUpExtension::EXTENSION_VERSION, extension.version
  end

  # #1254: runtime files talk to each other by bare constant (the ownership
  # boundary forbids require_relative), so a file missing from main.rb's
  # Sketchup.require list fails only inside SketchUp at boot — e.g. the
  # silent NameError that froze the library pin on 0.3.5. Every runtime
  # file except main itself must be listed.
  def test_loader_list_covers_every_runtime_file
    main_path = File.join(PROJECT_ROOT, 'src', 'granete_for_sketchup', 'main.rb')
    listed = File.read(main_path)[/%w\[(.*?)\]/m, 1].split

    runtime_dir = File.join(PROJECT_ROOT, 'src', 'granete_for_sketchup')
    actual = Dir.glob(File.join(runtime_dir, '**', '*.rb')).map do |path|
      Pathname(path).relative_path_from(Pathname(runtime_dir)).to_s.delete_suffix('.rb')
    end - ['main']

    missing = actual - listed
    assert_empty missing, "runtime files absent from the main.rb load list: #{missing.join(', ')}"
  end
end
