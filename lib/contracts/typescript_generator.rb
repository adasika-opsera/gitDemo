# frozen_string_literal: true

module Contracts
  class TypeScriptGenerator
    HEADER_TEMPLATE = <<~HEADER
      // DO NOT EDIT — generated file
      // Source: %<source>s
      // Generator: %<task>s
    HEADER

    def initialize(source:, task:)
      @source = source
      @task = task
    end

    def render(contract)
      lines = []
      lines << format(HEADER_TEMPLATE, source: @source, task: @task)
      lines << ''

      contract.fetch('enums', {}).each do |enum_name, enum_definition|
        type_name = type_name_for(enum_name)
        js_values = enum_definition.fetch('values').map { |entry| entry.fetch('js') }

        lines << "export type #{type_name} = #{union_literal(js_values)};"
        lines << ''
        lines << "export const #{const_name_for(enum_name)} = [#{js_values.map { |v| "'#{v}'" }.join(', ')}] as const;"
        lines << ''
      end

      lines.join
    end

    private

    def type_name_for(enum_name)
      enum_name.split('_').map(&:capitalize).join + 'Type'
    end

    def const_name_for(enum_name)
      enum_name.split('_').map(&:capitalize).join + 'Values'
    end

    def union_literal(values)
      values.map { |value| "'#{value}'" }.join(' | ')
    end
  end
end
