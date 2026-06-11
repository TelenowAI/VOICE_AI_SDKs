const { baseUrl } = require('../lib/api');

// Place an outbound PSTN call handled by an AI agent. Uses the established
// /api/sessions/initiate-call endpoint (already API-key authed); its response
// is enveloped, so we unwrap `data`.
const perform = async (z, bundle) => {
  const body = {
    agentId: bundle.inputData.agent_id,
    mobileNumber: bundle.inputData.to_number,
  };
  if (bundle.inputData.first_response) body.firstResponse = bundle.inputData.first_response;
  if (bundle.inputData.machine_detection) body.machineDetection = bundle.inputData.machine_detection;
  if (bundle.inputData.identifier) body.identifier = bundle.inputData.identifier;
  if (bundle.inputData.variables) body.variables = bundle.inputData.variables;

  const response = await z.request({
    url: `${baseUrl(bundle)}/api/sessions/initiate-call`,
    method: 'POST',
    body,
  });
  return response.data.data || response.data;
};

module.exports = {
  key: 'initiate_call',
  noun: 'Call',
  display: {
    label: 'Place AI Agent Call',
    description: 'Dials a phone number and connects it to one of your AI agents.',
  },
  operation: {
    perform,
    inputFields: [
      {
        key: 'agent_id',
        label: 'Agent',
        required: true,
        dynamic: 'agent_list.id.name',
        helpText: 'The AI agent that will handle the conversation.',
      },
      {
        key: 'to_number',
        label: 'To Number',
        required: true,
        type: 'string',
        placeholder: '+14155550123',
        helpText: 'Destination phone number in E.164 format.',
      },
      {
        key: 'variables',
        label: 'Context Variables',
        dict: true,
        required: false,
        helpText:
          'Key/value pairs substituted into the agent\'s prompt and greeting as `{placeholder}` values — e.g. `customer_name` → `Alex`.',
      },
      {
        key: 'first_response',
        label: 'Opening Line',
        required: false,
        type: 'text',
        helpText: 'Overrides the agent\'s default greeting for this call.',
      },
      {
        key: 'machine_detection',
        label: 'On Answering Machine',
        required: false,
        choices: { true: 'Continue talking', hangup: 'Hang up' },
        helpText: 'What to do when answering-machine detection triggers.',
      },
      {
        key: 'identifier',
        label: 'Caller Identifier',
        required: false,
        helpText:
          'Trusted ID for the person being called (e.g. an account ID); injected into the agent\'s tool calls when caller identity is enabled.',
      },
    ],
    sample: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      status: 'initiated',
    },
  },
};
