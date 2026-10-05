# frozen_string_literal: true

require 'spec_helper'
require 'json'
require 'gitlab/graphql/authz/authz_gate'
require 'gitlab/graphql/request_classification/request_classifier'

RSpec.describe Gitlab::Graphql::Authz::AuthzGate do
  let(:fixtures) { File.expand_path('../../../../fixtures/graphql/authz_gate', __dir__) }
  let(:abilities) { %w[create_issue read_issue update_issue] }
  let(:user) { Struct.new(:abilities).new(abilities) }
  let(:subjects) { { '1' => :issue } }
  let(:params) { fixture('single_allow.json') }

  def fixture(name)
    JSON.parse(File.read(File.join(fixtures, name)))
  end

  def classifier_for(document, current_user: user)
    Gitlab::Graphql::RequestClassification::RequestClassifier.new(
      params: document,
      current_user: current_user,
      sessionless: false
    )
  end

  def gate_for(document, current_user: user, known_subjects: subjects)
    described_class.new(
      classifier: classifier_for(document, current_user: current_user),
      current_user: current_user,
      subjects: known_subjects
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
    described_class.reset_decision_log!
    Gitlab::Graphql::Authz::Ability.reset_resolution_count!
  end

  it 'allows a declared mutation when the user holds every required ability' do
    decision = gate_for(params).call.entries.first

    expect(decision.outcome).to eq('allow')
    expect(decision.reason).to eq('declared')
    expect(decision.abilities).to eq(['create_issue'])
  end

  it 'denies a declared mutation the user cannot perform' do
    actor = Struct.new(:abilities).new([])
    decision = gate_for(params, current_user: actor).call.entries.first

    expect(decision.outcome).to eq('deny')
    expect(decision.reason).to eq('forbidden')
    expect(decision.status_code).to eq(403)
  end

  it 'denies an undeclared mutation in enforce mode' do
    lookup = instance_double(
      Gitlab::Graphql::Authz::DeclarationLookup,
      for_selection: { kind: :undeclared, abilities: [], expects_subject: false }
    )
    allow(Gitlab::Graphql::Authz::DeclarationLookup).to receive(:new).and_return(lookup)

    decision = gate_for(fixture('single_undeclared.json')).call.entries.first

    expect(decision.outcome).to eq('deny')
    expect(decision.reason).to eq('undeclared')
    expect(decision.status_code).to eq(403)
  end

  it 'authorizes each multiplex entry independently' do
    result = gate_for({ '_json' => fixture('mixed_batch.json') }).call

    expect(result.multiplex).to be(true)
    expect(result.entries.map(&:outcome)).to eq(%w[allow deny])
    # destroyIssue declares destroy_issue, which this caller does not hold.
    expect(result.entries.map(&:reason)).to eq(%w[public forbidden])
    expect(result.halt_request?).to be(false)
  end

  it 'fails closed when ability lookup raises, without keeping the exception text' do
    actor = Struct.new(:abilities).new(abilities)
    def actor.abilities
      raise 'secret-subject-9'
    end
    result = gate_for(params, current_user: actor).call
    decision = result.entries.first

    expect(result.parse_failed).to be(false)
    expect(decision.outcome).to eq('deny')
    expect(decision.reason).to eq('internal_error')
    expect(decision.status_code).to eq(403)
    expect(described_class.decision_log.to_s).not_to include('secret-subject-9')
  end

  it 'fails closed when the document cannot be parsed' do
    result = gate_for(fixture('malformed.json')).call

    expect(result.parse_failed).to be(true)
    expect(result.halt_request?).to be(true)
    expect(result.http_status).to eq(403)
    expect(result.entries.first.reason).to eq('parse_failed')
  end

  it 'fails closed when the subject cannot be resolved and does not log the identifier' do
    decision = gate_for(fixture('missing_subject.json'), known_subjects: {}).call.entries.first

    expect(decision.outcome).to eq('deny')
    expect(decision.reason).to eq('unresolvable_subject')
    expect(described_class.decision_log.to_s).not_to include('404')
  end

  it 'still gates a deprecated mutation' do
    allowed = gate_for(fixture('deprecated_close.json')).call.entries.first
    denied = gate_for(fixture('deprecated_close.json'), current_user: Struct.new(:abilities).new([])).call.entries.first

    expect(allowed.outcome).to eq('allow')
    expect(allowed.abilities).to eq(['update_issue'])
    expect(denied.reason).to eq('forbidden')
  end

  it 'allows anonymous introspection and public data' do
    introspection = gate_for(fixture('introspection.json'), current_user: nil).call.entries.first
    public_read = gate_for({ 'query' => 'query { echo }' }, current_user: nil).call.entries.first

    expect(introspection.outcome).to eq('allow')
    expect(introspection.reason).to eq('introspection')
    expect(public_read.reason).to eq('public')
  end

  it 'denies an anonymous caller on a declared mutation' do
    decision = gate_for(params, current_user: nil).call.entries.first

    expect(decision.reason).to eq('unauthenticated')
    expect(decision.status_code).to eq(401)
  end

  it 'logs the would-be denial in report-only mode' do
    ENV['GITLAB_GRAPHQL_AUTHZ_MODE'] = 'report_only'
    decision = gate_for(fixture('single_undeclared.json')).call.entries.first
    logged = described_class.decision_log.last

    expect(decision.outcome).to eq('deny')
    expect(logged['mode']).to eq('report_only')
    expect(logged['outcome']).to eq('deny')
    expect(logged['operation'].length).to be <= 64
  end

  it 'truncates long operation names in the decision log' do
    name = 'Q' * 200
    document = { 'query' => "query #{name} { echo }" }
    gate_for(document, current_user: nil).call

    expect(described_class.decision_log.last['operation']).to eq(name.slice(0, 64))
  end

  it 'memoizes ability checks per subject for the life of the request only' do
    document = {
      '_json' => Array.new(20) { { 'query' => 'mutation { updateIssue(iid: "1") { issue { iid } } }' } }
    }
    first = gate_for(document)
    2.times { first.call }
    expect(Gitlab::Graphql::Authz::Ability.resolution_count).to eq(1)

    abilities.clear
    second = gate_for(document)
    expect(second.call.entries).to all(have_attributes(outcome: 'deny', reason: 'forbidden'))
    expect(Gitlab::Graphql::Authz::Ability.resolution_count).to eq(2)
  end

  it 'gates an allowlisted oversized introspection the same way as a normal one' do
    cached = gate_for(
      { 'query' => Gitlab::Graphql::RequestClassification::RequestClassifier::CACHED_INTROSPECTION },
      current_user: nil
    ).call.entries.first
    named = gate_for(fixture('introspection.json'), current_user: nil).call.entries.first

    expect(cached.reason).to eq('introspection')
    expect(named.reason).to eq('introspection')
    expect(cached.outcome).to eq(named.outcome)
  end
end
