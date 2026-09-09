import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import type { WordpressRestRoute } from '../helpers/routes';
import { buildRestPath } from '../helpers/routes';

type WordpressFunctions = IExecuteFunctions | ILoadOptionsFunctions;

export type WordpressFullResponse = {
	body: unknown;
	headers: unknown;
};

function normalizeWordpressSite(
	node: ReturnType<WordpressFunctions['getNode']>,
	value: unknown,
): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new NodeOperationError(
			node,
			"The WordPress.com site URL isn't valid. Check the credential and try again.",
		);
	}

	let site: string;
	try {
		site = new URL(value.startsWith('http') ? value : `https://${value}`).hostname;
	} catch {
		throw new NodeOperationError(
			node,
			"The WordPress.com site URL isn't valid. Check the credential and try again.",
		);
	}

	if (!site || !/^[A-Za-z0-9.-]+$/.test(site)) {
		throw new NodeOperationError(
			node,
			"The WordPress.com site URL isn't valid. Check the credential and try again.",
		);
	}
	return site;
}

function normalizeSelfHostedUrl(
	node: ReturnType<WordpressFunctions['getNode']>,
	value: unknown,
): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new NodeOperationError(
			node,
			"The WordPress site URL isn't valid. Check the credential and try again.",
		);
	}

	try {
		const url = new URL(value);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error('Invalid URL');
		}
		return url.toString().replace(/\/+$/, '');
	} catch {
		throw new NodeOperationError(
			node,
			"The WordPress site URL isn't valid. Check the credential and try again.",
		);
	}
}

async function request(
	this: WordpressFunctions,
	method: IHttpRequestMethods,
	route: WordpressRestRoute,
	body?: IDataObject,
	qs: IDataObject = {},
	resolveWithFullResponse = false,
): Promise<unknown> {
	const node = this.getNode();
	const path = buildRestPath(node, route);
	const selectedAuthType =
		'getCurrentNodeParameter' in this
			? this.getCurrentNodeParameter('authType')
			: this.getNodeParameter('authType', 0, 'basicAuth');
	const authType = selectedAuthType ?? 'basicAuth';
	if (authType !== 'basicAuth' && authType !== 'oAuth2') {
		throw new NodeOperationError(
			node,
			"The authentication type isn't supported. Select Basic Auth or OAuth2 and try again.",
		);
	}
	const isOAuth2 = authType === 'oAuth2';

	let credentialType: 'wordpressApi' | 'wordpressOAuth2Api';
	let uri: string;
	let rejectUnauthorized: boolean | undefined;

	if (isOAuth2) {
		if (route.namespace !== 'wp/v2') {
			throw new NodeOperationError(
				node,
				"WordPress.com can't use this REST namespace. Select a type that uses wp/v2, or use Basic Auth with a self-hosted site.",
			);
		}
		const credentials = await this.getCredentials('wordpressOAuth2Api');
		const site = normalizeWordpressSite(node, credentials.wordpressSite);
		credentialType = 'wordpressOAuth2Api';
		uri = `https://public-api.wordpress.com/wp/v2/sites/${site}${path.slice('/wp/v2'.length)}`;
	} else {
		const credentials = await this.getCredentials('wordpressApi');
		const baseUrl = normalizeSelfHostedUrl(node, credentials.url);
		credentialType = 'wordpressApi';
		uri = `${baseUrl}/wp-json${path}`;
		rejectUnauthorized = !credentials.allowUnauthorizedCerts;
	}

	const headers: IDataObject = {};
	headers['Accept'] = 'application/json';
	headers['Content-Type'] = 'application/json';
	if (method !== 'GET') {
		headers['Cache-Control'] = 'no-cache';
	}

	const options: IRequestOptions = {
		headers,
		method,
		qs,
		uri,
		json: true,
		useQuerystring: true,
		...(resolveWithFullResponse ? { resolveWithFullResponse: true } : {}),
		...(body && Object.keys(body).length > 0 ? { body } : {}),
		...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
	};

	try {
		return await this.helpers.requestWithAuthentication.call(this, credentialType, options);
	} catch (error) {
		throw new NodeApiError(node, error as JsonObject);
	}
}

export async function wordpressApiRequest(
	this: WordpressFunctions,
	method: IHttpRequestMethods,
	route: WordpressRestRoute,
	body?: IDataObject,
	qs: IDataObject = {},
): Promise<unknown> {
	return await request.call(this, method, route, body, qs);
}

function isFullResponse(value: unknown): value is WordpressFullResponse {
	return typeof value === 'object' && value !== null && 'body' in value && 'headers' in value;
}

export async function wordpressApiRequestWithResponse(
	this: WordpressFunctions,
	method: IHttpRequestMethods,
	route: WordpressRestRoute,
	qs: IDataObject = {},
): Promise<WordpressFullResponse> {
	const response = await request.call(this, method, route, undefined, qs, true);
	if (!isFullResponse(response)) {
		throw new NodeOperationError(
			this.getNode(),
			'WordPress returned an invalid response. Check the WordPress REST API configuration and try again.',
		);
	}
	return response;
}
