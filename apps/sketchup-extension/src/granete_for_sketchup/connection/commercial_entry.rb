# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Connection
      module CommercialEntry
        module_function

        def build(transport:, auth_provider:, model_provider:, connector:, logger: SafeLogger.new)
          common = { transport: transport, auth_provider: auth_provider, logger: logger }
          {
            project_bootstrap: ProjectBootstrap::Coordinator.new(
              model_provider: model_provider,
              service: ProjectBootstrap::Service.new(**common), connector: connector, logger: logger
            ),
            initial_quote: InitialQuote::Coordinator.new(
              model_provider: model_provider, service: InitialQuote::Service.new(**common)
            )
          }
        end
      end
    end
  end
end
