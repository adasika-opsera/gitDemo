# frozen_string_literal: true

module Contracts
  module CaseConverter
    FORBIDDEN_SECRET_PATTERN = /secret|token|password|credential|encrypted/i.freeze

    module_function

    def snake_to_camel_case(value)
      raise ArgumentError, 'value must be a non-empty string' if value.nil? || value.empty?

      parts = value.split('_')
      head = parts.shift
      ([head] + parts.map(&:capitalize)).join
    end

    def derive_js_from_ruby(ruby_value)
      snake_to_camel_case(ruby_value)
    end

    def validate_no_secret_fields!(data)
      walk_for_secrets(data, [])
    end

    def walk_for_secrets(node, path)
      case node
      when Hash
        node.each do |key, value|
          key_str = key.to_s
          if key_str.match?(FORBIDDEN_SECRET_PATTERN)
            raise Contracts::Generator::SecurityViolationError,
                  "contract path #{format_path(path + [key_str])}: secret-like field #{key_str.inspect} is not allowed"
          end

          walk_for_secrets(value, path + [key_str])
        end
      when Array
        node.each_with_index { |item, index| walk_for_secrets(item, path + [index.to_s]) }
      when String
        if node.match?(FORBIDDEN_SECRET_PATTERN) && path.last == 'name'
          raise Contracts::Generator::SecurityViolationError,
                "contract path #{format_path(path)}: secret-like enum name #{node.inspect} is not allowed"
        end
      end
    end

    def format_path(path)
      path.empty? ? '(root)' : path.join('.')
    end
    private_class_method :walk_for_secrets, :format_path
  end
end
