# frozen_string_literal: true

module Contracts
  class AppendOnlyEnforcer
    def initialize(baseline_contract)
      @baseline_contract = baseline_contract
    end

    def enforce!(incoming_contract)
      baseline_enums = @baseline_contract.fetch('enums', {})
      incoming_enums = incoming_contract.fetch('enums', {})

      baseline_enums.each_key do |enum_name|
        unless incoming_enums.key?(enum_name)
          raise Contracts::Generator::AppendOnlyViolationError,
                "append-only violation: enum #{enum_name.inspect} was removed from the contract"
        end

        enforce_enum!(enum_name, baseline_enums[enum_name], incoming_enums[enum_name])
      end

      incoming_contract
    end

    private

    def enforce_enum!(enum_name, baseline_enum, incoming_enum)
      baseline_names = value_names(baseline_enum)
      incoming_names = value_names(incoming_enum)

      baseline_names.each_with_index do |name, index|
        if incoming_names[index] != name
          if !incoming_names.include?(name)
            raise Contracts::Generator::AppendOnlyViolationError,
                  "append-only violation: value #{name.inspect} was removed from enum #{enum_name.inspect}"
          end

          raise Contracts::Generator::AppendOnlyViolationError,
                "append-only violation: value #{name.inspect} was reordered in enum #{enum_name.inspect}"
        end
      end
    end

    def value_names(enum_definition)
      values = enum_definition.fetch('values', [])
      if values.empty?
        raise Contracts::Generator::SchemaValidationError,
              'enum definition must include at least one value'
      end

      values.map { |entry| entry.fetch('name') }
    end
  end
end
