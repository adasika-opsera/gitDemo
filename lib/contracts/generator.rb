# frozen_string_literal: true

module Contracts
  class Generator
    class Error < StandardError; end
    class SchemaValidationError < Error; end
    class AppendOnlyViolationError < Error; end
    class SecurityViolationError < Error; end
    class DuplicateKeyError < Error; end

    SOURCE_CONTRACT = 'config/contracts/enums.yml'
    GENERATOR_TASK = 'rake contracts:generate'

    RUBY_OUTPUT = 'lib/generated/contracts/issue_types.rb'
    TYPESCRIPT_OUTPUT = 'src/generated/contracts/issueTypes.ts'

    def initialize(root:, contract_path:, schema_path:, baseline_path: nil)
      @root = root
      @contract_path = contract_path
      @schema_path = schema_path
      @baseline_path = baseline_path || contract_path
    end

    def generate!
      incoming = load_yaml(@contract_path)
      baseline = load_yaml(@baseline_path)

      SchemaValidator.new(schema_path: @schema_path).validate!(incoming)
      CaseConverter.validate_no_secret_fields!(incoming)
      validate_js_forms!(incoming)
      AppendOnlyEnforcer.new(baseline).enforce!(incoming)

      ruby_output = RubyGenerator.new(source: relative_contract_path, task: GENERATOR_TASK).render(incoming)
      ts_output = TypeScriptGenerator.new(source: relative_contract_path, task: GENERATOR_TASK).render(incoming)

      write_output(RUBY_OUTPUT, ruby_output)
      write_output(TYPESCRIPT_OUTPUT, ts_output)

      {
        ruby_path: RUBY_OUTPUT,
        typescript_path: TYPESCRIPT_OUTPUT
      }
    end

    private

    def relative_contract_path
      Pathname.new(@contract_path).relative_path_from(@root).to_s
    end

    def load_yaml(path)
      require 'yaml'
      parsed = YAML.safe_load(File.read(path), permitted_classes: [Date, Time], aliases: true)
      ContractParser.ensure_hash!(parsed)
      parsed
    end

    def validate_js_forms!(contract)
      contract.fetch('enums', {}).each do |enum_name, enum_definition|
        js_values = {}
        enum_definition.fetch('values', []).each do |entry|
          name = entry.fetch('name')
          ruby = entry.fetch('ruby')
          js = entry.fetch('js')
          expected_js = CaseConverter.derive_js_from_ruby(ruby)

          if js != expected_js && js != ruby
            raise SchemaValidationError,
                  "enum #{enum_name.inspect} value #{name.inspect}: js form #{js.inspect} " \
                  "does not match snake_case conversion #{expected_js.inspect}"
          end

          if js_values.key?(js)
            raise DuplicateKeyError,
                  "enum #{enum_name.inspect}: duplicate JavaScript key #{js.inspect} " \
                  "for values #{js_values[js].inspect} and #{name.inspect}"
          end

          js_values[js] = name
        end
      end
    end

    def write_output(relative_path, content)
      absolute_path = File.join(@root, relative_path)
      FileUtils.mkdir_p(File.dirname(absolute_path))

      if File.exist?(absolute_path) && File.read(absolute_path) == content
        return absolute_path
      end

      temp_path = "#{absolute_path}.tmp"
      File.write(temp_path, content)
      File.rename(temp_path, absolute_path)
      absolute_path
    end
  end
end

require 'fileutils'
require 'pathname'
