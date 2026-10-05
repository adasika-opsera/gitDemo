# frozen_string_literal: true

require 'spec_helper'
require 'json'
require_relative '../../app/controllers/graphql_controller'

RSpec.describe GraphqlController, 'authorize declarations' do
  let(:fixtures) { File.expand_path('../fixtures/graphql/authorize_declarations', __dir__) }

  def fixture(name)
    JSON.parse(File.read(File.join(fixtures, name)))
  end

  def user(abilities:)
    Struct.new(:id, :two_factor_required, :two_factor_verified, :abilities).new(4, false, false, abilities)
  end

  def call(params:, current_user:)
    described_class.call(
      params: params,
      current_user: current_user,
      sessionless: false,
      authenticity_token: 'valid-csrf-token',
      subjects: { '1' => :issue }
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
  end

  it 'keeps the denial and error shape for destroyIssue when the caller lacks destroy_issue' do
    response = call(
      params: fixture('destroy_issue.json'),
      current_user: user(abilities: %w[create_issue read_issue update_issue])
    )

    expect(response[:status]).to eq(403)
    expect(response[:body]).to eq('errors' => [{ 'message' => 'Forbidden' }])
    expect(response[:body].to_s).not_to include('destroyIssue')
  end

  it 'keeps the allow outcome and success envelope for createIssue' do
    response = call(
      params: fixture('create_issue.json'),
      current_user: user(abilities: %w[create_issue read_issue update_issue])
    )

    expect(response[:status]).to eq(200)
    expect(response[:body]).to eq('data' => { 'echo' => 'ok' })
  end
end
