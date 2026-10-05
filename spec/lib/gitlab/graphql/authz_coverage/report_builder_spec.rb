# frozen_string_literal: true

require 'spec_helper'
require 'gitlab/graphql/authz_coverage/report_builder'

RSpec.describe Gitlab::Graphql::AuthzCoverage::ReportBuilder do
  subject(:report) { described_class.new(collected).build(git_sha: 'abc123', generated_at: '2026-10-02T00:00:00Z') }

  let(:collected) do
    {
      mutations: [
        { 'name' => 'CreateWidget', 'abilities' => ['create_widget'], 'declared' => true, 'deprecated' => false },
        { 'name' => 'DestroyWidget', 'abilities' => [], 'declared' => false, 'deprecated' => false }
      ],
      fields: [
        { 'name' => 'Widget.id', 'owner' => 'Widget', 'abilities' => ['read_widget'], 'declared' => true, 'deprecated' => false },
        { 'name' => 'Widget.note', 'owner' => 'Widget', 'abilities' => [], 'declared' => false, 'deprecated' => false }
      ],
      ee_only_excluded: ['ExportWidget'],
      redacted_field_count: 1,
      edition: 'ce',
      public_fields: [
        { 'name' => 'Widget.name', 'owner' => 'Widget', 'reason' => 'Widget name is public catalog data.' }
      ]
    }
  end

  it 'computes mutation, field, and overall coverage' do
    expect(report['totals']).to include(
      'mutations' => 2,
      'declared' => 1,
      'undeclared' => 1,
      'coveragePercent' => 50.0,
      'fields' => 2,
      'fieldsDeclared' => 1,
      'fieldsUndeclared' => 1,
      'fieldsCoveragePercent' => 50.0,
      'overallCoveragePercent' => 50.0,
      'redactedFieldCount' => 1
    )
  end

  it 'places fields alongside mutations and records the excluded EE surface' do
    expect(report['mutations'].map { |entry| entry['name'] }).to eq(%w[CreateWidget DestroyWidget])
    expect(report['fields'].map { |entry| entry['name'] }).to eq(['Widget.id', 'Widget.note'])
    expect(report['eeOnlyExcluded']).to eq(['ExportWidget'])
    expect(report['publicFields'].map { |entry| entry['name'] }).to eq(['Widget.name'])
    expect(report['gitSha']).to eq('abc123')
    expect(report['generatedAt']).to eq('2026-10-02T00:00:00Z')
    expect(report['edition']).to eq('ce')
  end

  it 'reports the redacted field count without naming the redacted fields' do
    expect(JSON.generate(report)).not_to include('secret')
  end

  it 'treats an empty surface as fully covered' do
    empty = described_class.new(
      mutations: [],
      fields: [],
      ee_only_excluded: [],
      redacted_field_count: 0,
      edition: 'ce',
      public_fields: []
    ).build(git_sha: 'abc123')

    expect(empty['totals']['coveragePercent']).to eq(100.0)
    expect(empty['totals']['fieldsCoveragePercent']).to eq(100.0)
    expect(empty['totals']['overallCoveragePercent']).to eq(100.0)
  end
end
