// The five REST-hook event triggers, built from the shared factory.

const { buildHookTrigger } = require('../lib/hooks');

const SID = '00000000-0000-4000-8000-000000000001';
const AID = '00000000-0000-4000-8000-000000000002';

const callEnded = buildHookTrigger({
  key: 'call_ended',
  event: 'call.ended',
  noun: 'Call',
  label: 'Call Ended',
  description: 'Triggers when a call finishes, optionally with the recording URL and full transcript.',
  extraFields: [
    {
      key: 'include_transcript',
      label: 'Include Transcript',
      type: 'boolean',
      default: 'true',
      helpText: 'Attach the conversation transcript to the event.',
    },
    {
      key: 'include_recording',
      label: 'Include Recording',
      type: 'boolean',
      default: 'false',
      helpText: 'Attach a (time-limited) recording URL to the event.',
    },
  ],
  sample: {
    event: 'call.ended',
    sessionId: SID,
    agentId: AID,
    durationSecs: 142,
    messageCount: 18,
    fromOrTo: '+14155550123',
    variables: { customer_name: 'Sample Customer' },
    transcript: [
      { role: 'assistant', text: 'Hello! How can I help you today?', at: '2026-01-01T12:00:02Z' },
      { role: 'user', text: "I'd like to check my order status.", at: '2026-01-01T12:00:07Z' },
    ],
  },
  outputFields: [
    { key: 'sessionId', label: 'Call ID' },
    { key: 'agentId', label: 'Agent ID' },
    { key: 'durationSecs', label: 'Duration (seconds)', type: 'integer' },
    { key: 'fromOrTo', label: 'Caller / Dialed Number' },
  ],
});

const callStarted = buildHookTrigger({
  key: 'call_started',
  event: 'call.started',
  noun: 'Call',
  label: 'Call Started',
  description: 'Triggers when a call becomes active.',
  sample: {
    event: 'call.started',
    sessionId: SID,
    agentId: AID,
    from: '+14155550123',
    variables: { customer_name: 'Sample Customer' },
    startTime: '2026-01-01T12:00:00Z',
  },
  outputFields: [
    { key: 'sessionId', label: 'Call ID' },
    { key: 'agentId', label: 'Agent ID' },
    { key: 'from', label: 'Caller Number' },
  ],
});

const callAnalyzed = buildHookTrigger({
  key: 'call_analyzed',
  event: 'call.analyzed',
  noun: 'Call Analysis',
  label: 'Call Analyzed',
  description:
    'Triggers when post-call AI analysis is ready: summary, sentiment, disposition and action items. The best trigger for CRM updates.',
  sample: {
    event: 'call.analyzed',
    sessionId: SID,
    analysis: {
      summary: 'Sample: customer asked about an order and the agent confirmed it shipped.',
      sentiment: 'positive',
      sentimentScore: 0.8,
      disposition: 'resolved',
      actionItems: ['Email the tracking link to the customer'],
      topics: ['order status'],
      keywords: ['order', 'shipping'],
      score: 9,
    },
  },
  outputFields: [
    { key: 'sessionId', label: 'Call ID' },
    { key: 'analysis__summary', label: 'Summary' },
    { key: 'analysis__sentiment', label: 'Sentiment' },
    { key: 'analysis__disposition', label: 'Disposition' },
  ],
});

const recordingReady = buildHookTrigger({
  key: 'recording_ready',
  event: 'recording.ready',
  noun: 'Recording',
  label: 'Recording Ready',
  description: 'Triggers when a call recording has finished processing.',
  sample: {
    event: 'recording.ready',
    recordingId: '00000000-0000-4000-8000-000000000004',
    sessionId: SID,
    agentId: AID,
    durationSecs: 142,
    recording: {
      id: '00000000-0000-4000-8000-000000000004',
      url: 'https://example.com/recordings/sample.wav',
      expiresAt: '2026-01-01T13:00:00Z',
    },
  },
  outputFields: [
    { key: 'sessionId', label: 'Call ID' },
    { key: 'recording__url', label: 'Recording URL' },
  ],
});

const toolInvoked = buildHookTrigger({
  key: 'tool_invoked',
  event: 'tool.invoked',
  noun: 'Tool Call',
  label: 'Tool Invoked',
  description: 'Triggers when the AI agent calls one of its tools during a conversation.',
  sample: {
    event: 'tool.invoked',
    sessionId: SID,
    agentId: AID,
    name: 'lookup_order',
    arguments: { orderId: 'SAMPLE-1234' },
    result: { status: 'shipped' },
    status: 'ok',
    latencyMs: 320,
  },
  outputFields: [
    { key: 'sessionId', label: 'Call ID' },
    { key: 'name', label: 'Tool Name' },
    { key: 'status', label: 'Status' },
  ],
});

module.exports = { callEnded, callStarted, callAnalyzed, recordingReady, toolInvoked };
