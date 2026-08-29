# frozen_string_literal: true

module Granete
  module SketchUpExtension
    module Selection
      # One legal action in a selection context: its identifier (internal
      # English), whether the plugin supports it TODAY and, when unsupported,
      # the Spanish explanation of why and how to resolve it. A capability is
      # computed from semantic context + definition/domain data — never
      # guessed from furniture names, slot ids or roles.
      class Capability
        attr_reader :name, :reason

        def initialize(name, supported:, reason: nil)
          @name = name
          @supported = supported
          @reason = supported ? nil : reason
        end

        def supported?
          @supported
        end

        def to_h
          { 'supported' => @supported, 'reason' => @reason }
        end
      end

      # The capability set a SelectionContext exposes to the inspector. Only
      # capabilities applicable to the context kind are declared: an absent
      # capability means "not applicable here", while an unsupported one is
      # present with its explanation. Downstream features (#466/#467/#468/
      # #470/#471) read this set instead of inferring legality client-side.
      class CapabilitySet
        include Enumerable

        def initialize
          @capabilities = {}
        end

        def declare(name, supported:, reason: nil)
          @capabilities[name] = Capability.new(name, supported: supported, reason: reason)
          self
        end

        def each(&)
          @capabilities.each_value(&)
        end

        def [](name)
          @capabilities[name]
        end

        def supported?(name)
          capability = @capabilities[name]
          !capability.nil? && capability.supported?
        end

        def to_h
          @capabilities.transform_values(&:to_h)
        end
      end
    end
  end
end
