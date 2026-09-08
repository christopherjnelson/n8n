import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';

import { getContentSchema, parseContentSchema } from '../../v2/helpers/schemas';
import * as Transport from '../../v2/transport';
import type * as TransportType from '../../v2/transport';

vi.mock('../../v2/transport', async () => ({
	...(await vi.importActual<typeof TransportType>('../../v2/transport')),
	wordpressApiRequest: vi.fn(),
}));

const requestMock = Transport.wordpressApiRequest as Mock;
const node = { name: 'WordPress' } as INode;
const context = { getNode: vi.fn().mockReturnValue(node) } as unknown as ILoadOptionsFunctions;
const postType = {
	slug: 'book',
	name: 'Books',
	restBase: 'library/items',
	restNamespace: 'publisher/v3',
};
const options = (properties: unknown = {}, extraSchema = {}) => ({
	namespace: 'publisher/v3',
	methods: ['GET', 'POST'],
	endpoints: [{ methods: ['GET'] }, { methods: ['POST'] }],
	schema: { type: 'object', properties, ...extraSchema },
});

describe('WordPress v2 content schema discovery', () => {
	beforeEach(() => requestMock.mockReset());

	it('requests the selected REST route once without rediscovering the slug', async () => {
		requestMock.mockResolvedValue(options());
		await getContentSchema.call(context, postType);
		expect(requestMock).toHaveBeenCalledOnce();
		expect(requestMock).toHaveBeenCalledWith('OPTIONS', {
			namespace: 'publisher/v3',
			base: 'library/items',
		});
	});

	it('does not add a title property and reports route capabilities', () => {
		expect(parseContentSchema(node, options({ content: { type: 'string' } }), postType)).toEqual({
			canCreate: true,
			canRead: true,
			properties: [
				{
					name: 'content',
					type: 'string',
					nullable: false,
					readOnly: false,
					required: false,
				},
			],
			metadata: [],
		});
	});

	it('returns no metadata when meta has no registered properties', () => {
		expect(
			parseContentSchema(node, options({ meta: { type: 'object' } }), postType).metadata,
		).toEqual([]);
	});

	it('parses all supported metadata types and nullable metadata', () => {
		const metaProperties: Record<string, unknown> = Object.fromEntries(
			['string', 'boolean', 'integer', 'number', 'array', 'object'].map((type) => [type, { type }]),
		);
		metaProperties.nullable = { type: ['null', 'string'] };
		const result = parseContentSchema(
			node,
			options({ meta: { type: 'object', properties: metaProperties } }),
			postType,
		);
		expect(result.metadata.map(({ name, type, nullable }) => ({ name, type, nullable }))).toEqual([
			...['string', 'boolean', 'integer', 'number', 'array', 'object'].map((type) => ({
				name: type,
				type,
				nullable: false,
			})),
			{ name: 'nullable', type: 'string', nullable: true },
		]);
	});

	it('combines top-level and property-level required flags and preserves read-only flags', () => {
		const result = parseContentSchema(
			node,
			options(
				{
					id: { type: 'integer', readonly: true },
					content: { type: 'string', required: true, description: 'Body' },
				},
				{ required: ['id'] },
			),
			postType,
		);
		expect(result.properties).toMatchObject([
			{ name: 'id', required: true, readOnly: true },
			{ name: 'content', required: true, readOnly: false, description: 'Body' },
		]);
	});

	it('preserves metadata required and read-only flags', () => {
		const result = parseContentSchema(
			node,
			options({
				meta: {
					type: 'object',
					required: ['external_id'],
					properties: {
						external_id: { type: 'string', readonly: true },
						priority: { type: 'integer', required: true },
					},
				},
			}),
			postType,
		);
		expect(result.metadata).toMatchObject([
			{ name: 'external_id', required: true, readOnly: true },
			{ name: 'priority', required: true, readOnly: false },
		]);
	});

	it.each([
		['a missing schema', { namespace: 'publisher/v3', methods: [], endpoints: [] }],
		['a missing top-level schema type', options({}, { type: undefined })],
		['a wrong top-level schema type', options({}, { type: 'array' })],
		['a namespace mismatch', { ...options(), namespace: 'other/v1' }],
		['malformed methods', { ...options(), methods: 'GET' }],
		['malformed endpoints', { ...options(), endpoints: [{}] }],
		['malformed properties', options([])],
		['a malformed property record', options({ content: null })],
		['a missing core property type', options({ content: {} })],
		['a missing metadata type', options({ meta: { type: 'object', properties: { field: {} } } })],
		['a non-object metadata container', options({ meta: { type: 'string', properties: {} } })],
		[
			'an unsupported metadata type',
			options({ meta: { type: 'object', properties: { field: { type: 'date' } } } }),
		],
		[
			'an ambiguous metadata type',
			options({
				meta: { type: 'object', properties: { field: { type: ['string', 'number'] } } },
			}),
		],
	])('rejects %s with an actionable error', (_label, payload) => {
		expect(() => parseContentSchema(node, payload, postType)).toThrow(NodeOperationError);
		expect(() => parseContentSchema(node, payload, postType)).toThrow(/Check .* and try again/);
	});

	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects the unsafe core or metadata property %s',
		(name) => {
			const properties = Object.create(null) as Record<string, unknown>;
			Object.defineProperty(properties, name, { enumerable: true, value: { type: 'string' } });
			expect(() => parseContentSchema(node, options(properties), postType)).toThrow(/unsafe/);
			expect(() =>
				parseContentSchema(node, options({ meta: { type: 'object', properties } }), postType),
			).toThrow(/unsafe/);
		},
	);
});
