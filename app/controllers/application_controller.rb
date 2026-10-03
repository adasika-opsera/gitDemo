# frozen_string_literal: true

require 'json'

# Minimal filter chain so GraphqlController can delegate skip decisions without Rails.
class ApplicationController
  class FilterHalt < StandardError
    attr_reader :status, :body

    def initialize(status, body)
      @status = status
      @body = body
      super("filter halted with #{status}")
    end
  end

  class << self
    def before_action(name)
      own_before_actions << name.to_sym
    end

    def skip_before_action(name, **options)
      skips[name.to_sym] = options
    end

    def own_before_actions
      @own_before_actions ||= []
    end

    def skips
      @skips ||= {}
    end

    def filter_chain
      ancestors.reverse_each.flat_map do |klass|
        klass.respond_to?(:own_before_actions) ? klass.own_before_actions : []
      end
    end

    def skip_for(name)
      ancestors.each do |klass|
        next unless klass.respond_to?(:skips) && klass.skips.key?(name)

        return klass.skips[name]
      end
      nil
    end
  end

  before_action :rate_limit
  before_action :authenticate_user!
  before_action :active_user_check
  before_action :enforce_read_only_organization
  before_action :verify_authenticity_token
  before_action :check_two_factor_requirement
  before_action :authorize_access_api!

  def self.call(env)
    new(env).dispatch
  end

  def self.rate_limit_counts
    @rate_limit_counts ||= Hash.new(0)
  end

  def self.reset_rate_limits!
    @rate_limit_counts = Hash.new(0)
  end

  def initialize(env)
    @env = env
  end

  def dispatch
    self.class.filter_chain.each do |name|
      next if skip_filter?(name)

      send(name)
    end
    { status: 200, body: execute }
  rescue FilterHalt => halt
    { status: halt.status, body: halt.body }
  end

  def params
    @env.fetch(:params, {})
  end

  def current_user
    @env[:current_user]
  end

  def sessionless_user?
    @env[:sessionless] == true
  end

  def authenticity_token
    @env[:authenticity_token]
  end

  private

  def skip_filter?(name)
    options = self.class.skip_for(name)
    return false if options.nil?

    condition = options[:if]
    return true if condition.nil?

    instance_exec(&condition)
  end

  def halt(status, message)
    raise FilterHalt.new(status, { 'errors' => [{ 'message' => message }] })
  end

  def rate_limit_key
    current_user.nil? ? 'anonymous' : "user:#{current_user.id}"
  end

  def rate_limit
    self.class.rate_limit_counts[rate_limit_key] += 1
  end

  def authenticate_user!
    nil
  end

  def active_user_check
    nil
  end

  def enforce_read_only_organization
    nil
  end

  def verify_authenticity_token
    return if authenticity_token.to_s == 'valid-csrf-token'

    halt(422, 'Invalid authenticity token')
  end

  def check_two_factor_requirement
    return if current_user.nil?
    return unless current_user.two_factor_required
    return if current_user.two_factor_verified

    halt(401, 'Two-factor authentication required')
  end

  def authorize_access_api!
    nil
  end

  def execute
    { 'data' => { 'echo' => 'ok' } }
  end
end
