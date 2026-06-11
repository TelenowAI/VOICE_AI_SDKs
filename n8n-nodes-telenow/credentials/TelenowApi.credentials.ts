import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TelenowApi implements ICredentialType {
	name = 'telenowApi';

	displayName = 'Telenow API';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased -- full URL to our own docs; the miscased rule's autofix conflicts with cred-class-field-documentation-url-not-http-url
	documentationUrl = 'https://telenow.ai/docs/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in the Telenow dashboard under Developers → API Keys. Keys look like vai_live_…',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.telenow.ai',
			description: 'Change only for self-hosted or regional deployments',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/me',
		},
	};
}
