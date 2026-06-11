import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

interface TelenowHook {
	id: string;
	target_url: string;
	events: string[];
}

// Webhook trigger backed by Telenow's REST-hooks API (/api/v1/hooks):
// activating the workflow subscribes this n8n webhook URL to the selected
// events; deactivating unsubscribes. Subscriptions registered here carry
// source=n8n so they're labeled in the Telenow dashboard and checkExists
// only matches hooks this node created.
export class TelenowTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Telenow Trigger',
		name: 'telenowTrigger',
		icon: 'file:telenow.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Telenow call events occur',
		defaults: {
			name: 'Telenow Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'telenowApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['call.ended'],
				options: [
					{
						name: 'Call Analyzed',
						value: 'call.analyzed',
						description: 'Post-call AI analysis is ready (summary, sentiment, disposition)',
					},
					{
						name: 'Call Ended',
						value: 'call.ended',
						description: 'A call finished (optionally with recording and transcript)',
					},
					{
						name: 'Call Started',
						value: 'call.started',
						description: 'A call became active',
					},
					{
						name: 'Recording Ready',
						value: 'recording.ready',
						description: 'A call recording finished processing',
					},
					{
						name: 'Tool Invoked',
						value: 'tool.invoked',
						description: 'The agent called one of its tools during a conversation',
					},
					{
						name: 'Transcript Turn',
						value: 'transcript.ready',
						description: 'A transcript turn was produced (fires per utterance, during the call)',
					},
				],
			},
			{
				displayName: 'Agent Name or ID',
				name: 'agentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				default: '',
				description:
					'Only receive events for this agent — leave empty for all agents. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Include Recording',
				name: 'includeRecording',
				type: 'boolean',
				default: false,
				description: 'Whether to attach the recording URL to call.ended events',
			},
			{
				displayName: 'Include Transcript',
				name: 'includeTranscript',
				type: 'boolean',
				default: true,
				description: 'Whether to attach the full transcript to call.ended events',
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
				const all: INodePropertyOptions[] = [{ name: 'All Agents', value: '' }];
				return all.concat((response.agents ?? []).map((a) => ({ name: a.name, value: a.id })));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const webhookData = this.getWorkflowStaticData('node');
				const credentials = await this.getCredentials('telenowApi');
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'telenowApi',
					{
						method: 'GET',
						url: `${credentials.baseUrl}/api/v1/hooks`,
						qs: { source: 'n8n' },
						json: true,
					},
				)) as { hooks: TelenowHook[] };
				for (const hook of response.hooks ?? []) {
					if (hook.target_url === webhookUrl) {
						webhookData.webhookId = hook.id;
						return true;
					}
				}
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const webhookData = this.getWorkflowStaticData('node');
				const credentials = await this.getCredentials('telenowApi');
				const events = this.getNodeParameter('events') as string[];
				const agentId = this.getNodeParameter('agentId') as string;
				const body: Record<string, unknown> = {
					target_url: webhookUrl,
					events,
					include_recording: this.getNodeParameter('includeRecording') as boolean,
					include_transcript: this.getNodeParameter('includeTranscript') as boolean,
					source: 'n8n',
				};
				if (agentId) body.agent_id = agentId;
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'telenowApi',
					{
						method: 'POST',
						url: `${credentials.baseUrl}/api/v1/hooks`,
						body,
						json: true,
					},
				)) as TelenowHook;
				if (!response.id) return false;
				webhookData.webhookId = response.id;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (!webhookData.webhookId) return true;
				const credentials = await this.getCredentials('telenowApi');
				try {
					await this.helpers.httpRequestWithAuthentication.call(this, 'telenowApi', {
						method: 'DELETE',
						url: `${credentials.baseUrl}/api/v1/hooks/${webhookData.webhookId}`,
						json: true,
					});
				} catch {
					// Unsubscribe is idempotent server-side; a transient failure here
					// must not block deactivating the workflow.
					return false;
				}
				delete webhookData.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
