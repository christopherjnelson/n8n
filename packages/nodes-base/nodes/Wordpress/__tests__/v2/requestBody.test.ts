import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildWordpressRequestBody,
	type WordpressRequestValues,
} from '../../v2/helpers/requestBody';
import type { WordpressContentProperty, WordpressContentSchema } from '../../v2/helpers/schemas';

const node = { name: 'WordPress' } as INode;

const property = (
	name: string,
	type: WordpressContentProperty['type'],
	overrides: Partial<WordpressContentProperty> = {},
): WordpressContentProperty => ({
	name,
	type,
	nullable: false,
	readOnly: false,
	required: false,
	...overrides,
});

const schema = (
	properties: WordpressContentProperty[],
	metadata: WordpressContentProperty[] = [],
): WordpressContentSchema => ({
	canCreate: true,
	canRead: true,
	writableProperties: properties,
	writableMetadata: metadata,
});

describe('WordPress v2 request body', () => {
	it('preserves all supported core value types', () => {
		const fields = {
			text: 'value',
			enabled: true,
			count: 4,
			rating: 4.5,
			tags: ['one', 'two'],
			details: { source: 'editor' },
		};
		const contentSchema = schema([
			property('text', 'string'),
			property('enabled', 'boolean'),
			property('count', 'integer'),
			property('rating', 'number'),
			property('tags', 'array'),
			property('details', 'object'),
		]);

		expect(buildWordpressRequestBody(node, contentSchema, 'update', { fields })).toEqual(fields);
	});

	it('preserves false, zero, an empty string, and an empty array', () => {
		const fields = { enabled: false, count: 0, text: '', tags: [] };
		const contentSchema = schema([
			property('enabled', 'boolean'),
			property('count', 'integer'),
			property('text', 'string'),
			property('tags', 'array'),
		]);

		expect(buildWordpressRequestBody(node, contentSchema, 'update', { fields })).toEqual(fields);
	});

	it('preserves all supported metadata types and falsey metadata values', () => {
		const metadata = {
			text: '',
			enabled: false,
			count: 0,
			rating: 4.5,
			tags: [],
			details: { source: 'editor' },
		};
		const contentSchema = schema(
			[property('meta', 'object')],
			[
				property('text', 'string'),
				property('enabled', 'boolean'),
				property('count', 'integer'),
				property('rating', 'number'),
				property('tags', 'array'),
				property('details', 'object'),
			],
		);

		expect(
			buildWordpressRequestBody(node, contentSchema, 'update', { fields: {}, metadata }),
		).toEqual({ meta: metadata });
	});

	it.each([undefined, {}])(
		'omits the metadata container for omitted or empty metadata',
		(metadata) => {
			const contentSchema = schema([property('title', 'string')], [property('code', 'string')]);
			expect(
				buildWordpressRequestBody(node, contentSchema, 'update', {
					fields: { title: 'Example' },
					...(metadata === undefined ? {} : { metadata }),
				}),
			).toEqual({ title: 'Example' });
		},
	);

	it('includes only the supplied metadata field during an update', () => {
		const contentSchema = schema(
			[],
			[property('external_id', 'string'), property('priority', 'integer')],
		);
		expect(
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: {},
				metadata: { priority: 0 },
			}),
		).toEqual({ meta: { priority: 0 } });
	});

	it('requires writable core fields only during create', () => {
		const contentSchema = schema(
			[
				property('title', 'string', { required: true }),
				property('id', 'integer', { required: true, readOnly: true }),
			],
			[property('code', 'string', { required: true })],
		);
		expect(() => buildWordpressRequestBody(node, contentSchema, 'create', { fields: {} })).toThrow(
			/required field "title"/,
		);
		expect(
			buildWordpressRequestBody(node, contentSchema, 'create', { fields: { title: 'Example' } }),
		).toEqual({ title: 'Example' });
		expect(buildWordpressRequestBody(node, contentSchema, 'update', { fields: {} })).toEqual({});
	});

	it('requires metadata siblings when metadata is supplied during create', () => {
		const contentSchema = schema(
			[],
			[property('code', 'string', { required: true }), property('priority', 'integer')],
		);
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'create', {
				fields: {},
				metadata: { priority: 1 },
			}),
		).toThrow(/required metadata field "code"/);
	});

	it('requires a required metadata container and its required children during create', () => {
		const contentSchema = schema(
			[property('meta', 'object', { required: true })],
			[property('code', 'string', { required: true }), property('priority', 'integer')],
		);
		expect(() => buildWordpressRequestBody(node, contentSchema, 'create', { fields: {} })).toThrow(
			/required field "meta"/,
		);
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'create', {
				fields: {},
				metadata: { priority: 1 },
			}),
		).toThrow(/required metadata field "code"/);
	});

	it('rejects metadata when the discovered metadata container is read-only', () => {
		const contentSchema = schema(
			[property('meta', 'object', { readOnly: true })],
			[property('code', 'string')],
		);
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: {},
				metadata: { code: 'value' },
			}),
		).toThrow(/read-only field "meta"/);
	});

	it.each([
		['outer values', null, /values must be an object/],
		['outer values array', [], /values must be an object/],
		['missing fields', {}, /fields must be an object/],
		['fields', { fields: null }, /fields must be an object/],
		['fields array', { fields: [] }, /fields must be an object/],
		['metadata', { fields: {}, metadata: null }, /metadata must be an object/],
		['metadata array', { fields: {}, metadata: [] }, /metadata must be an object/],
	] as const)('rejects a malformed %s container', (_label, values, message) => {
		expect(() =>
			buildWordpressRequestBody(node, schema([]), 'update', values as WordpressRequestValues),
		).toThrow(NodeOperationError);
		expect(() =>
			buildWordpressRequestBody(node, schema([]), 'update', values as WordpressRequestValues),
		).toThrow(message);
	});

	it.each([
		['read-only field', { fields: { id: 1 } }, /read-only field "id"/],
		['unknown field', { fields: { missing: 'value' } }, /unknown field "missing"/],
		['wrong type', { fields: { count: '1' } }, /field "count" must have type integer/],
		['non-finite number', { fields: { rating: Number.POSITIVE_INFINITY } }, /type number/],
		['invalid integer', { fields: { count: 1.5 } }, /type integer/],
		['invalid null', { fields: { title: null } }, /does not allow null/],
	] as const)('rejects a %s with an actionable error', (_label, values, message) => {
		const contentSchema = schema([
			property('id', 'integer', { readOnly: true }),
			property('count', 'integer'),
			property('rating', 'number'),
			property('title', 'string'),
		]);
		expect(() => buildWordpressRequestBody(node, contentSchema, 'update', values)).toThrow(
			NodeOperationError,
		);
		expect(() => buildWordpressRequestBody(node, contentSchema, 'update', values)).toThrow(message);
	});

	it.each(['__proto__', 'constructor', 'prototype'])('rejects the unsafe field %s', (name) => {
		const fields = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(fields, name, { enumerable: true, value: 'value' });
		expect(() => buildWordpressRequestBody(node, schema([]), 'update', { fields })).toThrow(
			/unsafe field name/,
		);
	});

	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects the unsafe metadata field %s',
		(name) => {
			const metadata = Object.create(null) as Record<string, unknown>;
			Object.defineProperty(metadata, name, { enumerable: true, value: 'value' });
			expect(() =>
				buildWordpressRequestBody(node, schema([]), 'update', { fields: {}, metadata }),
			).toThrow(/unsafe metadata field name/);
		},
	);

	it('preserves a valid nullable value', () => {
		const contentSchema = schema([property('subtitle', 'string', { nullable: true })]);
		expect(
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: { subtitle: null },
			}),
		).toEqual({ subtitle: null });
	});

	it('keeps distinct core and metadata fields in their discovered locations', () => {
		const contentSchema = schema(
			[property('title', 'string'), property('meta', 'object')],
			[property('subtitle', 'string')],
		);
		expect(
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: { title: 'Core title' },
				metadata: { subtitle: 'Metadata subtitle' },
			}),
		).toEqual({ title: 'Core title', meta: { subtitle: 'Metadata subtitle' } });
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: { meta: { subtitle: 'Wrong path' } },
			}),
		).toThrow(/reserved field "meta"/);
	});

	it('rejects unknown and read-only metadata fields', () => {
		const contentSchema = schema([], [property('locked', 'string', { readOnly: true })]);
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: {},
				metadata: { missing: 'value' },
			}),
		).toThrow(/unknown metadata field "missing"/);
		expect(() =>
			buildWordpressRequestBody(node, contentSchema, 'update', {
				fields: {},
				metadata: { locked: 'value' },
			}),
		).toThrow(/read-only metadata field "locked"/);
	});
});
