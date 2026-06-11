import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

// Declarative (routing-based) node: every operation maps straight onto the
// Telenow REST API. The org is implied by the API key, so no org picker.
export class Telenow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Telenow',
		name: 'telenow',
		icon: 'file:telenow.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Place AI agent calls and read calls, agents and numbers from Telenow',
		defaults: {
			name: 'Telenow',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'telenowApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Agent', value: 'agent' },
					{ name: 'Call', value: 'call' },
					{ name: 'Phone Number', value: 'number' },
				],
				default: 'call',
			},

			// ------------------------------------------------------- call
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['call'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Place an outbound AI call',
						description: 'Dial a phone number and connect it to an AI agent',
						routing: {
							request: {
								method: 'POST',
								url: '/api/sessions/initiate-call',
							},
						},
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get a call',
						description: 'Fetch one call with its transcript',
						routing: {
							request: {
								method: 'GET',
								url: '=/api/v1/calls/{{$parameter.callId}}',
							},
						},
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many calls',
						description: 'List recent calls, newest first',
						routing: {
							request: {
								method: 'GET',
								url: '/api/v1/calls',
							},
							output: {
								postReceive: [
									{
										type: 'rootProperty',
										properties: { property: 'calls' },
									},
								],
							},
						},
					},
				],
				default: 'create',
			},
			{
				displayName: 'Agent Name or ID',
				name: 'agentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				required: true,
				default: '',
				description:
					'The AI agent that handles the call. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['call'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'agentId' } },
			},
			{
				displayName: 'To Number',
				name: 'mobileNumber',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+14155550123',
				description: 'Destination phone number in E.164 format',
				displayOptions: { show: { resource: ['call'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'mobileNumber' } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['call'], operation: ['create'] } },
				options: [
					{
						displayName: 'Opening Line',
						name: 'firstResponse',
						type: 'string',
						default: '',
						description: 'Overrides the agent\'s default greeting for this call',
						routing: { send: { type: 'body', property: 'firstResponse' } },
					},
					{
						displayName: 'On Answering Machine',
						name: 'machineDetection',
						type: 'options',
						options: [
							{ name: 'Continue Talking', value: 'true' },
							{ name: 'Hang Up', value: 'hangup' },
						],
						default: 'hangup',
						description: 'What to do when answering-machine detection triggers',
						routing: { send: { type: 'body', property: 'machineDetection' } },
					},
					{
						displayName: 'Caller Identifier',
						name: 'identifier',
						type: 'string',
						default: '',
						description:
							'Trusted ID for the person being called (e.g. an account ID) — injected into the agent\'s tool calls when caller identity is enabled',
						routing: { send: { type: 'body', property: 'identifier' } },
					},
					{
						displayName: 'Context Variables',
						name: 'variables',
						type: 'json',
						default: '{}',
						description:
							'JSON object of {placeholder} values substituted into the agent\'s prompt and greeting, e.g. {"customer_name": "Alex"}',
						routing: {
							send: {
								type: 'body',
								property: 'variables',
								value:
									'={{ typeof $value === "object" ? $value : JSON.parse($value || "{}") }}',
							},
						},
					},
				],
			},
			{
				displayName: 'Call ID',
				name: 'callId',
				type: 'string',
				required: true,
				default: '',
				description: 'The session ID of the call',
				displayOptions: { show: { resource: ['call'], operation: ['get'] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['call'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Agent Name or ID',
						name: 'agentId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getAgents' },
						default: '',
						description:
							'Only calls handled by this agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
						routing: { send: { type: 'query', property: 'agent_id' } },
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Ended', value: 'ended' },
						],
						default: 'ended',
						routing: { send: { type: 'query', property: 'status' } },
					},
				],
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['call'], operation: ['getAll'] } },
				routing: { send: { type: 'query', property: 'limit' } },
			},

			// ------------------------------------------------------ agent
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['agent'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many agents',
						description: 'List the organization\'s AI agents',
						routing: {
							request: {
								method: 'GET',
								url: '/api/v1/agents',
							},
							output: {
								postReceive: [
									{
										type: 'rootProperty',
										properties: { property: 'agents' },
									},
								],
							},
						},
					},
				],
				default: 'getAll',
			},

			// ----------------------------------------------------- number
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['number'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many phone numbers',
						description: 'List the organization\'s phone numbers',
						routing: {
							request: {
								method: 'GET',
								url: '/api/v1/numbers',
							},
							output: {
								postReceive: [
									{
										type: 'rootProperty',
										properties: { property: 'numbers' },
									},
								],
							},
						},
					},
				],
				default: 'getAll',
			},
		],
	};

	methods = {
		loadOptions: {
			async getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('telenowApi');
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'telenowApi',
					{
						method: 'GET',
						url: `${credentials.baseUrl}/api/v1/agents`,
						qs: { is_active: true, limit: 200 },
						json: true,
					},
				)) as { agents: Array<{ id: string; name: string }> };
				return (response.agents ?? []).map((a) => ({ name: a.name, value: a.id }));
			},
		},
	};
}
