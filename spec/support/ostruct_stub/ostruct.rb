# frozen_string_literal: true

# Ruby 4 no longer ships ostruct as a default gem. RuboCop 1.28 requires the
# file from its HTML formatter and does not use OpenStruct on the cop path.
class OpenStruct
end
