import type { IExecuteFunctions, ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError } from 'n8n-workflow';

import { wordpressApiRequest } from '../transport';
import type { WordpressPostType } from './postTypes';
import { buildRestPath } from './routes';

type WordpressFunctions = IExecuteFunctions | ILoadOptionsFunctions;

export type WordpressTaxonomy = {
	slug: string;
	name: string;
	requestField: string;
	restNamespace: string;
	types: string[];
	hierarchical?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function taxonomyError(node: INode, detail: string): NodeOperationError {
	return new NodeOperationError(
		node,
		`WordPress returned ${detail}. Check the taxonomy REST configuration and try again.`,
	);
}

function requiredString(node: INode, value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw taxonomyError(node, `an invalid taxonomy ${field}`);
	}
	return value;
}

function registeredSlug(node: INode, value: unknown, field: string): string {
	const slug = requiredString(node, value, field);
	if (slug.length > 32 || !/^[a-z0-9_-]+$/.test(slug) || !isSafeObjectProperty(slug)) {
		throw taxonomyError(node, `an invalid taxonomy ${field}`);
	}
	return slug;
}

export function parseTaxonomyCollection(
	node: INode,
	payload: unknown,
	postType: WordpressPostType,
): WordpressTaxonomy[] {
	if (!isRecord(payload)) throw taxonomyError(node, 'an invalid taxonomy list');
	const taxonomies: WordpressTaxonomy[] = [];
	for (const [key, value] of Object.entries(payload)) {
		if (!isSafeObjectProperty(key)) throw taxonomyError(node, 'an unsafe taxonomy key');
		if (!isRecord(value)) throw taxonomyError(node, 'an invalid taxonomy record');
		const slug = registeredSlug(node, value.slug, 'slug');
		if (key !== slug) throw taxonomyError(node, "a taxonomy slug that doesn't match its list key");
		const name = requiredString(node, value.name, 'name');
		const requestField = requiredString(node, value.rest_base, 'REST base');
		const restNamespace = requiredString(node, value.rest_namespace, 'REST namespace');
		buildRestPath(node, { namespace: restNamespace, base: requestField });
		if (!Array.isArray(value.types) || value.types.some((type) => typeof type !== 'string')) {
			throw taxonomyError(node, 'an invalid taxonomy types list');
		}
		const types = value.types.map((type) => registeredSlug(node, type, 'associated type'));
		if (value.hierarchical !== undefined && typeof value.hierarchical !== 'boolean') {
			throw taxonomyError(node, 'an invalid taxonomy hierarchical flag');
		}
		if (!types.includes(postType.slug)) continue;
		taxonomies.push({
			slug,
			name,
			requestField,
			restNamespace,
			types,
			...(value.hierarchical === undefined ? {} : { hierarchical: value.hierarchical }),
		});
	}
	return taxonomies;
}

export async function getTaxonomies(
	this: WordpressFunctions,
	postType: WordpressPostType,
): Promise<WordpressTaxonomy[]> {
	const response = await wordpressApiRequest.call(
		this,
		'GET',
		{ namespace: 'wp/v2', base: 'taxonomies' },
		undefined,
		{ type: postType.slug, context: 'edit' },
	);
	return parseTaxonomyCollection(this.getNode(), response, postType);
}
