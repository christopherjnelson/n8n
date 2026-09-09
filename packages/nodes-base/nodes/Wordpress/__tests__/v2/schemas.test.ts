import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';

import { buildWordpressRequestBody } from '../../v2/helpers/requestBody';
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

	it.each([false, true])(
		'accepts an empty metadata property map with container required set to %s',
		(required) => {
			const result = parseContentSchema(
				node,
				options({ meta: { type: 'object', required, properties: [] } }),
				postType,
			);

			expect(result.writableProperties).toMatchObject([{ name: 'meta', required }]);
			expect(result.writableMetadata).toEqual([]);
		},
	);

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

	it('normalizes documented core response envelopes and preserves schema details', () => {
		const envelope = {
			type: 'object',
			description: 'Rendered content',
			properties: {
				raw: { type: 'string' },
				rendered: { type: 'string', readonly: true },
				protected: { type: 'boolean' },
			},
		};
		const result = parseContentSchema(
			node,
			options(
				{},
				{},
				{
					title: envelope,
					content: envelope,
					excerpt: envelope,
					settings: {
						type: 'object',
						required: ['mode'],
						properties: {
							mode: { type: 'string' },
							count: { type: 'integer', readonly: true },
						},
					},
					tags: { type: 'array', items: { type: 'integer' } },
					status: { type: 'string', enum: ['draft', 'publish'] },
					published_at: { type: 'string', format: 'date-time' },
				},
			),
			postType,
		);

		expect(result.writableProperties).toMatchObject([
			{ name: 'title', type: 'string', description: 'Rendered content' },
			{ name: 'content', type: 'string' },
			{ name: 'excerpt', type: 'string' },
			{
				name: 'settings',
				type: 'object',
				properties: [
					{ name: 'mode', type: 'string', required: true, readOnly: false },
					{ name: 'count', type: 'integer', required: false, readOnly: true },
				],
			},
			{ name: 'tags', type: 'array', itemType: 'integer' },
			{ name: 'status', enum: ['draft', 'publish'] },
			{ name: 'published_at', format: 'date-time' },
		]);
	});

	it('keeps a raw-shaped metadata title as an object', () => {
		const meta = {
			type: 'object',
			properties: { title: { type: 'object', properties: { raw: { type: 'string' } } } },
		};
		const result = parseContentSchema(node, options({ meta }), postType);

		expect(result.writableMetadata[0]).toMatchObject({ name: 'title', type: 'object' });
	});

	it('accepts an array of objects without traversing its item schema', () => {
		const result = parseContentSchema(
			node,
			options({}, {}, { blocks: { type: 'array', items: { type: 'object', properties: null } } }),
			postType,
		);

		expect(result.writableProperties[0]).toMatchObject({
			name: 'blocks',
			type: 'array',
			itemType: 'object',
		});
	});

	it('builds plain core strings from a realistic OPTIONS envelope', () => {
		const field = {
			type: 'object',
			properties: {
				raw: { type: 'string' },
				rendered: { type: 'string', readonly: true },
			},
		};
		const schema = parseContentSchema(
			node,
			options({}, {}, { title: field, content: field, excerpt: field }),
			postType,
		);
		const fields = { title: 'Title', content: '<p>Body</p>', excerpt: 'Summary' };

		expect(buildWordpressRequestBody(node, schema, 'create', { fields })).toEqual(fields);
	});

	it.each([
		[
			'unsafe nested name',
			{ settings: { type: 'object', properties: { constructor: { type: 'string' } } } },
		],
		['malformed array items', { list: { type: 'array', items: [] } }],
		['malformed enum', { status: { type: 'string', enum: [false] } }],
		['malformed format', { date: { type: 'string', format: false } }],
		[
			'malformed child read-only flag',
			{ settings: { type: 'object', properties: { value: { type: 'string', readonly: 'yes' } } } },
		],
		[
			'malformed raw read-only flag',
			{ title: { type: 'object', properties: { raw: { type: 'string', readonly: 'no' } } } },
		],
		['oversized description', { title: { type: 'string', description: 'x'.repeat(2_001) } }],
		['enum on an object', { settings: { type: 'object', enum: ['value'] } }],
	])('rejects %s', (_name, args) => {
		expect(() => parseContentSchema(node, options({}, {}, args), postType)).toThrow(
			NodeOperationError,
		);
	});

	it('rejects oversized metadata, endpoint, and method collections', () => {
		const metadataProperties = Object.fromEntries(
			Array.from({ length: 201 }, (_, index) => [`field_${index}`, { type: 'string' }]),
		);
		expect(() =>
			parseContentSchema(
				node,
				options({ meta: { type: 'object', properties: metadataProperties } }),
				postType,
			),
		).toThrow(/oversized metadata/);
		expect(() =>
			parseContentSchema(
				node,
				{ ...options(), endpoints: Array(21).fill({ methods: [] }) },
				postType,
			),
		).toThrow(/oversized endpoint/);
		expect(() =>
			parseContentSchema(node, { ...options(), methods: Array(21).fill('GET') }, postType),
		).toThrow(/oversized route method/);
	});

	it('does not normalize an arbitrary object with a raw child', () => {
		const result = parseContentSchema(
			node,
			options({}, {}, { custom: { type: 'object', properties: { raw: { type: 'string' } } } }),
			postType,
		);

		expect(result.writableProperties[0]).toMatchObject({ name: 'custom', type: 'object' });
	});

	it.each([
		['a missing rendered child', { raw: { type: 'string' } }],
		[
			'a writable rendered child',
			{ raw: { type: 'string' }, rendered: { type: 'string', readonly: false } },
		],
		[
			'a non-string rendered child',
			{ raw: { type: 'string' }, rendered: { type: 'object', readonly: true } },
		],
		['a partial arbitrary envelope', { raw: { type: 'string' }, protected: { type: 'boolean' } }],
	])('does not normalize a core field with %s', (_name, properties) => {
		const result = parseContentSchema(
			node,
			options({}, {}, { title: { type: 'object', properties } }),
			postType,
		);

		expect(result.writableProperties[0]).toMatchObject({ name: 'title', type: 'object' });
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
		[
			'a string metadata required value without properties',
			options({ meta: { type: 'object', required: 'field' } }),
		],
		[
			'an object metadata required value without properties',
			options({ meta: { type: 'object', required: {} } }),
		],
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
