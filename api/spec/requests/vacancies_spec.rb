require 'swagger_helper'

RSpec.describe 'Vacancy API', type: :request do
  path '/api/v1/vacancies' do
    get 'Retrieves a list of vacancies' do
      tags 'Vacancies'
      produces 'application/json'

      security [Bearer: []]

      response '200', 'List of vacancies' do
        let!(:tenant) do
          Organization.create!(
            name: 'Rakamin', 
            scheme: 'rakamin', 
            identifier: 'rakamin', 
            host: 'localhost'
          )
        end
        
        let(:token) do 
          JsonWebToken.encode(
            user_id: 'dummy-user-id', 
            role: 'admin', 
            scheme: tenant.scheme,
          ) 
        end
        let(:Authorization) { "Bearer #{token}" }
        
        schema type: :object,
              properties: {
                vacancies: { 
                  type: :array,
                  items: { 
                    type: :object, 
                    properties: {
                      id: { type: :integer },
                      role_title: { type: :string },
                      culture_dimensions: { type: :string },
                      competency_expectations: { type: :string },
                      created_by: { type: :integer },
                      created_at: { type: :string, format: 'date-time' },
                      updated_at: { type: :string, format: 'date-time' },
                    },
                  }
                },
                meta: { type: :object },
              },
              required: ['vacancies', 'meta']

        run_test!
      end

      response '403', 'Tenant not found' do
        let(:Authorization) { 'Bearer invalidtoken' }
        run_test!
      end
    end
  end
end