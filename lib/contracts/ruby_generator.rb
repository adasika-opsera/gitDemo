# frozen_string_literal: true

module Contracts
  class RubyGenerator
    HEADER_TEMPLATE = <<~HEADER
      # DO NOT EDIT — generated file
      # Source: %<source>s
      # Generator: %<task>s
    HEADER

    def initialize(source:, task:)
      @source = source
      @task = task
    end

    def render(contract)
      lines = []
      lines << format(HEADER_TEMPLATE, source: @source, task: @task)
      lines << ''
      lines << '# frozen_string_literal: true'
      lines << ''
      lines << 'module Generated'
      lines << '  module Contracts'
      lines << '    # Auto-generated enum constants from the append-only contract.'
      lines << ''

      contract.fetch('enums', {}).each do |enum_name, enum_definition|
        constant_name = enum_name.upcase
        values = enum_definition.fetch('values').map { |entry| entry.fetch('ruby') }

        lines << "    #{constant_name} = %w[#{values.join(' ')}].freeze"
        lines << ''
      end

      lines << '  end'
      lines << 'end'
      lines << ''
      lines.join
    end
  end
end
