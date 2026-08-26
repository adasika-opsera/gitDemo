# frozen_string_literal: true

require 'contracts/generator'

namespace :contracts do
  desc 'Generate Ruby and TypeScript enum artifacts from config/contracts/enums.yml'
  task :generate do
    root = File.expand_path('../..', __dir__)
    contract_path = ENV.fetch('CONTRACT_PATH', File.join(root, 'config/contracts/enums.yml'))
    schema_path = File.join(root, 'config/contracts/enums.schema.json')
    baseline_path = ENV.fetch('BASELINE_PATH', contract_path)

    generator = Contracts::Generator.new(
      root: root,
      contract_path: contract_path,
      schema_path: schema_path,
      baseline_path: baseline_path
    )

    result = generator.generate!
    puts "Generated #{result[:ruby_path]} and #{result[:typescript_path]}"
  end

  desc 'Validate contract without writing generated files (check mode hook for WO-011)'
  task :validate do
    root = File.expand_path('../..', __dir__)
    contract_path = ENV.fetch('CONTRACT_PATH', File.join(root, 'config/contracts/enums.yml'))
    schema_path = File.join(root, 'config/contracts/enums.schema.json')
    baseline_path = ENV.fetch('BASELINE_PATH', contract_path)

    incoming = YAML.safe_load(File.read(contract_path), permitted_classes: [Date, Time], aliases: true)
    Contracts::ContractParser.ensure_hash!(incoming)
    Contracts::SchemaValidator.new(schema_path: schema_path).validate!(incoming)
    Contracts::CaseConverter.validate_no_secret_fields!(incoming)
    Contracts::AppendOnlyEnforcer.new(
      YAML.safe_load(File.read(baseline_path), permitted_classes: [Date, Time], aliases: true)
    ).enforce!(incoming)

    puts 'Contract validation passed'
  end
end
