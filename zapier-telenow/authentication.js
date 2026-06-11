const { baseUrl, DEFAULT_BASE } = require('./lib/api');

// Custom (API key) auth: the key is created self-serve in the Telenow
// dashboard (Developers → API Keys), which satisfies Zapier's "no email
// round-trip to get credentials" listing requirement.
const test = async (z, bundle) => {
  const response = await z.request({ url: `${baseUrl(bundle)}/api/v1/me` });
  return response.data; // flat: { org_id, org_name, key_id, key_name, key_role }
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      required: true,
      type: 'password',
      helpText:
        'Create one in the [Telenow dashboard](https://app.telenow.ai) under **Developers → API Keys**. Keys look like `vai_live_…` and need the `developer` role (or above) to manage triggers.',
    },
    {
      key: 'base_url',
      label: 'API Base URL',
      required: false,
      default: DEFAULT_BASE,
      helpText: 'Only change this for self-hosted or regional Telenow deployments.',
    },
  ],
  test,
  // Shown on the connection chip: "Telenow (Acme Corp)".
  connectionLabel: '{{org_name}}',
};
