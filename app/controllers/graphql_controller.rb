# frozen_string_literal: true

require_relative 'application_controller'
require_relative '../services/authz/redaction_service'

lib_path = File.expand_path('../../lib', __dir__)
$LOAD_PATH.unshift(lib_path) unless $LOAD_PATH.include?(lib_path)

require 'gitlab/graphql/request_classification/request_classifier'
require 'gitlab/graphql/authz/authz_gate'
require 'gitlab/graphql/authz/mode'

class GraphqlController < ApplicationController
  skip_before_action :authenticate_user!
  skip_before_action :active_user_check
  skip_before_action :enforce_read_only_organization
  skip_before_action :verify_authenticity_token, if: -> { request_classifier.skip_csrf? }
  skip_before_action :check_two_factor_requirement, if: -> { request_classifier.skip_two_factor? }
  before_action :enforce_authz_gate

  def request_classifier
    @request_classifier ||= Gitlab::Graphql::RequestClassification::RequestClassifier.new(
      params: params,
      current_user: current_user,
      sessionless: sessionless_user?
    )
  end

  private

  def enforce_authz_gate
    result = authz_gate.call
    return unless Gitlab::Graphql::Authz::Mode.enforce?
    return unless result.halt_request?

    halt(result.http_status, Authz::RedactionService.client_message(result.http_status))
  end

  def authz_gate
    @authz_gate ||= Gitlab::Graphql::Authz::AuthzGate.new(
      classifier: request_classifier,
      current_user: current_user,
      subjects: @env[:subjects] || {}
    )
  end

  def execute
    result = authz_gate.call
    success = { 'data' => { 'echo' => 'ok' } }
    return success unless result.multiplex && !result.parse_failed

    result.entries.map do |entry|
      Authz::RedactionService.envelope(entry, enforce: Gitlab::Graphql::Authz::Mode.enforce?)
    end
  end
end
