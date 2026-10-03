# frozen_string_literal: true

require 'spec_helper'
require 'json'
require 'gitlab/graphql/request_classification/request_classifier'

RSpec.describe Gitlab::Graphql::RequestClassification::RequestClassifier do
  subject(:classifier) { described_class.new(params: params, current_user: user, sessionless: sessionless) }

  let(:user) { nil }
  let(:sessionless) { false }
  let(:params) { { query: 'query { echo }' } }
  let(:fixtures) { File.expand_path('../../../../fixtures/graphql/request_classification', __dir__) }

  def fixture(name)
    JSON.parse(File.read(File.join(fixtures, name)))
  end

  before { described_class.reset_failure_log! }

  describe 'caller and operation combinations' do
    it 'treats an anonymous read as non-mutating and not session-authenticated' do
      expect(classifier.mutating?).to be(false)
      expect(classifier.session_authenticated?).to be(false)
      expect(classifier.skip_csrf?).to be(true)
    end

    it 'treats an anonymous mutation as mutating but still skips CSRF' do
      classifier = described_class.new(params: fixture('session_mutation.json'), current_user: nil, sessionless: false)

      expect(classifier.mutating?).to be(true)
      expect(classifier.session_authenticated?).to be(false)
      expect(classifier.skip_csrf?).to be(true)
    end

    it 'requires CSRF for a session mutation and skips it for a session read' do
      session_user = Struct.new(:id).new(1)
      mutation = described_class.new(params: fixture('session_mutation.json'), current_user: session_user, sessionless: false)
      read = described_class.new(params: fixture('anonymous_read.json'), current_user: session_user, sessionless: false)

      expect(mutation.session_authenticated?).to be(true)
      expect(mutation.mutating?).to be(true)
      expect(mutation.skip_csrf?).to be(false)
      expect(read.mutating?).to be(false)
      expect(read.skip_csrf?).to be(true)
    end

    it 'treats a sessionless mutation as not session-authenticated and skips two-factor' do
      session_user = Struct.new(:id).new(7)
      classifier = described_class.new(
        params: fixture('sessionless_mutation.json'),
        current_user: session_user,
        sessionless: true
      )

      expect(classifier.mutating?).to be(true)
      expect(classifier.session_authenticated?).to be(false)
      expect(classifier.sessionless?).to be(true)
      expect(classifier.skip_csrf?).to be(true)
      expect(classifier.skip_two_factor?).to be(true)
    end
  end

  it 'classifies a multiplex batch as mutating when any operation is a mutation' do
    classifier = described_class.new(params: { '_json' => fixture('mixed_batch.json') }, current_user: nil, sessionless: false)

    expect(classifier.mutating?).to be(true)
  end

  it 'does not classify a query-only multiplex batch as mutating' do
    classifier = described_class.new(params: { '_json' => fixture('query_only_batch.json') }, current_user: nil, sessionless: false)

    expect(classifier.mutating?).to be(false)
  end

  it 'keeps deprecated mutations in the mutating set' do
    params = { query: 'mutation { closeIssue(iid: "1") { issue { iid } } }' }

    expect(described_class.new(params: params, current_user: nil, sessionless: false).mutating?).to be(true)
  end

  it 'classifies introspection, including the cached document, as non-mutating' do
    inline = described_class.new(params: { query: 'query { __schema { queryType { name } } }' }, current_user: nil, sessionless: false)
    named = described_class.new(
      params: { query: 'query IntrospectionQuery { __typename }', operationName: 'IntrospectionQuery' },
      current_user: nil,
      sessionless: false
    )
    cached = described_class.new(
      params: { query: described_class::CACHED_INTROSPECTION },
      current_user: nil,
      sessionless: false
    )

    expect(inline.mutating?).to be(false)
    expect(named.mutating?).to be(false)
    expect(cached.mutating?).to be(false)
    expect(described_class::CACHED_INTROSPECTION.bytesize).to be > described_class::MAX_QUERY_SIZE
  end

  it 'fails closed when the document exceeds the size limit and is not allowlisted' do
    params = { query: "query { echo }#{' ' * described_class::MAX_QUERY_SIZE}" }
    classifier = described_class.new(params: params, current_user: nil, sessionless: true)

    expect(classifier.mutating?).to be(true)
    expect(classifier.session_authenticated?).to be(true)
    expect(classifier.skip_csrf?).to be(false)
    expect(described_class.failure_log.first['operation'].length).to be <= described_class::OPERATION_NAME_LIMIT
  end

  it 'fails closed when one multiplex entry cannot be parsed' do
    classifier = described_class.new(
      params: { '_json' => fixture('malformed_batch.json') },
      current_user: nil,
      sessionless: false
    )

    expect(classifier.mutating?).to be(true)
    expect(classifier.session_authenticated?).to be(true)
  end

  it 'fails closed when the named operation is missing' do
    params = { query: 'query Reader { echo }', operationName: 'Missing' }

    expect(described_class.new(params: params, current_user: nil, sessionless: false).mutating?).to be(true)
  end

  it 'truncates a long operation name in the failure log' do
    name = 'Q' * 200
    params = { query: 'query { !!!', operationName: name }
    described_class.new(params: params, current_user: nil, sessionless: false).mutating?

    expect(described_class.failure_log.first['operation']).to eq(name.slice(0, described_class::OPERATION_NAME_LIMIT))
    expect(described_class.failure_log.first['reason']).to include('failed to parse')
  end

  it 'memoizes classification on the instance only' do
    params = { query: 'query { echo }' }
    first = described_class.new(params: params, current_user: nil, sessionless: false)
    2.times { first.mutating? }
    second = described_class.new(params: { query: 'mutation { closeIssue(iid: "1") { issue { iid } } }' }, current_user: nil, sessionless: false)

    expect(first.mutating?).to be(false)
    expect(second.mutating?).to be(true)
  end
end
