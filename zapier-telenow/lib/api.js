// Shared helpers: base-url resolution, auth header middleware, error surfacing.

const DEFAULT_BASE = 'https://api.telenow.ai';

const baseUrl = (bundle) =>
  ((bundle.authData && bundle.authData.base_url) || DEFAULT_BASE).replace(/\/+$/, '');

// Attach the org API key to every outbound request.
const includeApiKey = (request, z, bundle) => {
  if (bundle.authData && bundle.authData.api_key) {
    request.headers = request.headers || {};
    request.headers['X-API-Key'] = bundle.authData.api_key;
  }
  return request;
};

// Convert API errors into Zapier-friendly messages. The platform halts the
// Zap with whatever we throw; the raw body is more useful than "400".
const handleErrors = (response, z) => {
  if (response.status === 401) {
    throw new z.errors.Error(
      'Your Telenow API key is invalid or was revoked. Reconnect the account.',
      'AuthenticationError',
      response.status
    );
  }
  if (response.status >= 400) {
    let message = `Telenow API error (HTTP ${response.status})`;
    try {
      const body = response.json || JSON.parse(response.content);
      if (body && body.error) message = body.error;
    } catch (e) {
      // non-JSON body — keep the generic message
    }
    throw new z.errors.Error(message, 'TelenowAPIError', response.status);
  }
  return response;
};

module.exports = { DEFAULT_BASE, baseUrl, includeApiKey, handleErrors };
