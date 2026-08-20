require 'swagger_helper'

RSpec.describe 'Sessions API', type: :request do


  path '/api/v1/sessions/{id}/portfolio' do
    parameter name: 'id', in: :path, type: :string, description: 'ID Session'

    get 'Retrieves Portfolio details by Session' do
      tags 'Sessions'
      security [Bearer: []]
      produces 'application/json'

      response '200', 'Displays portfolio details' do
        let!(:tenant) { create(:organization, scheme: 'rakamin') }
        let(:token) { JsonWebToken.encode(user_id: 'dummy', role: 'admin', scheme: tenant.scheme) }
        let(:Authorization) { "Bearer #{token}" }
        
        let(:assessment) { create(:assessment, organization: tenant) }
        let(:session) { create(:session, assessment: assessment) }
        let!(:portfolio) { create(:portfolio, session: session, generation_status: 'complete') }
        let(:id) { session.id }

        run_test!
      end
    end
  end
end
