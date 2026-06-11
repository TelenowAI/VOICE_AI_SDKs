// Factory for REST-hook triggers. All five event triggers share the same
// subscribe/unsubscribe/perform plumbing against /api/v1/hooks — only the
// event name, copy, sample and extra input fields differ.

const { baseUrl } = require('./api');

const AGENT_FIELD = {
  key: 'agent_id',
  label: 'Agent',
  required: false,
  dynamic: 'agent_list.id.name',
  helpText: 'Only fire for this agent. Leave empty for all agents.',
};

const buildHookTrigger = ({ key, event, noun, label, description, extraFields = [], sample, outputFields = [] }) => {
  const performSubscribe = async (z, bundle) => {
    const body = {
      event,
      target_url: bundle.targetUrl,
      source: 'zapier',
    };
    if (bundle.inputData.agent_id) body.agent_id = bundle.inputData.agent_id;
    if (bundle.inputData.include_transcript !== undefined)
      body.include_transcript = bundle.inputData.include_transcript;
    if (bundle.inputData.include_recording !== undefined)
      body.include_recording = bundle.inputData.include_recording;
    const response = await z.request({
      url: `${baseUrl(bundle)}/api/v1/hooks`,
      method: 'POST',
      body,
    });
    // Whole object is retained as bundle.subscribeData; `.id` drives unsubscribe.
    return response.data;
  };

  const performUnsubscribe = async (z, bundle) => {
    const hookId = bundle.subscribeData && bundle.subscribeData.id;
    if (!hookId) return {};
    const response = await z.request({
      url: `${baseUrl(bundle)}/api/v1/hooks/${hookId}`,
      method: 'DELETE',
    });
    return response.data;
  };

  // Inbound webhook → one Zap run per event. Telenow sends the event object
  // as the whole body.
  const perform = (z, bundle) => [bundle.cleanedRequest];

  // Sample data for the Zap editor: the org's latest real event of this type,
  // or the API's canned dummy when there's no history yet.
  const performList = async (z, bundle) => {
    const response = await z.request({
      url: `${baseUrl(bundle)}/api/v1/events/sample`,
      params: { type: event },
    });
    return response.data.samples || [];
  };

  return {
    key,
    noun,
    display: { label, description },
    operation: {
      type: 'hook',
      inputFields: [AGENT_FIELD, ...extraFields],
      performSubscribe,
      performUnsubscribe,
      perform,
      performList,
      sample,
      outputFields,
    },
  };
};

module.exports = { buildHookTrigger };
