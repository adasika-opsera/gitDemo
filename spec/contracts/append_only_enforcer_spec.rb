# frozen_string_literal: true

require 'spec_helper'
require 'yaml'

RSpec.describe Contracts::AppendOnlyEnforcer do
  let(:baseline) do
    {
      'version' => 1,
      'enums' => {
        'sample_enum' => {
          'values' => [
            { 'name' => 'alpha_one', 'ruby' => 'alpha_one', 'js' => 'alphaOne' },
            { 'name' => 'beta_two', 'ruby' => 'beta_two', 'js' => 'betaTwo' }
          ]
        }
      }
    }
  end

  it 'allows appending a new value' do
    incoming = Marshal.load(Marshal.dump(baseline))
    incoming['enums']['sample_enum']['values'] << {
      'name' => 'gamma_three',
      'ruby' => 'gamma_three',
      'js' => 'gammaThree'
    }

    expect { described_class.new(baseline).enforce!(incoming) }.not_to raise_error
  end

  it 'rejects removing an existing value' do
    incoming = Marshal.load(Marshal.dump(baseline))
    incoming['enums']['sample_enum']['values'].pop

    expect { described_class.new(baseline).enforce!(incoming) }
      .to raise_error(Contracts::Generator::AppendOnlyViolationError, /removed/)
  end

  it 'rejects reordering existing values' do
    incoming = Marshal.load(Marshal.dump(baseline))
    incoming['enums']['sample_enum']['values'].reverse!

    expect { described_class.new(baseline).enforce!(incoming) }
      .to raise_error(Contracts::Generator::AppendOnlyViolationError, /reordered/)
  end

  it 'rejects empty enum definitions' do
    incoming = {
      'version' => 1,
      'enums' => { 'sample_enum' => { 'values' => [] } }
    }

    expect { described_class.new(baseline).enforce!(incoming) }
      .to raise_error(Contracts::Generator::SchemaValidationError, /at least one value/)
  end
end
