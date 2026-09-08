import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';

import { getTaxonomies, parseTaxonomyCollection } from '../../v2/helpers/taxonomies';
import * as Transport from '../../v2/transport';
import type * as TransportType from '../../v2/transport';

vi.mock('../../v2/transport', async () => ({
	...(await vi.importActual<typeof TransportType>('../../v2/transport')),
	wordpressApiRequest: vi.fn(),
}));

const requestMock = Transport.wordpressApiRequest as Mock;
const node = { name: 'WordPress' } as INode;
const context = { getNode: vi.fn().mockReturnValue(node) } as unknown as ILoadOptionsFunctions;
const postType = { slug: 'book', name: 'Books', restBase: 'items', restNamespace: 'acme/v1' };
const genre = {
	slug: 'genre',
	name: 'Genres',
	types: ['book'],
	rest_base: 'book-genres',
	rest_namespace: 'publisher/v3',
	hierarchical: true,
};

describe('WordPress v2 taxonomy discovery', () => {
	beforeEach(() => requestMock.mockReset());

	it('uses the exact post type filter and edit context', async () => {
		requestMock.mockResolvedValue({ genre });
		await getTaxonomies.call(context, postType);
		expect(requestMock).toHaveBeenCalledWith(
			'GET',
			{ namespace: 'wp/v2', base: 'taxonomies' },
			undefined,
			{ type: 'book', context: 'edit' },
		);
	});

	it('keeps the slug, request field, and namespace distinct', () => {
		expect(parseTaxonomyCollection(node, { genre }, postType)).toEqual([
			{
				slug: 'genre',
				name: 'Genres',
				requestField: 'book-genres',
				restNamespace: 'publisher/v3',
				types: ['book'],
				hierarchical: true,
			},
		]);
	});

	it('filters unrelated taxonomies and accepts an empty collection', () => {
		expect(
			parseTaxonomyCollection(
				node,
				{ genre, topic: { ...genre, slug: 'topic', types: ['post'] } },
				postType,
			),
		).toHaveLength(1);
		expect(parseTaxonomyCollection(node, {}, postType)).toEqual([]);
	});

	it.each([
		['a malformed collection', []],
		['a malformed record', { genre: null }],
		['a key and slug mismatch', { topic: genre }],
		['an invalid REST base', { genre: { ...genre, rest_base: '../terms' } }],
		['an invalid REST namespace', { genre: { ...genre, rest_namespace: 'https://example.com' } }],
		['an invalid types value', { genre: { ...genre, types: 'book' } }],
		['an invalid type entry', { genre: { ...genre, types: ['book', '../post'] } }],
	])('rejects %s with an actionable error', (_label, payload) => {
		expect(() => parseTaxonomyCollection(node, payload, postType)).toThrow(NodeOperationError);
		expect(() => parseTaxonomyCollection(node, payload, postType)).toThrow(/try again/);
	});

	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects the unsafe collection key %s',
		(key) => {
			const response = Object.create(null) as Record<string, unknown>;
			Object.defineProperty(response, key, { enumerable: true, value: { ...genre, slug: key } });
			expect(() => parseTaxonomyCollection(node, response, postType)).toThrow(/unsafe/);
		},
	);
});
