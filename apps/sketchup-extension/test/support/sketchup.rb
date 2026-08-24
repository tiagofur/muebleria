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


  class FaceStub
    def pushpull(distance)
      true
    end
  end

  class GroupStub
    attr_accessor :name
    attr_reader :entities, :attributes

    def initialize(name = "")
      @name = name
      @entities = EntitiesStub.new
      @attributes = {}
    end

    def set_attribute(dictionary, key, value)
      @attributes[[dictionary, key]] = value
    end

    def get_attribute(dictionary, key)
      @attributes[[dictionary, key]]
    end
  end

  class EntitiesStub
    attr_reader :groups, :faces

    def initialize
      @groups = []
      @faces = []
    end

    def add_group
      group = GroupStub.new
      @groups << group
      group
    end

    def add_face(points)
      face = FaceStub.new
      @faces << face
      face
    end
  end

  class ModelStub
    attr_reader :active_entities, :operations

    def initialize
      @active_entities = EntitiesStub.new
      @operations = []
    end

    def start_operation(name, disable_ui)
      @operations << [:start, name, disable_ui]
    end

    def commit_operation
      @operations << :commit
    end

    def abort_operation
      @operations << :abort
    end
  end

  class << self
    attr_reader :loaded_files, :menus, :observers, :registered_extensions, :active_model

    def reset!
      @loaded_files = {}
      @menus = Hash.new { |hash, key| hash[key] = Menu.new }
      @observers = []
      @registered_extensions = []
      @active_model = ModelStub.new
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

  def self.active_model
    SketchupStub.active_model
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
