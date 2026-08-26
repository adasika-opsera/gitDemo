# frozen_string_literal: true

require 'spec_helper'
require 'yaml'
require 'tempfile'

RSpec.describe Contracts::CaseConverter do
  describe '.snake_to_camel_case' do
    it 'converts snake_case to camelCase' do
      expect(described_class.snake_to_camel_case('test_case')).to eq('testCase')
      expect(described_class.snake_to_camel_case('key_result')).to eq('keyResult')
    end

    it 'preserves single-word values' do
      expect(described_class.snake_to_camel_case('issue')).to eq('issue')
    end

    it 'handles digits deterministically' do
      expect(described_class.snake_to_camel_case('v2_alpha')).to eq('v2Alpha')
    end

    it 'rejects empty values' do
      expect { described_class.snake_to_camel_case('') }.to raise_error(ArgumentError)
    end
  end

  describe '.validate_no_secret_fields!' do
    it 'rejects secret-like enum names' do
      contract = {
        'enums' => {
          'bad_enum' => {
            'values' => [{ 'name' => 'api_token', 'ruby' => 'api_token', 'js' => 'apiToken' }]
          }
        }
      }

      expect { described_class.validate_no_secret_fields!(contract) }
        .to raise_error(Contracts::Generator::SecurityViolationError, /secret-like enum name/)
    end

    it 'allows standard enum values' do
      contract = YAML.load_file(File.join(FIXTURES_DIR, 'minimal_enums.yml'))
      expect { described_class.validate_no_secret_fields!(contract) }.not_to raise_error
    end
  end
end
