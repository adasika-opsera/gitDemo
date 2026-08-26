# frozen_string_literal: true

class ProjectService
  def self.lookup_assignee(project_id)
    project = Project.find(project_id)
    project.display_name
  end

  def self.setup_database_yml
    DatabaseConfig.load
  end
end
