# frozen_string_literal: true

require 'spec_helper'
require 'json'
require_relative '../../app/controllers/graphql_controller'

RSpec.describe GraphqlController do
  let(:fixtures) { File.expand_path('../fixtures/graphql/request_classification', __dir__) }

  def fixture(name)
    JSON.parse(File.read(File.join(fixtures, name)))
  end

  def user(id: 4, two_factor_required: false, two_factor_verified: false)
    Struct.new(:id, :two_factor_required, :two_factor_verified).new(id, two_factor_required, two_factor_verified)
  end

  def call(params:, current_user: nil, sessionless: false, authenticity_token: nil)
    described_class.call(
      params: params,
      current_user: current_user,
      sessionless: sessionless,
      authenticity_token: authenticity_token
    )
  end

  before { described_class.reset_rate_limits! }

  it 'allows an anonymous read without a CSRF token' do
    response = call(params: fixture('anonymous_read.json'))

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end

  it 'rejects a session mutation without a CSRF token and still counts rate limit' do
    response = call(params: fixture('session_mutation.json'), current_user: user)

    expect(response[:status]).to eq(422)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Invalid authenticity token' }])
    expect(described_class.rate_limit_counts['user:4']).to eq(1)
  end

  it 'allows a session mutation that presents the CSRF token' do
    response = call(
      params: fixture('session_mutation.json'),
      current_user: user,
      authenticity_token: 'valid-csrf-token'
    )

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end

  it 'allows a sessionless mutation without a CSRF token' do
    response = call(params: fixture('sessionless_mutation.json'), current_user: user, sessionless: true)

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end

  it 'rejects a session mixed batch without a CSRF token and allows a query-only batch' do
    mixed = call(params: { '_json' => fixture('mixed_batch.json') }, current_user: user)
    queries = call(params: { '_json' => fixture('query_only_batch.json') }, current_user: user)

    expect(mixed[:status]).to eq(422)
    expect(mixed[:body]['errors'].first['message']).to eq('Invalid authenticity token')
    expect(queries[:status]).to eq(200)
  end

  it 'requires two-factor for a session read and skips it for a sessionless mutation' do
    actor = user(two_factor_required: true)
    session_read = call(params: fixture('anonymous_read.json'), current_user: actor)
    sessionless = call(params: fixture('sessionless_mutation.json'), current_user: actor, sessionless: true)

    expect(session_read[:status]).to eq(401)
    expect(session_read[:body]).to eq('errors' => [{ 'message' => 'Two-factor authentication required' }])
    expect(sessionless[:status]).to eq(200)
  end

  it 'allows a session read once two-factor is verified, without a CSRF token' do
    response = call(
      params: fixture('anonymous_read.json'),
      current_user: user(two_factor_required: true, two_factor_verified: true)
    )

    expect(response[:status]).to eq(200)
  end

  it 'fails closed on a malformed document instead of skipping CSRF' do
    response = call(params: fixture('malformed.json'), current_user: nil)

    expect(response[:status]).to eq(422)
    expect(response[:body]['errors'].first['message']).to eq('Invalid authenticity token')
    expect(response[:body].to_s).not_to include('__schema')
  end
end
