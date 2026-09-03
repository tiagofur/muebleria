# frozen_string_literal: true

# rubocop:disable all

# Faithful-enough SketchUp API stub for unit tests. Models the host concepts
# the native entity model (#413/#415) depends on: ComponentDefinition vs
# ComponentInstance, definition-scoped entities, Geom::Transformation with
# axes/composition, per-entity attribute dictionaries, persistent_id and
# definition GUID locators, plus an undo journal so start/abort_operation
# rolls structural mutations back like the real host does.
module Geom
  Point3d = Struct.new(:x, :y, :z) do
    def to_a
      [x, y, z]
    end
  end

  Vector3d = Struct.new(:x, :y, :z) do
    def to_a
      [x, y, z]
    end
  end

  # 4x4 rigid transform, row-major like SketchUp's to_a:
  # [Xx Yx Zx Tx  Xy Yy Zy Ty  Xz Yz Zz Tz  0 0 0 1]
  # (a * b) applies b first, then a — SketchUp composition semantics.
  class Transformation
    attr_reader :matrix

    def self.identity
      new
    end

    def self.translation(vector)
      t = new
      t.matrix[3] = vector.x.to_f
      t.matrix[7] = vector.y.to_f
      t.matrix[11] = vector.z.to_f
      t
    end

    # Maps the local axes onto xaxis/yaxis/zaxis with the given origin:
    # world_point = origin + xaxis·local_x + yaxis·local_y + zaxis·local_z.
    def self.axes(origin, xaxis, yaxis, zaxis)
      t = new
      t.set_column(0, xaxis)
      t.set_column(1, yaxis)
      t.set_column(2, zaxis)
      t.matrix[3] = origin.x.to_f
      t.matrix[7] = origin.y.to_f
      t.matrix[11] = origin.z.to_f
      t
    end

    def initialize
      @matrix = [1.0, 0.0, 0.0, 0.0,
                 0.0, 1.0, 0.0, 0.0,
                 0.0, 0.0, 1.0, 0.0,
                 0.0, 0.0, 0.0, 1.0]
      yield self if block_given?
    end

    def set_column(index, vector)
      @matrix[index] = vector.x.to_f
      @matrix[4 + index] = vector.y.to_f
      @matrix[8 + index] = vector.z.to_f
    end

    def [](row, col)
      @matrix[(row * 4) + col]
    end

    def to_a
      @matrix.dup
    end

    def origin
      Point3d.new(@matrix[3], @matrix[7], @matrix[11])
    end

    def xaxis
      Vector3d.new(@matrix[0], @matrix[4], @matrix[8])
    end

    def yaxis
      Vector3d.new(@matrix[1], @matrix[5], @matrix[9])
    end

    def zaxis
      Vector3d.new(@matrix[2], @matrix[6], @matrix[10])
    end

    def *(other)
      product = self.class.new
      4.times do |r|
        4.times do |c|
          sum = 0.0
          4.times { |k| sum += self[r, k] * other[k, c] }
          product.matrix[(r * 4) + c] = sum
        end
      end
      product
    end

    def transform(point)
      x = (self[0, 0] * point.x) + (self[0, 1] * point.y) + (self[0, 2] * point.z) + self[0, 3]
      y = (self[1, 0] * point.x) + (self[1, 1] * point.y) + (self[1, 2] * point.z) + self[1, 3]
      z = (self[2, 0] * point.x) + (self[2, 1] * point.y) + (self[2, 2] * point.z) + self[2, 3]
      Point3d.new(x, y, z)
    end

    def ==(other)
      return false unless other.is_a?(Transformation)

      to_a.zip(other.to_a).all? { |a, b| (a - b).abs <= 1e-9 }
    end

    def eql?(other)
      self == other
    end

    def hash
      to_a.map { |v| v.round(9) }.hash
    end
  end
end

# Host base classes so runtime `is_a?` guards behave exactly like the real
# API: in SketchUp a Group also responds to #definition, so entity TYPE is
# the only host-accurate native/legacy discriminator (#415/#416). Defined
# before the stubs so they can subclass; the Sketchup module below reopens
# this one with the rest of the host surface.
module Sketchup
  class ComponentInstance
  end

  class Group
  end

  def self.version
    '24.0.145-stub'
  end
end

module SketchupStub
  @entity_seq = 0
  @guid_seq = 0
  @undo_frames = []

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
    attr_accessor :normal
    attr_reader :points

    def initialize(points = [])
      @normal = Geom::Vector3d.new(0, 0, 1)
      @points = points
    end

    def reverse!
      @normal = Geom::Vector3d.new(-@normal.x, -@normal.y, -@normal.z)
      self
    end

    def pushpull(_distance)
      true
    end
  end

  class TextureStub
    attr_accessor :filename, :size, :width, :height

    def initialize(filename)
      @filename = filename
      @size = nil
      @width = nil
      @height = nil
    end
  end

  class MaterialStub
    attr_accessor :color
    attr_reader :texture

    def initialize(name)
      @name = name
      @color = nil
      @texture = nil
    end

    def texture=(path)
      @texture = path ? TextureStub.new(path) : nil
    end

    def name
      @name
    end
  end

  class MaterialsStub
    attr_reader :materials

    def initialize
      @materials = {}
    end

    def [](name)
      @materials[name]
    end

    def add(name)
      material = MaterialStub.new(name)
      @materials[name] = material
      material
    end
  end

  module AttributeContainer
    def attributes
      @attributes ||= {}
    end

    def set_attribute(dictionary, key, value)
      attribute_key = [dictionary, key]
      previous = attributes[attribute_key]
      existed = attributes.key?(attribute_key)
      SketchupStub.record_undo do
        existed ? attributes[attribute_key] = previous : attributes.delete(attribute_key)
      end
      attributes[attribute_key] = value
    end

    def get_attribute(dictionary, key)
      attributes[[dictionary, key]]
    end
  end

  class GroupStub < Sketchup::Group
    include AttributeContainer

    # Host-faithful: a real Group exposes its placement transformation
    # (#416 migration reads it to preserve the world placement).
    attr_accessor :name, :material, :transformation
    attr_reader :entities

    def initialize(name = "")
      super()
      @name = name
      @material = nil
      @entities = EntitiesStub.new
      @transformation = Geom::Transformation.new
    end

    # Host-faithful: a real SketchUp Group also wraps a ComponentDefinition,
    # so respond_to?(:definition) must never be used as a native check.
    def definition
      @group_definition ||= ComponentDefinitionStub.new(@name)
    end
  end

  class ComponentDefinitionStub
    include AttributeContainer

    attr_accessor :name
    attr_reader :entities, :instances, :guid

    def initialize(name = "")
      @name = name
      @entities = EntitiesStub.new
      @instances = []
      @guid = "su-def-guid-#{SketchupStub.next_guid}"
    end

    def add_instance(transform)
      instance = ComponentInstanceStub.new(self, transform)
      @instances << instance
      instance
    end

    def remove_instance(instance)
      @instances.delete(instance)
    end

    # Undo-journal re-registration: keeps instance object identity stable
    # across rollback instead of recreating objects.
    def add_instance_noreg(instance)
      @instances.push(instance) unless @instances.include?(instance)
    end
  end

  class ComponentInstanceStub < Sketchup::ComponentInstance
    include AttributeContainer

    attr_accessor :name, :material, :transformation
    attr_reader :definition, :persistent_id

    def initialize(definition, transform)
      super()
      @definition = definition
      @transformation = transform
      @name = ""
      @material = nil
      @persistent_id = SketchupStub.next_persistent_id
    end

    def valid?
      true
    end

    def model
      SketchupStub.active_model
    end

    # Host-faithful ComponentInstance#make_unique: isolate this instance from
    # any siblings that share its definition while preserving object identity
    # and transformation. The builder immediately replaces the copied contents,
    # so the stub only needs a distinct definition container.
    def make_unique
      return self if @definition.instances.length <= 1

      previous_definition = @definition
      unique_definition = SketchupStub.active_model.definitions.add(previous_definition.name)
      previous_definition.remove_instance(self)
      unique_definition.add_instance_noreg(self)
      @definition = unique_definition
      SketchupStub.record_undo do
        unique_definition.remove_instance(self)
        previous_definition.add_instance_noreg(self)
        @definition = previous_definition
      end
      self
    end
  end

  class DefinitionListStub
    include Enumerable

    def initialize
      @definitions = {}
    end

    def each(&block)
      @definitions.each_value(&block)
    end

    def [](name)
      @definitions[name]
    end

    def add(name)
      unique = unique_name(name)
      definition = ComponentDefinitionStub.new(unique)
      @definitions[unique] = definition
      SketchupStub.record_undo { @definitions.delete(unique) }
      definition
    end

    def unique_name(base_name)
      return base_name unless @definitions.key?(base_name)

      index = 2
      index += 1 while @definitions.key?("#{base_name} ##{index}")
      "#{base_name} ##{index}"
    end

    def remove(definition)
      name = definition.respond_to?(:name) ? definition.name : definition
      return false unless @definitions.key?(name)

      removed = @definitions[name]
      SketchupStub.record_undo { @definitions[name] = removed }
      @definitions.delete(name)
      true
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
    include Enumerable

    attr_reader :groups, :instances, :faces

    def initialize
      @groups = []
      @instances = []
      @faces = []
      @observers = []
    end

    def add_observer(observer)
      @observers << observer unless @observers.include?(observer)
    end

    def remove_observer(observer)
      @observers.delete(observer)
    end

    def each(&block)
      (@groups + @instances + @faces).each(&block)
    end

    def add(item)
      case item
      when GroupStub then @groups << item
      when ComponentInstanceStub then @instances << item
      when FaceStub then @faces << item
      end
      @observers.dup.each { |obs| obs.onElementAdded(self, item) if obs.respond_to?(:onElementAdded) }
      item
    end

    def add_group
      group = GroupStub.new
      SketchupStub.record_undo { @groups.delete(group) }
      @groups << group
      group
    end

    def add_face(points)
      face = FaceStub.new(points)
      SketchupStub.record_undo { @faces.delete(face) }
      @faces << face
      face
    end

    def add_instance(definition, transform)
      instance = definition.add_instance(transform)
      SketchupStub.record_undo do
        @instances.delete(instance)
        definition.remove_instance(instance)
      end
      @instances << instance
      instance
    end

    def clear!
      groups = @groups.dup
      instances = @instances.dup
      faces = @faces.dup
      parents = instances.map { |i| [i, i.definition] }
      SketchupStub.record_undo do
        @groups.replace(groups)
        @faces.replace(faces)
        @instances.replace(instances)
        parents.each { |instance, definition| definition.add_instance_noreg(instance) }
      end
      # detaching an instance from the scene also unregisters it from its
      # definition's live instance list, like the real host reports.
      instances.each { |instance| instance.definition.remove_instance(instance) }
      @groups.clear
      @instances.clear
      @faces.clear
      true
    end

    def erase_entities(entities)
      list = Array(entities)
      SketchupStub.record_undo do
        list.each do |entity|
          case entity
          when GroupStub then @groups.push(entity)
          when ComponentInstanceStub
            @instances.push(entity)
            entity.definition.add_instance_noreg(entity)
          when FaceStub then @faces.push(entity)
          end
        end
      end
      list.each do |entity|
        @groups.delete(entity)
        @instances.delete(entity)
        @faces.delete(entity)
        entity.definition.remove_instance(entity) if entity.is_a?(ComponentInstanceStub)
      end
      true
    end
  end

  class ModelStub
    attr_reader :active_entities, :selection, :definitions, :materials, :operations

    def initialize
      @active_entities = EntitiesStub.new
      @selection = SelectionStub.new
      @definitions = DefinitionListStub.new
      @materials = MaterialsStub.new
      @operations = []
    end

    def entities
      @active_entities
    end

    def start_operation(name, disable_ui = true)
      @operations << [:start, name, disable_ui]
      SketchupStub.begin_undo_frame
    end

    def commit_operation
      @operations << :commit
      SketchupStub.commit_undo_frame
    end

    def abort_operation
      @operations << :abort
      SketchupStub.abort_undo_frame
    end

    # #392 / DT-8 host export surface: save_copy writes a byte-identical
    # stub payload per model revision (never the user's document path), and
    # write_image produces a non-empty marker "image" so publish flows can
    # assert real files on disk.
    def save_copy(path)
      File.binwrite(path, "SKP-STUB-#{object_id}")
      true
    end

    def write_image(path, width = 640, height = 480, antialias = false, _compression = 0.0)
      File.binwrite(path, "PNG-STUB-#{width}x#{height}-#{antialias}")
      true
    end
  end

  class << self
    attr_reader :loaded_files, :menus, :observers, :registered_extensions, :toolbars,
                :send_actions
    attr_accessor :preferences, :active_model

    def reset!
      @loaded_files = {}
      @menus = Hash.new { |hash, key| hash[key] = Menu.new }
      @observers = []
      @registered_extensions = []
      @active_model = ModelStub.new
      @preferences = Hash.new { |hash, key| hash[key] = {} }
      @toolbars = []
      @send_actions = []
      @entity_seq = 0
      @guid_seq = 0
      @undo_frames = []
      UI::HtmlDialog.reset! if defined?(UI::HtmlDialog)
    end

    # --- undo journal: structural mutations roll back on abort_operation ---

    def begin_undo_frame
      @undo_frames << []
    end

    def commit_undo_frame
      @undo_frames.pop
    end

    def abort_undo_frame
      @undo_frames.pop&.reverse_each(&:call)
    end

    def record_undo(&block)
      @undo_frames.last&.push(block)
    end

    def next_persistent_id
      @entity_seq += 1
    end

    def next_guid
      @guid_seq += 1
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

  class EntitiesObserver
  end

  def self.register_extension(extension, enabled)
    SketchupStub.registered_extensions << [extension, enabled]
  end

  def self.send_action(action)
    SketchupStub.send_actions << action
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

  class Command
    attr_accessor :tooltip, :status_bar_text, :small_icon, :large_icon

    def initialize(_title, &block)
      @block = block
    end

    def call
      @block&.call
    end
  end

  class Toolbar
    attr_reader :name, :items

    def initialize(name)
      @name = name
      @items = []
      SketchupStub.toolbars << self
    end

    def add_item(command)
      @items << command
      command
    end

    def restore
      true
    end
  end

  class HtmlDialog
    STYLE_DIALOG = 1
    STYLE_WINDOW = 2
    STYLE_UTILITY = 3
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
