# frozen_string_literal: true

module Authz
  # Client responses stay on the existing GraphQL envelope. Decision reasons,
  # ability names, and subject identifiers never leave the process.
  class RedactionService
    UNAUTHORIZED = 'Unauthorized'
    FORBIDDEN = 'Forbidden'
    SUCCESS = { 'data' => { 'echo' => 'ok' } }.freeze

    def self.client_message(status_code)
      status_code.to_i == 401 ? UNAUTHORIZED : FORBIDDEN
    end

    def self.envelope(decision, enforce:)
      return SUCCESS.dup unless enforce && decision.denied?

      { 'errors' => [{ 'message' => client_message(decision.status_code) }] }
    end
  end
end
