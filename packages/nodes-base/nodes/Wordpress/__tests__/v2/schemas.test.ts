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
const options = (properties: unknown = {}, extraSchema = {}, postArgs: unknown = properties) => ({
	namespace: 'publisher/v3',
	methods: ['GET', 'POST'],
	endpoints: [
		{ methods: ['GET'], args: { context: { type: 'string' } } },
		{ methods: ['POST'], args: postArgs },
	],
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

	it('uses POST arguments as writable properties and reports route capabilities', () => {
		expect(
			parseContentSchema(
				node,
				options({ title: { type: 'object' } }, {}, { title: { type: 'string' } }),
				postType,
			),
		).toEqual({
			canCreate: true,
			canRead: true,
			writableProperties: [
				{
					name: 'title',
					type: 'string',
					nullable: false,
					readOnly: false,
					required: false,
				},
			],
			writableMetadata: [],
		});
	});

	it('does not use GET arguments as writable properties', () => {
		const result = parseContentSchema(
			node,
			{
				...options(),
				endpoints: [
					{ methods: ['GET'], args: { context: { type: 'string' } } },
					{ methods: ['POST'], args: { content: { type: 'string' } } },
				],
			},
			postType,
		);
		expect(result.writableProperties.map(({ name }) => name)).toEqual(['content']);
	});

	it('returns no writable fields when the route has no POST endpoint', () => {
		const result = parseContentSchema(
			node,
			{ ...options(), endpoints: [{ methods: ['GET'], args: {} }] },
			postType,
		);
		expect(result).toMatchObject({
			canCreate: false,
			writableProperties: [],
			writableMetadata: [],
		});
	});

	it('returns no metadata when meta has no registered properties', () => {
		expect(
			parseContentSchema(node, options({ meta: { type: 'object' } }), postType).writableMetadata,
		).toEqual([]);
	});

	it('accepts an empty metadata property map serialized as an array', () => {
		const result = parseContentSchema(
			node,
			options({ meta: { type: 'object', properties: [] } }),
			postType,
		);

		expect(result.writableMetadata).toEqual([]);
	});

	it('rejects a non-empty metadata property array', () => {
		expect(() =>
			parseContentSchema(
				node,
				options({ meta: { type: 'object', properties: [{ field: { type: 'string' } }] } }),
				postType,
			),
		).toThrow(/invalid metadata properties/);
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
		expect(
			result.writableMetadata.map(({ name, type, nullable }) => ({ name, type, nullable })),
		).toEqual([
			...['string', 'boolean', 'integer', 'number', 'array', 'object'].map((type) => ({
				name: type,
				type,
				nullable: false,
			})),
			{ name: 'nullable', type: 'string', nullable: true },
		]);
	});

	it('preserves POST argument required, nullable, description, and read-only flags', () => {
		const result = parseContentSchema(
			node,
			options(
				{ id: { type: 'integer' }, content: { type: 'object' } },
				{},
				{
					id: { type: 'integer', readonly: true, required: true },
					content: { type: ['string', 'null'], required: true, description: 'Body' },
				},
			),
			postType,
		);
		expect(result.writableProperties).toMatchObject([
			{ name: 'id', required: true, readOnly: true },
			{
				name: 'content',
				required: true,
				readOnly: false,
				nullable: true,
				description: 'Body',
			},
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
		expect(result.writableMetadata).toMatchObject([
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
		['malformed properties', options([], {}, {})],
		['malformed POST arguments', options({}, {}, [])],
		['a malformed resource property record', options({ content: null }, {}, {})],
		['a malformed POST argument record', options({}, {}, { content: null })],
		['a missing POST argument type', options({}, {}, { content: {} })],
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

	it('accepts matching POST schemas in a different property order', () => {
		const result = parseContentSchema(
			node,
			{
				...options(),
				endpoints: [
					{ methods: ['POST'], args: { title: { type: 'string' }, count: { type: 'integer' } } },
					{ methods: ['POST'], args: { count: { type: 'integer' }, title: { type: 'string' } } },
				],
			},
			postType,
		);
		expect(result.writableProperties).toHaveLength(2);
	});

	it('rejects conflicting POST endpoint argument schemas', () => {
		const payload = {
			...options(),
			endpoints: [
				{ methods: ['POST'], args: { title: { type: 'string' } } },
				{ methods: ['POST'], args: { title: { type: 'object' } } },
			],
		};
		expect(() => parseContentSchema(node, payload, postType)).toThrow(/conflicting POST/);
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
