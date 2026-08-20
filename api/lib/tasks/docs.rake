    namespace :docs do
      desc "Run RSpec tests and generate Swagger documentation if tests pass"
      task :generate do
        puts "Running API tests..."
        
        test_result = system("bundle exec rspec spec/requests")
        
        if test_result
          puts "Tests passed! Generating Swagger YAML..."
          system("bundle exec rake rswag:specs:swaggerize RAILS_ENV=test")
          puts "Done! Open path /api-docs"
        else
          puts "FAILED: RSpec failed. Swaggerize cancelled to keep documentation honest."
          exit 1
        end
      end
    end