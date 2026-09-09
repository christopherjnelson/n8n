import type { IExecuteFunctions, ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError } from 'n8n-workflow';

import { wordpressApiRequest } from '../transport';
import { buildRestPath, validateRegisteredSlug } from './routes';

export type WordpressPostType = {
	slug: string;
	name: string;
	restBase: string;
	restNamespace: string;
};

type WordpressFunctions = IExecuteFunctions | ILoadOptionsFunctions;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
	node: INode,
	payload: Record<string, unknown>,
	field: 'slug' | 'name' | 'rest_base' | 'rest_namespace',
): string {
	const value = payload[field];
	if (typeof value !== 'string' || value.length === 0) {
		throw new NodeOperationError(
			node,
			`WordPress returned an invalid post type ${field}. Check the WordPress REST configuration and try again.`,
		);
	}
	return value;
}

export function parsePostType(node: INode, payload: unknown): WordpressPostType {
	if (!isRecord(payload)) {
		throw new NodeOperationError(
			node,
			'WordPress returned an invalid post type response. Check the WordPress REST configuration and try again.',
		);
	}

	const slug = validateRegisteredSlug(node, requiredString(node, payload, 'slug'));
	const name = requiredString(node, payload, 'name');
	const restBase = requiredString(node, payload, 'rest_base');
	const restNamespace = requiredString(node, payload, 'rest_namespace');

	buildRestPath(node, { namespace: restNamespace, base: restBase });

	return { slug, name, restBase, restNamespace };
}

function hasUsableRestRoute(node: INode, payload: Record<string, unknown>): boolean {
	const restBase = payload.rest_base;
	const restNamespace = payload.rest_namespace;
	if (
		typeof restBase !== 'string' ||
		restBase.length === 0 ||
		typeof restNamespace !== 'string' ||
		restNamespace.length === 0
	) {
		return false;
	}
	try {
		buildRestPath(node, { namespace: restNamespace, base: restBase });
		return true;
	} catch (error) {
		if (error instanceof NodeOperationError) return false;
		throw error;
	}
}

export function parsePostTypeCollection(node: INode, payload: unknown): WordpressPostType[] {
	if (!isRecord(payload)) {
		throw new NodeOperationError(
			node,
			'WordPress returned an invalid post type list. Check the WordPress REST configuration and try again.',
		);
	}

	const postTypes: WordpressPostType[] = [];
	for (const [key, value] of Object.entries(payload)) {
		if (!isSafeObjectProperty(key)) {
			throw new NodeOperationError(
				node,
				'WordPress returned an invalid post type key. Check the WordPress REST configuration and try again.',
			);
		}
		if (!isRecord(value)) {
			throw new NodeOperationError(
				node,
				'WordPress returned an invalid post type response. Check the WordPress REST configuration and try again.',
			);
		}
		const slug = validateRegisteredSlug(node, requiredString(node, value, 'slug'));
		requiredString(node, value, 'name');
		if (key !== slug) {
			throw new NodeOperationError(
				node,
				"The post type slug doesn't match its list key. Check the WordPress REST configuration and try again.",
			);
		}
		if (!hasUsableRestRoute(node, value)) continue;
		const postType = parsePostType(node, value);
		postTypes.push(postType);
	}

	return postTypes;
}

export async function getPostTypes(this: WordpressFunctions): Promise<WordpressPostType[]> {
	const response = await wordpressApiRequest.call(
		this,
		'GET',
		{ namespace: 'wp/v2', base: 'types' },
		undefined,
		{ context: 'edit' },
	);
	return parsePostTypeCollection(this.getNode(), response);
}

export async function resolvePostType(
	this: WordpressFunctions,
	registeredSlug: string,
): Promise<WordpressPostType> {
	const slug = validateRegisteredSlug(this.getNode(), registeredSlug);
	const response = await wordpressApiRequest.call(
		this,
		'GET',
		{ namespace: 'wp/v2', base: 'types', suffix: [slug] },
		undefined,
		{ context: 'edit' },
	);
	const postType = parsePostType(this.getNode(), response);
	if (postType.slug !== slug) {
		throw new NodeOperationError(
			this.getNode(),
			"The returned post type doesn't match the selected post type. Select the post type again and try again.",
		);
	}
	return postType;
}
