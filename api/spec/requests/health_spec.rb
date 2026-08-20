require 'swagger_helper'

RSpec.describe 'Health Check API', type: :request do
  path '/api/v1/health' do
    get 'Checks the health of the API' do
      tags 'Health'
      produces 'application/json'

      response '200', 'API is healthy' do
        schema type: :object,
               properties: {
                 status: { type: :string }
               },
               required: ['status']

        run_test! do |response|
          data = JSON.parse(response.body)
          expect(data['status']).to eq('ok')
        end
      end
    end
  end
end