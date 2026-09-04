# frozen_string_literal: true

# Loads the #470 / SU-VIS-1 overlay runtime in dependency order for unit
# tests. Mirrors the main.rb require block; host_runtime loads first because
# the manager consumes CommandContract + PreflightTracker.
require_relative 'host_runtime'
%w[
  overlay/manufacturing_feature_view
  overlay/feature_projector
  overlay/screen_picker
  overlay/inspection_snapshot
  overlay/inspection_resolver
  overlay/entity_locator
  overlay/provenance_navigation
  overlay/inspection_tool
  overlay/manager
].each do |relative_path|
  require_relative "../../src/granete_for_sketchup/#{relative_path}"
end
