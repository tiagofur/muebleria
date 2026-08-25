# frozen_string_literal: true

# rubocop:disable all

module Geom
  class Point3d
    attr_reader :x, :y, :z

    def initialize(x_pos = 0, y_pos = 0, z_pos = 0)
      @x = x_pos
      @y = y_pos
      @z = z_pos
    end
  end

  class Vector3d
    attr_reader :x, :y, :z

    def initialize(x_pos = 0, y_pos = 0, z_pos = 0)
      @x = x_pos
      @y = y_pos
      @z = z_pos
    end
  end

  class Transformation
    def self.translation(vector)
      new(vector)
    end

    def initialize(vector = nil)
      @vector = vector
    end
  end
end

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
    def pushpull(_distance)
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

  class ComponentDefinitionStub
    attr_accessor :name

    def initialize(name = "")
      @name = name
    end
  end

  class DefinitionListStub
    def initialize
      @definitions = {}
    end

    def load(path)
      name = File.basename(path, ".*")
      @definitions[name] ||= ComponentDefinitionStub.new(name)
    end
  end

  class SelectionStub
    attr_reader :items, :observers

    def initialize
      @items = []
      @observers = []
    end

    def add(entity)
      @items << entity
      notify_change
    end

    def clear
      @items.clear
      notify_cleared
    end

    def first
      @items.first
    end

    def add_observer(observer)
      @observers << observer
    end

    def remove_observer(observer)
      @observers.delete(observer)
    end

    private

    def notify_change
      @observers.each { |o| o.onSelectionBulkChange(self) if o.respond_to?(:onSelectionBulkChange) }
    end

    def notify_cleared
      @observers.each { |o| o.onSelectionCleared(self) if o.respond_to?(:onSelectionCleared) }
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

    def add_face(_points)
      face = FaceStub.new
      @faces << face
      face
    end

    def add_instance(definition, _transform)
      group = GroupStub.new(definition.name)
      @groups << group
      group
    end

    def clear!
      @groups.clear
      @faces.clear
    end

    def erase_entities(entities)
      Array(entities).each do |entity|
        @groups.delete(entity)
        @faces.delete(entity)
      end
    end
  end

  class ModelStub
    attr_reader :active_entities, :operations, :selection, :definitions

    def initialize
      @active_entities = EntitiesStub.new
      @selection = SelectionStub.new
      @definitions = DefinitionListStub.new
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
    attr_accessor :preferences

    def reset!
      @loaded_files = {}
      @menus = Hash.new { |hash, key| hash[key] = Menu.new }
      @observers = []
      @registered_extensions = []
      @active_model = ModelStub.new
      @preferences = Hash.new { |hash, key| hash[key] = {} }
      UI::HtmlDialog.reset! if defined?(UI::HtmlDialog)
    end

    def read_default(namespace, key, default = nil)
      prefs = @preferences[namespace]
      prefs.key?(key) ? prefs[key] : default
    end

    def write_default(namespace, key, value)
      @preferences[namespace][key] = value
      value
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
  class AppObserver
  end

  class SelectionObserver
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

  def self.read_default(namespace, key, default = nil)
    SketchupStub.read_default(namespace, key, default)
  end

  def self.write_default(namespace, key, value)
    SketchupStub.write_default(namespace, key, value)
  end
end

module UI
  def self.menu(name)
    SketchupStub.menus[name]
  end

  class HtmlDialog
    STYLE_DIALOG = 1
    CEF_VERSION = "137.0.7151.121"

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

    def set_file(path)
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
