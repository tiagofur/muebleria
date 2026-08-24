# frozen_string_literal: true

require 'sketchup'

module Granete
  module SketchUpExtension
    support_path = __dir__.dup
    support_path.force_encoding('UTF-8')

    unless file_loaded?(__FILE__)
      %w[
        identity
        logging
        auth/provider
        transport/adapter
        metadata/store
        ui/dialog_controller
        lifecycle
        application
        runtime
      ].each do |relative_path|
        Sketchup.require(File.join(support_path, relative_path))
      end

      Runtime.start
      file_loaded(__FILE__)
    end
  end
end
