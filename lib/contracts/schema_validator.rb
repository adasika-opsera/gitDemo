# frozen_string_literal: true

require 'json'
require 'json_schemer'

module Contracts
  class SchemaValidator
    FORBIDDEN_TOP_LEVEL_KEYS = %w[secret token password credential encrypted].freeze

    def initialize(schema_path:)
      @schema = JSON.parse(File.read(schema_path))
      @schemer = JSONSchemer.schema(@schema)
    end

    def validate!(contract)
      ContractParser.ensure_hash!(contract)

      ContractParser.reject_top_level_secrets!(contract)

      errors = @schemer.validate(contract).to_a
      return contract if errors.empty?

      messages = errors.map do |error|
        pointer = error['data_pointer']
        detail = error['error'] || error['type']
        "#{pointer.empty? ? '(root)' : pointer}: #{detail}"
      end

      raise Contracts::Generator::SchemaValidationError,
            "contract schema validation failed:\n#{messages.join("\n")}"
    end
  end

  module ContractParser
    module_function

    def ensure_hash!(contract)
      return contract if contract.is_a?(Hash)

      raise Contracts::Generator::SchemaValidationError, 'contract must be a YAML object'
    end

    def reject_top_level_secrets!(contract)
      FORBIDDEN_TOP_LEVEL_KEYS.each do |key|
        next unless contract.key?(key)

        raise Contracts::Generator::SecurityViolationError,
              "top-level key #{key.inspect} is not allowed in enum contracts"
      end
    end
  end
end
