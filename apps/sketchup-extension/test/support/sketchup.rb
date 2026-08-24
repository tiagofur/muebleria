# frozen_string_literal: true

module SketchupStub
  class Menu
    attr_reader :items

    def initialize
      @items = []
    end

    def add_item(label, &block)
      @items << [label, block]
      @items.length
    end
  end

  class << self
    attr_reader :loaded_files, :menus, :observers, :registered_extensions

    def reset!
      @loaded_files = {}
      @menus = Hash.new { |hash, key| hash[key] = Menu.new }
      @observers = []
      @registered_extensions = []
      UI::HtmlDialog.reset! if defined?(UI::HtmlDialog)
    end
  end

  reset!
end

def file_loaded?(path)
  SketchupStub.loaded_files.key?(File.expand_path(path))
end

def file_loaded(path)
  SketchupStub.loaded_files[File.expand_path(path)] = true
end

module Sketchup
  # The real host API declares AppObserver as a class (observers subclass it).
  class AppObserver # rubocop:disable Lint/EmptyClass
  end

  def self.register_extension(extension, enabled)
    SketchupStub.registered_extensions << [extension, enabled]
  end

  def self.require(path)
    Kernel.require("#{path}.rb")
  end

  def self.add_observer(observer)
    SketchupStub.observers << observer
  end

  def self.remove_observer(observer)
    SketchupStub.observers.delete(observer)
  end
end

module UI
  def self.menu(name)
    SketchupStub.menus[name]
  end

  class HtmlDialog
    STYLE_DIALOG = 1
    # The real host reports CEF versions as strings (e.g. "137.0.7151.121").
    CEF_VERSION = '137.0.7151.121'

    class << self
      attr_reader :instances

      def reset!
        @instances = []
      end
    end

    reset!

    attr_reader :callbacks, :executed_scripts, :file, :properties

    def initialize(properties)
      @properties = properties
      @callbacks = {}
      @executed_scripts = []
      @visible = false
      self.class.instances << self
    end

    def add_action_callback(name, &block)
      @callbacks[name] = block
    end

    def bring_to_front
      @brought_to_front = true
    end

    def close
      @visible = false
      @on_closed&.call
      @callbacks.clear
    end

    def execute_script(script)
      @executed_scripts << script
    end

    # Mirrors the exact SketchUp HtmlDialog API name.
    def set_file(path) # rubocop:disable Naming/AccessorMethodName
      @file = path
    end

    def set_on_closed(&block)
      @on_closed = block
    end

    def show
      @visible = true
    end

    def visible?
      @visible
    end
  end
end
