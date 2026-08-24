# frozen_string_literal: true

class SketchupExtension
  attr_accessor :copyright, :creator, :description, :version
  attr_reader :loader, :name

  def initialize(name, loader)
    @name = name
    @loader = loader
  end
end
