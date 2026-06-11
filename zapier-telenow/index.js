const packageJson = require('./package.json');
const zapier = require('zapier-platform-core');

const authentication = require('./authentication');
const { includeApiKey, handleErrors } = require('./lib/api');
const { callEnded, callStarted, callAnalyzed, recordingReady, toolInvoked } = require('./triggers/call_events');
const { agentList, numberList } = require('./triggers/dropdowns');
const initiateCall = require('./creates/initiate_call');
const findCalls = require('./searches/find_calls');

module.exports = {
  version: packageJson.version,
  platformVersion: zapier.version,

  authentication,

  beforeRequest: [includeApiKey],
  afterResponse: [handleErrors],

  triggers: {
    [callEnded.key]: callEnded,
    [callAnalyzed.key]: callAnalyzed,
    [callStarted.key]: callStarted,
    [recordingReady.key]: recordingReady,
    [toolInvoked.key]: toolInvoked,
    [agentList.key]: agentList,
    [numberList.key]: numberList,
  },

  creates: {
    [initiateCall.key]: initiateCall,
  },

  searches: {
    [findCalls.key]: findCalls,
  },
};
