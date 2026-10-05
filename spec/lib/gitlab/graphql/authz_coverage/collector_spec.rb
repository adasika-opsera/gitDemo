# frozen_string_literal: true

require 'spec_helper'
require 'gitlab/graphql/authz_coverage/collector'
require_relative '../../../../fixtures/graphql/authz_coverage/mini_schema'

RSpec.describe Gitlab::Graphql::AuthzCoverage::Collector do
  subject(:collected) { described_class.new(schema: AuthzCoverageFixtures::MiniSchema, ee: ee).collect }

  let(:ee) { false }

  def mutation(name)
    collected[:mutations].find { |entry| entry['name'] == name }
  end

  def field(name)
    collected[:fields].find { |entry| entry['name'] == name }
  end

  it 'marks a declared mutation and an undeclared mutation explicitly' do
    expect(mutation('CreateWidget')).to include(
      'abilities' => ['create_widget'],
      'declared' => true,
      'deprecated' => false
    )
    expect(mutation('DestroyWidget')).to include(
      'abilities' => [],
      'declared' => false,
      'deprecated' => false
    )
  end

  it 'records every ability on a multi-ability mutation' do
    expect(mutation('UpdateWidget')).to include(
      'abilities' => %w[read_widget update_widget],
      'declared' => true
    )
  end

  it 'keeps deprecated mutations in the inventory' do
    expect(mutation('RenameWidgetLegacy')).to include(
      'declared' => true,
      'deprecated' => true,
      'abilities' => ['update_widget']
    )
  end

  it 'records an EE-only mutation as excluded in CE and included in EE' do
    expect(collected[:ee_only_excluded]).to eq(['ExportWidget'])
    expect(mutation('ExportWidget')).to be_nil

    ee_collected = described_class.new(schema: AuthzCoverageFixtures::MiniSchema, ee: true).collect
    exported = ee_collected[:mutations].find { |entry| entry['name'] == 'ExportWidget' }

    expect(ee_collected[:ee_only_excluded]).to eq([])
    expect(exported).to include('abilities' => ['admin_widget'], 'declared' => true)
    expect(ee_collected[:edition]).to eq('ee')
  end

  it 'records a public classification reason without counting the field as a gap' do
    expect(collected[:public_fields]).to include(
      'name' => 'Widget.name',
      'owner' => 'Widget',
      'reason' => 'Widget name is public catalog data.'
    )
    expect(field('Widget.name')).to be_nil
  end

  it 'inventories non-public fields and omits public fields' do
    expect(field('Widget.id')).to include('abilities' => ['read_widget'], 'declared' => true, 'owner' => 'Widget')
    expect(field('Widget.note')).to include('abilities' => [], 'declared' => false, 'owner' => 'Widget')
    expect(field('Widget.name')).to be_nil
    expect(collected[:fields].map { |entry| entry['name'] }).not_to include('Query.echo')
  end

  it 'excludes credential-shaped fields entirely and only counts them' do
    expect(collected[:redacted_field_count]).to eq(1)
    expect(JSON.generate(collected)).not_to include('secret')
    expect(JSON.generate(collected)).not_to include('widgetSecretToken')
    expect(JSON.generate(collected)).not_to include('widget_secret_token')
  end

  it 'does not treat generated payload fields as authorization gaps' do
    expect(collected[:fields].map { |entry| entry['name'] }.grep(/Payload/)).to eq([])
  end

  it 'fails closed when the schema has no mutation type' do
    expect { described_class.new(schema: nil).collect }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::TraversalError, /schema is missing/)
  end
end
