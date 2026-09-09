import type { IExecuteFunctions, ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { wordpressApiRequest, wordpressApiRequestWithResponse } from '../../v2/transport';

type AuthType = 'basicAuth' | 'oAuth2';

function createContext(authType: AuthType = 'basicAuth') {
	const requestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
	const getNodeParameter = vi.fn().mockReturnValue(authType);
	const getCredentials = vi.fn().mockImplementation((credentialType: string) => {
		if (credentialType === 'wordpressOAuth2Api') {
			return { wordpressSite: 'https://myblog.wordpress.com/path' };
		}
		return {
			url: 'https://wordpress.example/subdirectory/',
			allowUnauthorizedCerts: true,
		};
	});
	const context = {
		getNode: vi.fn().mockReturnValue({ name: 'WordPress' } as INode),
		getNodeParameter,
		getCredentials,
		helpers: { requestWithAuthentication },
	} as unknown as IExecuteFunctions;

	return { context, getCredentials, getNodeParameter, requestWithAuthentication };
}

function createLoadOptionsContext(authType?: AuthType) {
	const requestWithAuthentication = vi.fn().mockResolvedValue({ ok: true });
	const getCurrentNodeParameter = vi.fn().mockReturnValue(authType);
	const getCredentials = vi
		.fn()
		.mockImplementation((credentialType: string) =>
			credentialType === 'wordpressOAuth2Api'
				? { wordpressSite: 'myblog.wordpress.com' }
				: { url: 'https://wordpress.example', allowUnauthorizedCerts: false },
		);
	const context = {
		getNode: vi.fn().mockReturnValue({ name: 'WordPress' } as INode),
		getCurrentNodeParameter,
		getCredentials,
		helpers: { requestWithAuthentication },
	} as unknown as ILoadOptionsFunctions;
	return { context, getCredentials, getCurrentNodeParameter, requestWithAuthentication };
}

describe('WordPress v2 transport', () => {
	it('uses Basic Auth by default in a load-options context', async () => {
		const { context, getCredentials, getCurrentNodeParameter } = createLoadOptionsContext();

		await wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' });

		expect(getCurrentNodeParameter).toHaveBeenCalledWith('authType');
		expect(getCredentials).toHaveBeenCalledWith('wordpressApi');
	});

	it('uses the current OAuth2 selection in a load-options context', async () => {
		const { context, getCredentials } = createLoadOptionsContext('oAuth2');

		await wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' });

		expect(getCredentials).toHaveBeenCalledWith('wordpressOAuth2Api');
	});
	it('uses the self-hosted credential URL and TLS setting', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext();

		await wordpressApiRequest.call(context, 'GET', {
			namespace: 'wp/v2',
			base: 'workflows',
		});

		expect(getCredentials).toHaveBeenCalledWith('wordpressApi');
		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({
				uri: 'https://wordpress.example/subdirectory/wp-json/wp/v2/workflows',
				rejectUnauthorized: false,
				json: true,
				useQuerystring: true,
			}),
		);
	});

	it('supports a non-default namespace for self-hosted credentials', async () => {
		const { context, requestWithAuthentication } = createContext();

		await wordpressApiRequest.call(context, 'GET', {
			namespace: 'acme/v1',
			base: 'content/workflows',
		});

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({
				uri: 'https://wordpress.example/subdirectory/wp-json/acme/v1/content/workflows',
			}),
		);
	});

	it('requests a full response from a discovered collection route', async () => {
		const { context, requestWithAuthentication } = createContext();
		const headers: Record<string, string> = {};
		headers['x-wp-totalpages'] = '1';
		requestWithAuthentication.mockResolvedValueOnce({
			body: [{ id: 1 }],
			headers,
		});

		await expect(
			wordpressApiRequestWithResponse.call(
				context,
				'GET',
				{ namespace: 'publisher/v3', base: 'library/items' },
				{ page: 1, per_page: 100 },
			),
		).resolves.toMatchObject({ body: [{ id: 1 }] });
		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({
				uri: 'https://wordpress.example/subdirectory/wp-json/publisher/v3/library/items',
				qs: { page: 1, per_page: 100 },
				resolveWithFullResponse: true,
			}),
		);
	});

	it('requests a full response from a WordPress.com collection route', async () => {
		const { context, requestWithAuthentication } = createContext('oAuth2');
		requestWithAuthentication.mockResolvedValueOnce({ body: [], headers: {} });

		await wordpressApiRequestWithResponse.call(
			context,
			'GET',
			{ namespace: 'wp/v2', base: 'workflows' },
			{ page: 1, per_page: 100 },
		);

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressOAuth2Api',
			expect.objectContaining({
				uri: 'https://public-api.wordpress.com/wp/v2/sites/myblog.wordpress.com/workflows',
				qs: { page: 1, per_page: 100 },
				resolveWithFullResponse: true,
			}),
		);
	});

	it('rejects a custom full-response namespace on WordPress.com', async () => {
		const { context, requestWithAuthentication } = createContext('oAuth2');

		await expect(
			wordpressApiRequestWithResponse.call(context, 'GET', {
				namespace: 'publisher/v3',
				base: 'library/items',
			}),
		).rejects.toThrow(/can't use this REST namespace/);
		expect(requestWithAuthentication).not.toHaveBeenCalled();
	});

	it('passes query parameters through with query-string encoding enabled', async () => {
		const { context, requestWithAuthentication } = createContext();
		const query = { context: 'edit', per_page: 100 };

		await wordpressApiRequest.call(
			context,
			'GET',
			{ namespace: 'wp/v2', base: 'types' },
			undefined,
			query,
		);

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({ qs: query, useQuerystring: true }),
		);
	});

	it('uses the parsed self-hosted URL and preserves its subdirectory', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext();
		getCredentials.mockResolvedValueOnce({
			url: 'HTTPS://WordPress.Example/subdirectory/',
			allowUnauthorizedCerts: false,
		});

		await wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' });

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({
				uri: 'https://wordpress.example/subdirectory/wp-json/wp/v2/types',
			}),
		);
	});

	it('removes multiple trailing slashes from the self-hosted URL', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext();
		getCredentials.mockResolvedValueOnce({
			url: 'https://wordpress.example/subdirectory///',
			allowUnauthorizedCerts: false,
		});

		await wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' });

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressApi',
			expect.objectContaining({
				uri: 'https://wordpress.example/subdirectory/wp-json/wp/v2/types',
			}),
		);
	});

	it('uses the existing WordPress.com API host and site path', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext('oAuth2');

		await wordpressApiRequest.call(context, 'GET', {
			namespace: 'wp/v2',
			base: 'workflows',
		});

		expect(getCredentials).toHaveBeenCalledWith('wordpressOAuth2Api');
		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressOAuth2Api',
			expect.objectContaining({
				uri: 'https://public-api.wordpress.com/wp/v2/sites/myblog.wordpress.com/workflows',
			}),
		);
	});

	it('normalizes a scheme-less WordPress.com site with a path', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext('oAuth2');
		getCredentials.mockResolvedValueOnce({ wordpressSite: 'myblog.wordpress.com/path' });

		await wordpressApiRequest.call(context, 'GET', {
			namespace: 'wp/v2',
			base: 'types',
		});

		expect(requestWithAuthentication).toHaveBeenCalledWith(
			'wordpressOAuth2Api',
			expect.objectContaining({
				uri: 'https://public-api.wordpress.com/wp/v2/sites/myblog.wordpress.com/types',
			}),
		);
	});

	it('rejects a custom namespace on WordPress.com before a request', async () => {
		const { context, getCredentials, requestWithAuthentication } = createContext('oAuth2');

		await expect(
			wordpressApiRequest.call(context, 'GET', { namespace: 'acme/v1', base: 'workflows' }),
		).rejects.toThrow(NodeOperationError);
		expect(getCredentials).not.toHaveBeenCalled();
		expect(requestWithAuthentication).not.toHaveBeenCalled();
	});

	it('rejects an unknown authentication type before credential retrieval', async () => {
		const { context, getCredentials, getNodeParameter, requestWithAuthentication } =
			createContext();
		getNodeParameter.mockReturnValue('unknownAuth');

		await expect(
			wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' }),
		).rejects.toThrow(/authentication type isn't supported/);
		expect(getCredentials).not.toHaveBeenCalled();
		expect(requestWithAuthentication).not.toHaveBeenCalled();
	});

	it('adds a no-cache header to non-GET requests', async () => {
		const { context, requestWithAuthentication } = createContext();

		await wordpressApiRequest.call(
			context,
			'POST',
			{ namespace: 'wp/v2', base: 'workflows' },
			{ title: 'New workflow' },
		);

		const requestOptions = requestWithAuthentication.mock.calls[0]?.[1] as unknown;
		const typedRequestOptions = requestOptions as { headers?: Record<string, unknown> };
		expect(typedRequestOptions.headers?.['Cache-Control']).toBe('no-cache');
	});

	it('adds a no-cache header to HEAD requests', async () => {
		const { context, requestWithAuthentication } = createContext();

		await wordpressApiRequest.call(context, 'HEAD', { namespace: 'wp/v2', base: 'types' });

		const requestOptions = requestWithAuthentication.mock.calls[0]?.[1] as unknown;
		const typedRequestOptions = requestOptions as { headers?: Record<string, unknown> };
		expect(typedRequestOptions.headers?.['Cache-Control']).toBe('no-cache');
	});

	it('wraps request failures in NodeApiError', async () => {
		const { context, requestWithAuthentication } = createContext();
		requestWithAuthentication.mockRejectedValueOnce({ message: 'Request failed' });

		await expect(
			wordpressApiRequest.call(context, 'GET', { namespace: 'wp/v2', base: 'types' }),
		).rejects.toThrow(NodeApiError);
	});
});
