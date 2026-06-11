// Hidden polling triggers that back dynamic dropdowns ("Choose agent",
// "From number"). Never shown as user-facing triggers.

const { baseUrl } = require('../lib/api');

const agentList = {
  key: 'agent_list',
  noun: 'Agent',
  display: {
    label: 'Agent List',
    description: 'Internal: powers the agent dropdown.',
    hidden: true,
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        url: `${baseUrl(bundle)}/api/v1/agents`,
        params: { is_active: true, limit: 200 },
      });
      return (response.data.agents || []).map((a) => ({ id: a.id, name: a.name }));
    },
  },
};

const numberList = {
  key: 'number_list',
  noun: 'Phone Number',
  display: {
    label: 'Phone Number List',
    description: 'Internal: powers the phone-number dropdown.',
    hidden: true,
  },
  operation: {
    perform: async (z, bundle) => {
      const response = await z.request({
        url: `${baseUrl(bundle)}/api/v1/numbers`,
      });
      return (response.data.numbers || []).map((n) => ({ id: n.id, name: n.phone_number }));
    },
  },
};

module.exports = { agentList, numberList };
