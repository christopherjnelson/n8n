import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';

import * as PostTypes from '../../v2/helpers/postTypes';
import type * as PostTypesType from '../../v2/helpers/postTypes';
import * as Schemas from '../../v2/helpers/schemas';
import type * as SchemasType from '../../v2/helpers/schemas';
import { searchPostTypes } from '../../v2/methods/listSearch';
import * as Transport from '../../v2/transport';
import type * as TransportType from '../../v2/transport';
import { WordpressV2 } from '../../v2/WordpressV2.node';
import { Wordpress } from '../../Wordpress.node';

vi.mock('../../v2/helpers/postTypes', async () => ({
	...(await vi.importActual<typeof PostTypesType>('../../v2/helpers/postTypes')),
	getPostTypes: vi.fn(),
	resolvePostType: vi.fn(),
}));
vi.mock('../../v2/helpers/schemas', async () => ({
	...(await vi.importActual<typeof SchemasType>('../../v2/helpers/schemas')),
	getContentSchema: vi.fn(),
}));
vi.mock('../../v2/transport', async () => ({
	...(await vi.importActual<typeof TransportType>('../../v2/transport')),
	wordpressApiRequest: vi.fn(),
	wordpressApiRequestWithResponse: vi.fn(),
}));

const getPostTypesMock = PostTypes.getPostTypes as Mock;
const resolvePostTypeMock = PostTypes.resolvePostType as Mock;
const requestMock = Transport.wordpressApiRequest as Mock;
const requestWithResponseMock = Transport.wordpressApiRequestWithResponse as Mock;
const getContentSchemaMock = Schemas.getContentSchema as Mock;
const node = { name: 'WordPress' } as INode;
const discoveredType = {
	slug: 'bs_workflow',
	name: 'Workflows',
	restNamespace: 'publisher/v3',
	restBase: 'library/items',
};
const writableSchema = {
	canCreate: true,
	canRead: true,
	writableProperties: [
		{ name: 'title', type: 'string', nullable: false, readOnly: false, required: true },
		{ name: 'sticky', type: 'boolean', nullable: false, readOnly: false, required: false },
		{ name: 'featured', type: 'boolean', nullable: false, readOnly: false, required: false },
		{ name: 'score', type: 'number', nullable: true, readOnly: false, required: false },
		{ name: 'items', type: 'array', nullable: false, readOnly: false, required: false },
		{ name: 'config', type: 'object', nullable: false, readOnly: false, required: false },
		{ name: 'summary', type: 'string', nullable: false, readOnly: false, required: false },
		{ name: 'meta', type: 'object', nullable: false, readOnly: false, required: false },
	],
	writableMetadata: [
		{ name: 'enabled', type: 'boolean', nullable: false, readOnly: false, required: false },
		{ name: 'settings', type: 'object', nullable: false, readOnly: false, required: false },
		{ name: 'unused', type: 'string', nullable: true, readOnly: false, required: false },
	],
};

type Parameters = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapperValue(
	value: Record<string, unknown> | null,
	removed: string[] = [],
): Record<string, unknown> {
	return {
		mappingMode: 'defineBelow',
		value,
		schema:
			value === null ? [] : Object.keys(value).map((id) => ({ id, removed: removed.includes(id) })),
	};
}

function unsafeValue(): Record<string, unknown> {
	const value: Record<string, unknown> = {};
	Object.defineProperty(value, '__proto__', { value: 'unsafe', enumerable: true });
	return value;
}

type TestContext = IExecuteFunctions & {
	getNodeParameter: Mock<IExecuteFunctions['getNodeParameter']>;
};

function createContext(parameters: Parameters[], continueOnFail = false): TestContext {
	return {
		getInputData: vi.fn().mockReturnValue(parameters.map((json) => ({ json }))),
		getNode: vi.fn().mockReturnValue(node),
		getNodeParameter: vi
			.fn()
			.mockImplementation(
				(
					name: string,
					itemIndex: number,
					fallback?: unknown,
					options?: { extractValue?: boolean },
				) => {
					const readParameter = (values: Parameters | undefined): unknown =>
						name.split('.').reduce<unknown>((current, part) => {
							if (!isRecord(current)) {
								return undefined;
							}
							return part in current ? current[part] : undefined;
						}, values);
					const itemValue = readParameter(parameters[itemIndex]);
					const value = itemValue === undefined ? readParameter(parameters[0]) : itemValue;
					if (
						name === 'postType' &&
						options?.extractValue &&
						typeof value === 'object' &&
						value !== null
					) {
						return 'value' in value ? value.value : fallback;
					}
					return value === undefined ? fallback : value;
				},
			),
		continueOnFail: vi.fn().mockReturnValue(continueOnFail),
	} as unknown as TestContext;
}

function paginationHeaders(totalPages: string, capitalized = false): Record<string, string> {
	const headers: Record<string, string> = {};
	headers[capitalized ? 'X-WP-TotalPages' : 'x-wp-totalpages'] = totalPages;
	return headers;
}

async function executeV2(context: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const nodeType = new Wordpress().getNodeType(2);
	if (!nodeType.execute) throw new Error('WordPress v2 execute is not registered');
	return (await nodeType.execute.call(context)) as INodeExecutionData[][];
}

describe('WordPress v2 node', () => {
	beforeEach(() => {
		getPostTypesMock.mockReset();
		resolvePostTypeMock.mockReset().mockResolvedValue(discoveredType);
		requestMock.mockReset();
		requestWithResponseMock.mockReset();
		getContentSchemaMock.mockReset().mockResolvedValue(writableSchema);
	});

	it('uses v2 by default and keeps v1 available for stored workflows', () => {
		const wordpress = new Wordpress();
		expect(wordpress.description.defaultVersion).toBe(2);
		expect(wordpress.nodeVersions[1]).toBeDefined();
		expect(wordpress.nodeVersions[2]).toBeInstanceOf(WordpressV2);
		expect(wordpress.getNodeType()).toBe(wordpress.nodeVersions[2]);
		expect(wordpress.getNodeType(1)).toBe(wordpress.nodeVersions[1]);
	});

	it('shows authentication, resource, post type, and operations in order', () => {
		const description = new Wordpress().getNodeType(2).description;
		expect(description.credentials).toEqual([
			expect.objectContaining({ name: 'wordpressApi' }),
			expect.objectContaining({ name: 'wordpressOAuth2Api' }),
		]);
		const names = description.properties.map((property) => property.name);
		expect(names.slice(0, 4)).toEqual(['authType', 'resource', 'postType', 'operation']);
		const operation = description.properties.find((property) => property.name === 'operation');
		expect(operation?.options).toEqual([
			{
				name: 'Create',
				value: 'create',
				action: 'Create an item',
				description: 'Create an item in the selected post type',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get an item',
				description: 'Get one item by ID',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many items',
				description: 'Get items from the selected post type',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update an item',
				description: 'Update an item in the selected post type',
			},
		]);
		const postType = description.properties.find((property) => property.name === 'postType');
		expect(postType?.displayName).toBe('Post Type');
		expect(postType?.modes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ displayName: 'From list', name: 'list' }),
				expect.objectContaining({
					displayName: 'By slug',
					name: 'slug',
					placeholder: 'post',
				}),
			]),
		);
		expect(JSON.stringify(postType)).toContain('Enter a registered post type slug');
		const returnAll = description.properties.find((property) => property.name === 'returnAll');
		expect(returnAll?.displayName).toBe('Return All');
		expect(description.properties.some((property) => property.name === 'metadata')).toBe(true);
		const createFields = description.properties.find(
			(property) =>
				property.name === 'fieldsToSend' &&
				property.displayOptions?.show?.operation?.includes('create'),
		);
		const createMetadata = description.properties.find(
			(property) =>
				property.name === 'metadata' &&
				property.displayOptions?.show?.operation?.includes('create'),
		);
		expect(createFields).toMatchObject({
			required: true,
			typeOptions: { resourceMapper: { supportAutoMap: false, allowEmptyValues: true } },
		});
		expect(createMetadata).toMatchObject({
			required: false,
			typeOptions: { resourceMapper: { supportAutoMap: false, allowEmptyValues: true } },
		});
	});

	it('creates items on the discovered collection route and preserves typed values', async () => {
		requestMock.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				fieldsToSend: mapperValue(
					{
						title: '',
						sticky: false,
						featured: false,
						score: 0,
						items: [],
						config: {},
						summary: '',
					},
					['featured'],
				),
				metadata: mapperValue({ enabled: false, settings: {}, unused: null }, ['unused']),
			},
			{
				fieldsToSend: mapperValue({ title: 'Second' }),
				metadata: mapperValue(null),
			},
		]);

		const result = await executeV2(context);

		expect(resolvePostTypeMock).toHaveBeenCalledTimes(1);
		expect(getContentSchemaMock).toHaveBeenCalledTimes(1);
		expect(requestMock).toHaveBeenNthCalledWith(
			1,
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{
				title: '',
				sticky: false,
				score: 0,
				items: [],
				config: {},
				summary: '',
				meta: { enabled: false, settings: {} },
			},
		);
		expect(requestMock).toHaveBeenNthCalledWith(
			2,
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{ title: 'Second' },
		);
		expect(result[0]).toEqual([
			{ json: { id: 11 }, pairedItem: { item: 0 } },
			{ json: { id: 12 }, pairedItem: { item: 1 } },
		]);
	});

	it('preserves an explicit nullable field value', async () => {
		requestMock.mockResolvedValue({ id: 13 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				fieldsToSend: mapperValue({ title: 'Nullable', score: null }),
				metadata: mapperValue(null),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{ title: 'Nullable', score: null },
		);
		const parameterNames = context.getNodeParameter.mock.calls.map(([name]) => name);
		expect(parameterNames).toContain('fieldsToSend');
		expect(parameterNames).toContain('fieldsToSend.value');
		expect(parameterNames).toContain('metadata');
		expect(parameterNames).not.toContain('metadata.value');
	});

	it('rejects malformed mapper values with the item index', async () => {
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'post',
				fieldsToSend: { mappingMode: 'defineBelow', value: 'invalid', schema: [] },
				metadata: mapperValue(null),
			},
		]);

		await expect(executeV2(context)).rejects.toMatchObject({ context: { itemIndex: 0 } });
		expect(requestMock).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: 'duplicate schema entries',
			mapper: {
				mappingMode: 'defineBelow',
				value: { title: 'Test' },
				schema: [
					{ id: 'title', removed: false },
					{ id: 'title', removed: true },
				],
			},
		},
		{
			name: 'an unsafe schema ID',
			mapper: {
				mappingMode: 'defineBelow',
				value: {},
				schema: [{ id: '__proto__', removed: false }],
			},
		},
		{
			name: 'an unknown active value',
			mapper: { mappingMode: 'defineBelow', value: { title: 'Test' }, schema: [] },
		},
		{
			name: 'automatic mapping',
			mapper: {
				mappingMode: 'autoMapInputData',
				value: { title: 'Test' },
				schema: [{ id: 'title', removed: false }],
			},
		},
		{
			name: 'an unsafe value key',
			mapper: {
				mappingMode: 'defineBelow',
				value: unsafeValue(),
				schema: [],
			},
		},
	])('rejects $name in mapper data', async ({ mapper }) => {
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'post',
				fieldsToSend: mapper,
				metadata: mapperValue(null),
			},
		]);

		await expect(executeV2(context)).rejects.toMatchObject({ context: { itemIndex: 0 } });
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('returns an item-paired error for an invalid API response', async () => {
		requestMock.mockResolvedValue('invalid');
		const context = createContext(
			[
				{
					resource: 'post',
					operation: 'update',
					postType: 'post',
					itemId: 5,
					fieldsToSend: mapperValue({}),
					metadata: mapperValue(null),
				},
			],
			true,
		);

		const result = await executeV2(context);

		expect(result[0]?.[0]?.json.error).toContain('invalid item');
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
	});

	it('stops a write before item requests when the schema is not writable', async () => {
		getContentSchemaMock.mockResolvedValue({
			...writableSchema,
			canCreate: false,
		});
		const context = createContext([{ resource: 'post', operation: 'create', postType: 'post' }]);

		await expect(executeV2(context)).rejects.toThrow("doesn't have a writable REST schema");
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('updates one item without sending omitted fields or metadata', async () => {
		requestMock.mockResolvedValue({ id: 21 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 21,
				fieldsToSend: mapperValue({ sticky: false }),
				metadata: mapperValue({ enabled: false }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [21] },
			{ sticky: false, meta: { enabled: false } },
		);
	});

	it('continues after one invalid update ID', async () => {
		requestMock.mockResolvedValue({ id: 22 });
		const context = createContext(
			[
				{
					resource: 'post',
					operation: 'update',
					postType: 'post',
					itemId: 0,
					fieldsToSend: mapperValue({}),
					metadata: mapperValue({}),
				},
				{ itemId: 22, fieldsToSend: mapperValue({}), metadata: mapperValue({}) },
			],
			true,
		);

		const result = await executeV2(context);

		expect(requestMock).toHaveBeenCalledTimes(1);
		expect(result[0]?.[0]?.json.error).toContain('positive whole number');
		expect(result[0]?.[1]).toEqual({ json: { id: 22 }, pairedItem: { item: 1 } });
	});

	it('lists friendly post type names and stores registered slugs', async () => {
		getPostTypesMock.mockResolvedValue([
			{ ...discoveredType, slug: 'post', name: 'Posts' },
			{ ...discoveredType, slug: 'bs_workflow', name: 'Workflows' },
		]);
		const context = { getNode: vi.fn().mockReturnValue(node) } as unknown as ILoadOptionsFunctions;

		await expect(searchPostTypes.call(context)).resolves.toEqual({
			results: [
				{ name: 'Posts', value: 'post' },
				{ name: 'Workflows', value: 'bs_workflow' },
			],
		});
		await expect(searchPostTypes.call(context, 'WORK')).resolves.toEqual({
			results: [{ name: 'Workflows', value: 'bs_workflow' }],
		});
	});

	it('resolves the selected post type once for multiple Get items', async () => {
		requestMock.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'get',
				postType: { mode: 'list', value: 'bs_workflow' },
				itemId: 11,
			},
			{ itemId: 12 },
		]);

		const result = await executeV2(context);

		expect(resolvePostTypeMock).toHaveBeenCalledTimes(1);
		expect(resolvePostTypeMock).toHaveBeenCalledWith('bs_workflow');
		expect(requestMock).toHaveBeenNthCalledWith(1, 'GET', {
			namespace: 'publisher/v3',
			base: 'library/items',
			suffix: [11],
		});
		expect(requestMock).toHaveBeenNthCalledWith(2, 'GET', {
			namespace: 'publisher/v3',
			base: 'library/items',
			suffix: [12],
		});
		expect(result).toEqual([
			[
				{ json: { id: 11 }, pairedItem: { item: 0 } },
				{ json: { id: 12 }, pairedItem: { item: 1 } },
			],
		]);
		expect(getContentSchemaMock).not.toHaveBeenCalled();
	});

	it('uses the discovered route for every Get Many page', async () => {
		requestWithResponseMock
			.mockResolvedValueOnce({ body: [{ id: 1 }], headers: paginationHeaders('2', true) })
			.mockResolvedValueOnce({ body: [{ id: 2 }], headers: paginationHeaders('2') });
		const context = createContext([
			{ resource: 'post', operation: 'getMany', postType: 'bs_workflow', returnAll: true },
		]);

		const result = await executeV2(context);

		expect(requestWithResponseMock).toHaveBeenNthCalledWith(
			1,
			'GET',
			{
				namespace: 'publisher/v3',
				base: 'library/items',
			},
			{ page: 1, per_page: 100 },
		);
		expect(requestWithResponseMock).toHaveBeenNthCalledWith(
			2,
			'GET',
			{
				namespace: 'publisher/v3',
				base: 'library/items',
			},
			{ page: 2, per_page: 100 },
		);
		expect(result[0]).toEqual([
			{ json: { id: 1 }, pairedItem: { item: 0 } },
			{ json: { id: 2 }, pairedItem: { item: 0 } },
		]);
		expect(getContentSchemaMock).not.toHaveBeenCalled();
	});

	it('respects the Get Many limit without requesting another page', async () => {
		requestWithResponseMock.mockResolvedValue({
			body: [{ id: 1 }, { id: 2 }, { id: 3 }],
			headers: paginationHeaders('4'),
		});
		const context = createContext([
			{ resource: 'post', operation: 'getMany', postType: 'post', returnAll: false, limit: 2 },
		]);

		const result = await executeV2(context);

		expect(requestWithResponseMock).toHaveBeenCalledTimes(1);
		expect(requestWithResponseMock).toHaveBeenCalledWith('GET', expect.anything(), {
			page: 1,
			per_page: 2,
		});
		expect(result[0]).toHaveLength(2);
	});

	it('keeps the page size constant for a limit above 100', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
		const secondPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 101 }));
		requestWithResponseMock
			.mockResolvedValueOnce({ body: firstPage, headers: paginationHeaders('2') })
			.mockResolvedValueOnce({ body: secondPage, headers: paginationHeaders('2') });
		const context = createContext([
			{
				resource: 'post',
				operation: 'getMany',
				postType: 'post',
				returnAll: false,
				limit: 150,
			},
		]);

		const result = await executeV2(context);

		expect(requestWithResponseMock).toHaveBeenNthCalledWith(1, 'GET', expect.anything(), {
			page: 1,
			per_page: 100,
		});
		expect(requestWithResponseMock).toHaveBeenNthCalledWith(2, 'GET', expect.anything(), {
			page: 2,
			per_page: 100,
		});
		expect(result[0]).toHaveLength(150);
		expect(result[0]?.map((item) => item.json.id)).toEqual(
			Array.from({ length: 150 }, (_, index) => index + 1),
		);
	});

	it('accepts a large reported total when a finite limit is satisfied', async () => {
		const pageItems = Array.from({ length: 50 }, (_, index) => ({ id: index + 1 }));
		requestWithResponseMock.mockResolvedValue({
			body: pageItems,
			headers: paginationHeaders('10001'),
		});
		const context = createContext([
			{
				resource: 'post',
				operation: 'getMany',
				postType: 'post',
				returnAll: false,
				limit: 50,
			},
		]);

		const result = await executeV2(context);

		expect(requestWithResponseMock).toHaveBeenCalledTimes(1);
		expect(result[0]).toHaveLength(50);
		expect(result[0]?.map((item) => item.json.id)).toEqual(
			Array.from({ length: 50 }, (_, index) => index + 1),
		);
	});

	it.each([
		['item ID', { operation: 'get', itemId: 0 }, requestMock],
		['limit', { operation: 'getMany', returnAll: false, limit: 1.5 }, requestWithResponseMock],
		[
			'Return All value',
			{ operation: 'getMany', returnAll: 'yes', limit: 1 },
			requestWithResponseMock,
		],
	])('rejects an invalid %s before the item request', async (_label, values, transportMock) => {
		const context = createContext([{ resource: 'post', postType: 'post', ...values }]);
		await expect(executeV2(context)).rejects.toThrow(NodeOperationError);
		expect(transportMock).not.toHaveBeenCalled();
	});

	it.each([
		[{ body: {}, headers: {} }, /invalid item list/],
		[{ body: [], headers: {} }, /didn't return the total page count/],
		[{ body: [], headers: paginationHeaders('2') }, /empty page before pagination finished/],
		[{ body: [], headers: paginationHeaders('many') }, /invalid total page count/],
		[{ body: [], headers: paginationHeaders('10001') }, /Turn off Return All/],
		[{ body: [], headers: [] }, /invalid pagination headers/],
	])('rejects a malformed collection response', async (response, message) => {
		requestWithResponseMock.mockResolvedValue(response);
		const context = createContext([
			{ resource: 'post', operation: 'getMany', postType: 'post', returnAll: true },
		]);
		await expect(executeV2(context)).rejects.toThrow(message);
	});

	it('accepts an empty collection with zero total pages', async () => {
		requestWithResponseMock.mockResolvedValue({
			body: [],
			headers: paginationHeaders('0'),
		});
		const context = createContext([
			{ resource: 'post', operation: 'getMany', postType: 'post', returnAll: true },
		]);

		await expect(executeV2(context)).resolves.toEqual([[]]);
		expect(requestWithResponseMock).toHaveBeenCalledTimes(1);
	});

	it('continues after a per-item Get failure and preserves pairing', async () => {
		requestMock
			.mockRejectedValueOnce(new Error('Request failed'))
			.mockResolvedValueOnce({ id: 22 });
		const context = createContext(
			[{ resource: 'post', operation: 'get', postType: 'post', itemId: 21 }, { itemId: 22 }],
			true,
		);

		await expect(executeV2(context)).resolves.toEqual([
			[
				{ json: { error: 'Request failed' }, pairedItem: { item: 0 } },
				{ json: { id: 22 }, pairedItem: { item: 1 } },
			],
		]);
	});

	it('stops on a shared discovery failure even when continue on fail is enabled', async () => {
		resolvePostTypeMock.mockRejectedValue(new Error('Discovery failed'));
		const context = createContext(
			[{ resource: 'post', operation: 'get', postType: 'post', itemId: 1 }, { itemId: 2 }],
			true,
		);

		await expect(executeV2(context)).rejects.toThrow('Discovery failed');
		expect(resolvePostTypeMock).toHaveBeenCalledTimes(1);
		expect(requestMock).not.toHaveBeenCalled();
	});
});
