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
        auth/session_provider
        transport/adapter
        transport/http_adapter
        metadata/store
        library/catalog_parameter_contract
        library/catalog_provider
        library/layout_contract
        library/authoring_resolve_contract
        assets/asset_resolver
        assets/asset_loader
        assets/texture_cache
        assets/media_authorizer
        model/furniture_builder
        migration/scanner
        migration/migrator
        selection/capabilities
        selection/capability_reasons
        selection/selection_context
        selection/capability_policy
        selection/resolver
        observers/selection_observer
        ui/option_selector_controller
        ui/migration_review_controller
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
