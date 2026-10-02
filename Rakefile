# frozen_string_literal: true

$LOAD_PATH.unshift File.expand_path('lib', __dir__)

require 'contracts'

Dir.glob(File.expand_path('lib/tasks/**/*.rake', __dir__)).sort.each do |rake_file|
  import rake_file
end

task default: 'contracts:generate'
