require 'swagger_helper'

RSpec.describe 'Auth Login', type: :request do
  path '/api/v1/auth/login' do
    post 'Authenticates a user' do
      tags 'Authentication'
      consumes 'application/json'
      produces 'application/json'

      parameter name: :credentials, in: :body, schema: {
        type: :object,
        properties: {
          email: { type: :string, example: 'admin@rakamin.com' },
          password: { type: :string, example: 'password123' }
        }
      }

      response '200', 'User authenticated' do
        let(:credentials) { { email: 'admin@rakamin.com', password: 'password123' } }
        run_test!
      end

      response '401', 'Invalid credentials' do
        let(:credentials) { { email: 'admin@rakamin.com', password: 'wrongpassword' } }
        run_test!
      end
    end
  end
end