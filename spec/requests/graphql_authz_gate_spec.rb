# frozen_string_literal: true

require 'spec_helper'
require 'json'
require_relative '../../app/controllers/graphql_controller'

RSpec.describe GraphqlController, 'authz gate' do
  let(:fixtures) { File.expand_path('../fixtures/graphql/authz_gate', __dir__) }

  def fixture(name)
    JSON.parse(File.read(File.join(fixtures, name)))
  end

  def user(abilities: %w[create_issue read_issue update_issue])
    Struct.new(:id, :two_factor_required, :two_factor_verified, :abilities).new(4, false, false, abilities)
  end

  def call(params:, current_user: user, sessionless: false, authenticity_token: 'valid-csrf-token', subjects: { '1' => :issue })
    described_class.call(
      params: params,
      current_user: current_user,
      sessionless: sessionless,
      authenticity_token: authenticity_token,
      subjects: subjects
    )
  end

  around do |example|
    previous = ENV['GITLAB_GRAPHQL_AUTHZ_MODE']
    ENV.delete('GITLAB_GRAPHQL_AUTHZ_MODE')
    example.run
  ensure
    if previous
      ENV['GITLAB_GRAPHQL_AUTHZ_MODE'] = previous
    else
      ENV.delete('GITLAB_GRAPHQL_AUTHZ_MODE')
    end
  end

  before do
    described_class.reset_rate_limits!
    Gitlab::Graphql::Authz::AuthzGate.reset_decision_log!
    Gitlab::Graphql::Authz::Ability.reset_resolution_count!
  end

  it 'runs after rate limiting and authorize_access_api!' do
    chain = described_class.filter_chain

    expect(chain.index(:enforce_authz_gate)).to be > chain.index(:rate_limit)
    expect(chain.index(:enforce_authz_gate)).to be > chain.index(:authorize_access_api!)
  end

  it 'keeps the success envelope for an already-authorized mutation' do
    response = call(params: fixture('single_allow.json'))

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end

  it 'denies destroyIssue when the caller lacks destroy_issue and still consumes rate limit' do
    response = call(params: fixture('single_undeclared.json'))

    expect(response[:status]).to eq(403)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Forbidden' }])
    expect(described_class.rate_limit_counts['user:4']).to eq(1)
    expect(response[:body].to_s).not_to include('destroyIssue')
  end

  it 'returns unauthorized for an anonymous declared mutation' do
    response = call(params: fixture('single_allow.json'), current_user: nil, authenticity_token: nil)

    expect(response[:status]).to eq(401)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Unauthorized' }])
    expect(described_class.rate_limit_counts['anonymous']).to eq(1)
  end

  it 'returns per-operation results for a mixed multiplex batch' do
    response = call(params: { '_json' => fixture('mixed_batch.json') })

    expect(response[:status]).to eq(200)
    expect(response[:body].length).to eq(2)
    expect(response[:body][0]).to eq('data' => { 'echo' => 'ok' })
    expect(response[:body][1]).to eq('errors' => [{ 'message' => 'Forbidden' }])
    expect(response[:body].to_s).not_to include('destroyIssue', 'undeclared')
  end

  it 'returns one result per operation for a 20-operation batch' do
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    response = call(params: { '_json' => fixture('batch_20.json') })
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started

    expect(response[:status]).to eq(200)
    expect(response[:body].length).to eq(20)
    expect(response[:body].each_slice(2).map(&:first)).to all(eq('data' => { 'echo' => 'ok' }))
    expect(response[:body].each_slice(2).map(&:last)).to all(eq('errors' => [{ 'message' => 'Forbidden' }]))
    expect(elapsed).to be < 0.05
    expect(described_class.rate_limit_counts['user:4']).to eq(1)
  end

  it 'does not change the response in report-only mode' do
    ENV['GITLAB_GRAPHQL_AUTHZ_MODE'] = 'report_only'
    response = call(params: fixture('single_undeclared.json'))

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
    expect(Gitlab::Graphql::Authz::AuthzGate.decision_log.last['outcome']).to eq('deny')
    expect(Gitlab::Graphql::Authz::AuthzGate.decision_log.last['mode']).to eq('report_only')
  end

  it 'fails closed on an internal error with a generic denial' do
    actor = user
    def actor.abilities
      raise 'secret-subject-9'
    end
    response = call(params: fixture('single_allow.json'), current_user: actor)

    expect(response[:status]).to eq(403)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Forbidden' }])
    expect(response[:body].to_s).not_to include('secret-subject-9')
  end

  it 'fails closed when the subject cannot be resolved' do
    response = call(params: fixture('missing_subject.json'), subjects: {})

    expect(response[:status]).to eq(403)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Forbidden' }])
    expect(response[:body].to_s).not_to include('404')
  end

  it 'allows anonymous introspection' do
    response = call(params: fixture('introspection.json'), current_user: nil, authenticity_token: nil)

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end
end
