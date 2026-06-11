const { baseUrl } = require('../lib/api');

// Find recent calls (newest first), optionally filtered by agent / status.
const perform = async (z, bundle) => {
  const params = { limit: bundle.inputData.limit || 25 };
  if (bundle.inputData.agent_id) params.agent_id = bundle.inputData.agent_id;
  if (bundle.inputData.status) params.status = bundle.inputData.status;
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/calls`,
    params,
  });
  return response.data.calls || [];
};

module.exports = {
  key: 'find_calls',
  noun: 'Call',
  display: {
    label: 'Find Calls',
    description: 'Finds recent calls, newest first.',
  },
  operation: {
    perform,
    inputFields: [
      {
        key: 'agent_id',
        label: 'Agent',
        required: false,
        dynamic: 'agent_list.id.name',
      },
      {
        key: 'status',
        label: 'Status',
        required: false,
        choices: { active: 'Active', ended: 'Ended' },
      },
      {
        key: 'limit',
        label: 'Max Results',
        required: false,
        type: 'integer',
        default: '25',
      },
    ],
    sample: {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'ended',
      channel: 'telephony',
      direction: 'outbound',
      from_number: '+14155550100',
      to_number: '+14155550123',
      duration_sec: 142,
      disposition: 'resolved',
    },
  },
};
