require 'swagger_helper'

RSpec.describe 'Portfolios Fit/Gap API', type: :request do
  path '/api/v1/portfolios/{id}/fitgap' do
    parameter name: 'id', in: :path, type: :string, description: 'ID Portfolio'

    post 'Generate Fit/Gap Analysis' do
      tags 'Portfolios'
      security [Bearer: []]
      consumes 'application/json'
      produces 'application/json'

      parameter name: :payload, in: :body, schema: {
        type: :object,
        properties: {
          vacancy_id: { type: :string }
        },
        required: ['vacancy_id']
      }

      response '202', 'Fit/Gap successfully generated' do
        let!(:tenant) { create(:organization, scheme: 'rakamin') }
        let(:token) { JsonWebToken.encode(user_id: 'dummy', role: 'admin', scheme: tenant.scheme) }
        let(:Authorization) { "Bearer #{token}" }
        
        let(:assessment) { create(:assessment, organization: tenant) }
        let(:session) { create(:session, assessment: assessment) }
        let(:portfolio) { create(:portfolio, session: session, generation_status: 'complete') }
        let(:id) { portfolio.id }
        
        let(:vacancy) { create(:vacancy, organization: tenant) }
        let(:payload) { { vacancy_id: vacancy.id } }

        run_test!
      end
    end
  end

  path '/api/v1/portfolios/{id}/regenerate_fitgap' do
    parameter name: 'id', in: :path, type: :string, description: 'ID Portfolio'

    post 'Regenerate Fit/Gap Analysis' do
      tags 'Portfolios'
      security [Bearer: []]
      consumes 'application/json'
      produces 'application/json'

      parameter name: :payload, in: :body, schema: {
        type: :object,
        properties: {
          vacancy_id: { type: :string }
        },
        required: ['vacancy_id']
      }

      response '202', 'Fit/Gap successfully regenerated' do
        let!(:tenant) { create(:organization, scheme: 'rakamin') }
        let(:token) { JsonWebToken.encode(user_id: 'dummy', role: 'admin', scheme: tenant.scheme) }
        let(:Authorization) { "Bearer #{token}" }
        
        let(:assessment) { create(:assessment, organization: tenant) }
        let(:session) { create(:session, assessment: assessment) }
        let(:portfolio) { create(:portfolio, session: session, generation_status: 'complete') }
        let(:id) { portfolio.id }
        
        let(:vacancy) { create(:vacancy, organization: tenant) }
        let(:payload) { { vacancy_id: vacancy.id } }

        run_test!
      end
    end
  end

  path '/api/v1/portfolios/{id}/fitgap/{vacancy_id}' do
    parameter name: 'id', in: :path, type: :string, description: 'ID Portfolio'
    parameter name: 'vacancy_id', in: :path, type: :string, description: 'ID Vacancy'

    get 'Retrieves Fit/Gap Analysis result' do
      tags 'Portfolios'
      security [Bearer: []]
      produces 'application/json'

      response '200', 'Displays analysis result' do
        let!(:tenant) { create(:organization, scheme: 'rakamin') }
        let(:token) { JsonWebToken.encode(user_id: 'dummy', role: 'admin', scheme: tenant.scheme) }
        let(:Authorization) { "Bearer #{token}" }
        
        let(:assessment) { create(:assessment, organization: tenant) }
        let(:session) { create(:session, assessment: assessment) }
        let(:portfolio) { create(:portfolio, session: session, generation_status: 'complete') }
        let(:id) { portfolio.id }
        
        let(:vacancy) { create(:vacancy, organization: tenant) }
        let(:vacancy_id) { vacancy.id }
        
        # Create dummy report so GET does not return 404
        let!(:report) { create(:fit_gap_report, portfolio: portfolio, vacancy: vacancy) }

        run_test!
      end
    end
  end
end
