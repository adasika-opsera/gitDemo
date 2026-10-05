# frozen_string_literal: true

require 'spec_helper'
require 'gitlab/graphql/authz_coverage'
require_relative '../../../../fixtures/graphql/authz_coverage/mini_schema'

RSpec.describe Gitlab::Graphql::AuthzCoverage::Guard do
  def report_for(schema, ee: false)
    collected = Gitlab::Graphql::AuthzCoverage::Collector.new(schema: schema, ee: ee).collect
    Gitlab::Graphql::AuthzCoverage::ReportBuilder.new(collected).build(git_sha: 'abc123')
  end

  it 'names every undeclared mutation and non-public field' do
    error = nil
    begin
      described_class.enforce!(report_for(AuthzCoverageFixtures::MiniSchema))
    rescue Gitlab::Graphql::AuthzCoverage::GuardError => raised
      error = raised
    end

    expect(error).not_to be_nil
    expect(error.message).to include('type=Mutation field=DestroyWidget kind=mutation declaration=authorize :ability_name')
    expect(error.message).to include(
      'type=Widget field=Widget.note kind=non-public field declaration=field :name, Type, null: true, authorize: :ability_name'
    )
    expect(error.message).not_to include('ExportWidget')
    expect(error.message).not_to include('secret')
    expect(error.message).not_to include('Widget.name')
  end

  it 'includes a deprecated mutation that is still undeclared' do
    report = {
      'mutations' => [
        { 'name' => 'CloseWidget', 'abilities' => [], 'declared' => false, 'deprecated' => true }
      ],
      'fields' => []
    }

    expect { described_class.enforce!(report) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::GuardError, /field=CloseWidget kind=mutation/)
  end

  it 'does not treat an EE-only mutation excluded from CE as an offender' do
    report = report_for(AuthzCoverageFixtures::MiniSchema, ee: false)
    names = described_class.list(report).map { |offender| offender['field'] }

    expect(names).not_to include('ExportWidget')
  end

  it 'detects a mutation registered on the compiled schema' do
    mutation = Class.new(AuthzCoverageFixtures::MiniMutation) do
      graphql_name 'DynamicWidget'

      def resolve(*)
        {}
      end
    end
    query = Class.new(AuthzCoverageFixtures::MiniObject) do
      graphql_name 'DynamicQuery'
      field :echo, GraphQL::Types::String, null: true, public: true, public_reason: 'probe'
    end
    mutations = Class.new(AuthzCoverageFixtures::MiniObject) do
      graphql_name 'DynamicMutations'
    end
    mutations.field(:dynamic_widget, mutation: mutation)
    schema = Class.new(GraphQL::Schema)
    schema.query(query)
    schema.mutation(mutations)

    expect { described_class.enforce!(report_for(schema)) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::GuardError, /field=DynamicWidget kind=mutation/)
  end

  it 'passes a fully declared report' do
    report = {
      'mutations' => [
        { 'name' => 'CreateWidget', 'abilities' => ['create_widget'], 'declared' => true, 'deprecated' => false }
      ],
      'fields' => [
        { 'name' => 'Widget.id', 'owner' => 'Widget', 'abilities' => ['read_widget'], 'declared' => true, 'deprecated' => false }
      ]
    }

    expect(described_class.enforce!(report)).to eq(report)
  end

  it 'fails closed when the report is missing or incomplete' do
    expect { described_class.list(nil) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::GuardError, /refusing to report zero offenders/)
    expect { described_class.list({}) }
      .to raise_error(Gitlab::Graphql::AuthzCoverage::GuardError, /refusing to report partial coverage/)
  end
end
