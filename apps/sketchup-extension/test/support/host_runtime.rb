# frozen_string_literal: true

# Loads the #498 / SU-HOST-1 shared host runtime in dependency order for
# unit tests. Mirrors the main.rb require block; transport + library
# contracts must load first because the coordinator pins its resolve error
# classes at load time.
%w[
  transport/adapter
  transport/http_adapter
  library/catalog_provider
  library/layout_contract
  library/authoring_resolve_contract
  metadata/store
  connection/managed_furniture
  host/message_identity
  host/interaction_state
  host/error_taxonomy
  host/degraded_state
  host/command_contract
  host/operation_journal
  host/preflight_tracker
  host/selection_restore
  host/mutation_outcome
  host/mutation_command
  host/authoring_mutation_coordinator
].each do |relative_path|
  require_relative "../../src/granete_for_sketchup/#{relative_path}"
end
