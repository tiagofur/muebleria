# frozen_string_literal: true

require 'minitest/autorun'

PROJECT_ROOT = File.expand_path('..', __dir__)
$LOAD_PATH.unshift(File.join(PROJECT_ROOT, 'test', 'support'))

require 'sketchup'
require 'extensions'

# Runtime modules reference each other through main.rb's load order in
# production; for the unit suites the shared placement-envelope authority
# (#469 increment 3: builder + tool) and the extension identity (version
# constants) load once here.
require_relative '../src/granete_for_sketchup/tools/placement_preview_extents'
require_relative '../src/granete_for_sketchup/identity'

# #848: los bridges del DialogController se cargan acá para los tests que
# requieren ui/dialog_controller directamente (el runtime los carga vía main.rb).

require_relative '../src/granete_for_sketchup/ui/bridges/active_model_metadata_store'
require_relative '../src/granete_for_sketchup/ui/bridges/session_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/model_binding_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/commercial_projection_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/commercial_bootstrap_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/placement_preview_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/design_workflow_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/project_furniture_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/host_mutation_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/furniture_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/option_selector_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/inspector_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/app_model_observer'
require_relative '../src/granete_for_sketchup/ui/bridges/observer_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/manufacturing_inspection_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/preflight_review_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/migration_bridge'
require_relative '../src/granete_for_sketchup/ui/bridges/hardware_mount_bridge'
