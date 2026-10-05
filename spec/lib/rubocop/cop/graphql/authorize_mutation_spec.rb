# frozen_string_literal: true

require 'spec_helper'

begin
  require 'ostruct'
rescue LoadError
  $LOAD_PATH.unshift File.expand_path('../../../../../support/ostruct_stub', __FILE__)
  require 'ostruct'
end

require 'rubocop'
require_relative '../../../../../lib/rubocop/cop/graphql/authorize_mutation'

RSpec.describe RuboCop::Cop::Graphql::AuthorizeMutation do
  let(:fixtures) { File.expand_path('../../../../../fixtures/rubocop/graphql', __FILE__) }

  def offenses_for(filename)
    described_class.reset_registry!
    path = File.join(fixtures, filename)
    processed = RuboCop::ProcessedSource.from_file(path, 2.6)
    config = RuboCop::Config.new(
      { 'Graphql/AuthorizeMutation' => { 'Enabled' => true } },
      ROOT
    )
    team = RuboCop::Cop::Team.new([described_class], config, raise_error: true)
    team.investigate(processed).offenses
  end

  it 'accepts a mutation that declares authorize' do
    expect(offenses_for('declared_mutation.rb')).to eq([])
  end

  it 'accepts an explicit anonymous declaration' do
    expect(offenses_for('anonymous_mutation.rb')).to eq([])
  end

  it 'accepts a mutation that inherits authorize from its parent' do
    expect(offenses_for('inherited_mutation.rb')).to eq([])
  end

  it 'fails an undeclared mutation and names the declaration to add' do
    offenses = offenses_for('undeclared_mutation.rb')

    expect(offenses.length).to eq(1)
    expect(offenses.first.message).to include('UndeclaredMutation')
    expect(offenses.first.message).to include('authorize :ability_name')
  end

  it 'fails an EE-only mutation that has no authorize declaration' do
    offenses = offenses_for('ee_undeclared_mutation.rb')

    expect(offenses.length).to eq(1)
    expect(offenses.first.message).to include('ExportMutation')
    expect(offenses.first.message).to include('authorize :ability_name')
  end
end
