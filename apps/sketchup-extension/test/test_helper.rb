# frozen_string_literal: true

require 'minitest/autorun'

PROJECT_ROOT = File.expand_path('..', __dir__)
$LOAD_PATH.unshift(File.join(PROJECT_ROOT, 'test', 'support'))

require 'sketchup'
require 'extensions'

# Runtime modules reference each other through main.rb's load order in
# production; for the unit suites the shared placement-envelope authority
# (#469 increment 3: builder + tool) loads once here.
require_relative '../src/granete_for_sketchup/tools/placement_preview_extents'
