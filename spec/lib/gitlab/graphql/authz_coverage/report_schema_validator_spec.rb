# frozen_string_literal: true

require 'spec_helper'
require 'gitlab/graphql/authz_coverage'

RSpec.describe Gitlab::Graphql::AuthzCoverage::ReportSchemaValidator do
  subject(:validator) do
    described_class.new(schema_path: File.join(ROOT, Gitlab::Graphql::AuthzCoverage::JSON_SCHEMA_RELATIVE))
  end

  let(:report) do
    {
      'generatedAt' => '2026-10-02T00:00:00Z',
      'gitSha' => 'abc123',
      'edition' => 'ce',
      'eeOnlyExcluded' => [],
      'totals' => {
        'mutations' => 1,
        'declared' => 1,
        'undeclared' => 0,
        'coveragePercent' => 100.0,
        'fields' => 0,
        'fieldsDeclared' => 0,
        'fieldsUndeclared' => 0,
        'fieldsCoveragePercent' => 100.0,
        'overallCoveragePercent' => 100.0,
        'redactedFieldCount' => 0
      },
      'mutations' => [
        { 'name' => 'CreateWidget', 'abilities' => ['create_widget'], 'declared' => true, 'deprecated' => false }
      ],
      'fields' => [],
      'publicFields' => []
    }
  end

  it 'accepts a report that matches the committed schema' do
    expect(validator.validate!(report)).to eq(report)
  end

  it 'rejects a report that omits the mutation inventory' do
    expect { validator.validate!(report.except('mutations')) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::SchemaValidationError, /mutations/)
  end

  it 'rejects a non-object report' do
    expect { validator.validate!([]) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::SchemaValidationError, /JSON object/)
  end
end
