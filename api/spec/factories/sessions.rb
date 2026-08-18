FactoryBot.define do
  factory :session do
    association :assessment
    invite_token { SecureRandom.hex(32) }
    status { 'pending' }
    tenant_id { assessment.tenant_id }
  end
end
