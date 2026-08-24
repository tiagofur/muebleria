# frozen_string_literal: true

require 'extensions'
require 'sketchup'

support_path = __dir__.dup
support_path.force_encoding('UTF-8')

Sketchup.require(File.join(support_path, 'granete_for_sketchup', 'identity'))

module Granete
  module SketchUpExtension
    unless file_loaded?(__FILE__)
      extension = SketchupExtension.new(EXTENSION_NAME, 'granete_for_sketchup/main')
      extension.description = 'Conecta la autoría en SketchUp con Granete.'
      extension.version = EXTENSION_VERSION
      extension.creator = 'Granete'
      extension.copyright = 'Copyright 2026 Granete'

      Sketchup.register_extension(extension, true)
      file_loaded(__FILE__)
    end
  end
end
