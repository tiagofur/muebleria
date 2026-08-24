# frozen_string_literal: true

require 'minitest/autorun'

PROJECT_ROOT = File.expand_path('..', __dir__)
$LOAD_PATH.unshift(File.join(PROJECT_ROOT, 'test', 'support'))

require 'sketchup'
require 'extensions'
