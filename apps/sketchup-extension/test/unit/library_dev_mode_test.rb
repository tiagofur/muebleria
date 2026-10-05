# frozen_string_literal: true

require 'json'

require_relative '../test_helper'
require_relative '../../src/granete_for_sketchup/library/library_store'

# #1102 restante 2: the bibliotecario dev-mode flag — persists in the
# LibraryStore dir and gates the consumer pin/boot sync wiring in
# Application (the flag itself is store-owned so any wiring can read it).
class LibraryDevModeTest < Minitest::Test
  def build_store
    Granete::SketchUpExtension::Library::LibraryStore.new(
      store_dir: File.join(Dir.mktmpdir, 'LibraryStore')
    )
  end

  def test_defaults_to_off
    refute build_store.dev_mode?
  end

  def test_persists_on_and_off_roundtrip
    store = build_store

    store.set_dev_mode!(true)
    assert store.dev_mode?

    store.set_dev_mode!(false)
    refute store.dev_mode?
  end

  def test_flag_file_is_scoped_to_this_store_dir
    a = build_store
    b = build_store

    a.set_dev_mode!(true)

    assert a.dev_mode?
    refute b.dev_mode?
  end
end
