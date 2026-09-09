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
		{ name: 'enabled', type: 'boolean', nullable: false, readOnly: false, required: false },
		{ name: 'meta', type: 'object', nullable: false, readOnly: false, required: false },
	],
	writableMetadata: [
		{ name: 'enabled', type: 'boolean', nullable: false, readOnly: false, required: false },
		{ name: 'count', type: 'integer', nullable: false, readOnly: false, required: false },
		{ name: 'label', type: 'string', nullable: false, readOnly: false, required: false },
		{ name: 'items', type: 'array', nullable: false, readOnly: false, required: false },
		{ name: 'settings', type: 'object', nullable: false, readOnly: false, required: false },
		{ name: 'unused', type: 'string', nullable: true, readOnly: false, required: false },
	],
};

type Parameters = Record<string, unknown>;

function mapperId(kind: 'content' | 'metadata', name: string): string {
	return `${kind}:${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapperValue(
	value: Record<string, unknown> | null,
	metadata: Record<string, unknown> = {},
	removed: string[] = [],
): Record<string, unknown> {
	const mappedValue =
		value === null
			? null
			: {
					...Object.fromEntries(
						Object.entries(value).map(([name, fieldValue]) => [`content:${name}`, fieldValue]),
					),
					...Object.fromEntries(
						Object.entries(metadata).map(([name, fieldValue]) => [`metadata:${name}`, fieldValue]),
					),
				};
	return {
		mappingMode: 'defineBelow',
		value: mappedValue,
		schema:
			mappedValue === null
				? []
				: Object.keys(mappedValue).map((id) => ({ id, removed: removed.includes(id) })),
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
					if (value !== undefined) return value;
					if (fallback !== undefined) return fallback;
					throw new Error(`Could not get parameter "${name}"`);
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

	it('shows v2 parameters and keeps write mapper state independent', () => {
		const description = new Wordpress().getNodeType(2).description;
		expect(description.subtitle).toContain('$parameter["resource"] === "post"');
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
				action: 'Create content',
				description: 'Create content in the selected post type',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get content',
				description: 'Get content by ID from the selected post type',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many content items',
				description: 'Get content items from the selected post type',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update content',
				description: 'Update content in the selected post type',
			},
		]);
		const resource = description.properties.find((property) => property.name === 'resource');
		expect(resource).toMatchObject({
			type: 'options',
			default: 'post',
			options: [
				{ name: 'Content', value: 'post' },
				{ name: 'User', value: 'user' },
			],
		});
		expect(operation?.displayOptions).toEqual({ show: { resource: ['post'] } });
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
		expect(description.properties.some((property) => property.name === 'metadata')).toBe(false);
		const createFields = description.properties.find(
			(property) => property.name === 'createFieldsToSend',
		);
		const updateFields = description.properties.find(
			(property) => property.name === 'updateFieldsToSend',
		);
		const createToggle = description.properties.find(
			(property) => property.name === 'createSendMetadata',
		);
		const updateToggle = description.properties.find(
			(property) => property.name === 'updateSendMetadata',
		);
		const createMetadata = description.properties.find(
			(property) => property.name === 'createMetadata',
		);
		const updateMetadata = description.properties.find(
			(property) => property.name === 'updateMetadata',
		);
		expect(createFields).toMatchObject({
			required: true,
			description:
				'For taxonomy fields, enter a JSON array of term IDs, such as [12, 34]. Enter [] to remove all terms.',
			displayOptions: { show: { resource: ['post'], operation: ['create'] } },
			typeOptions: {
				resourceMapper: {
					addAllFields: false,
					supportAutoMap: false,
					allowEmptyValues: true,
					valuesLabel: 'Fields to send',
				},
			},
		});
		expect(updateFields).toMatchObject({
			required: true,
			description:
				'For taxonomy fields, enter a JSON array of term IDs, such as [12, 34]. Enter [] to remove all terms.',
			displayOptions: { show: { resource: ['post'], operation: ['update'] } },
			typeOptions: {
				resourceMapper: { valuesLabel: 'Fields to update', addAllFields: false },
			},
		});
		expect(createFields?.name).not.toBe(updateFields?.name);
		expect(createToggle).toMatchObject({
			displayName: 'Send Metadata',
			default: false,
			noDataExpression: true,
			displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		});
		expect(updateToggle).toMatchObject({
			displayName: 'Send Metadata',
			default: false,
			displayOptions: { show: { resource: ['post'], operation: ['update'] } },
		});
		expect(createMetadata).toMatchObject({
			displayName: 'Metadata',
			description: 'Select the registered metadata fields to send',
			displayOptions: {
				show: { resource: ['post'], operation: ['create'], createSendMetadata: [true] },
			},
			typeOptions: {
				resourceMapper: {
					resourceMapperMethod: 'getMetadataFields',
					valuesLabel: 'Metadata',
					addAllFields: false,
				},
			},
		});
		expect(updateMetadata).toMatchObject({
			displayOptions: {
				show: { resource: ['post'], operation: ['update'], updateSendMetadata: [true] },
			},
		});
		expect(
			new Set(
				[
					createFields,
					updateFields,
					createToggle,
					updateToggle,
					createMetadata,
					updateMetadata,
				].map((property) => property?.name),
			),
		).toHaveProperty('size', 6);
	});

	it('shows the four compatible User actions without Content discovery fields', () => {
		const description = new Wordpress().getNodeType(2).description;
		const operations = description.properties.filter(
			(property) =>
				property.name === 'operation' && property.displayOptions?.show?.resource?.includes('user'),
		);
		expect(operations).toHaveLength(1);
		expect(operations[0]?.options).toEqual([
			expect.objectContaining({ name: 'Create', value: 'create' }),
			expect.objectContaining({ name: 'Get', value: 'get' }),
			expect.objectContaining({ name: 'Get Many', value: 'getAll' }),
			expect.objectContaining({ name: 'Update', value: 'update' }),
		]);
		expect(JSON.stringify(operations[0]?.options)).not.toContain('delete');
		const postType = description.properties.find((property) => property.name === 'postType');
		expect(postType?.displayOptions).toEqual({ show: { resource: ['post'] } });
		const userFieldNames = description.properties
			.filter((property) => property.displayOptions?.show?.resource?.includes('user'))
			.map((property) => property.name);
		expect(userFieldNames).toEqual(
			expect.arrayContaining(['username', 'name', 'firstName', 'lastName', 'email', 'password']),
		);
		expect(userFieldNames).not.toContain('postType');
		expect(userFieldNames).not.toContain('reassign');
	});

	it('creates a User with the v1 field names and v2 transport', async () => {
		requestMock.mockResolvedValue({ id: 7 });
		const context = createContext([
			{
				resource: 'user',
				operation: 'create',
				username: 'ada',
				name: 'Ada',
				firstName: 'Ada',
				lastName: 'Lovelace',
				email: 'ada@example.com',
				password: 'secret',
				additionalFields: { url: 'https://example.com', nickname: 'countess' },
			},
		]);

		await expect(executeV2(context)).resolves.toEqual([
			[{ json: { id: 7 }, pairedItem: { item: 0 } }],
		]);
		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'wp/v2', base: 'users' },
			{
				username: 'ada',
				name: 'Ada',
				first_name: 'Ada',
				last_name: 'Lovelace',
				email: 'ada@example.com',
				password: 'secret',
				url: 'https://example.com',
				nickname: 'countess',
			},
		);
		expect(resolvePostTypeMock).not.toHaveBeenCalled();
		expect(getContentSchemaMock).not.toHaveBeenCalled();
	});

	it('gets and updates Users by ID', async () => {
		requestMock.mockResolvedValueOnce({ id: 8 }).mockResolvedValueOnce({ id: 8, name: 'New' });
		const getContext = createContext([
			{ resource: 'user', operation: 'get', userId: '8', options: { context: 'edit' } },
		]);
		const updateContext = createContext([
			{
				resource: 'user',
				operation: 'update',
				userId: '8',
				updateFields: { name: 'New', firstName: 'Grace' },
			},
		]);

		await executeV2(getContext);
		await executeV2(updateContext);

		expect(requestMock).toHaveBeenNthCalledWith(
			1,
			'GET',
			{ namespace: 'wp/v2', base: 'users', suffix: [8] },
			undefined,
			{ context: 'edit' },
		);
		expect(requestMock).toHaveBeenNthCalledWith(
			2,
			'POST',
			{ namespace: 'wp/v2', base: 'users', suffix: [8] },
			{ id: 8, name: 'New', first_name: 'Grace' },
		);
	});

	it('gets a limited User collection with the stored getAll operation', async () => {
		requestMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
		const context = createContext([
			{
				resource: 'user',
				operation: 'getAll',
				returnAll: false,
				limit: 2,
				options: { context: 'view', orderBy: 'email', order: 'asc', search: 'ada', who: 'authors' },
			},
		]);

		const result = await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'GET',
			{ namespace: 'wp/v2', base: 'users' },
			undefined,
			{
				context: 'view',
				orderby: 'email',
				order: 'asc',
				search: 'ada',
				who: 'authors',
				per_page: 2,
			},
		);
		expect(result[0]).toEqual([
			{ json: { id: 1 }, pairedItem: { item: 0 } },
			{ json: { id: 2 }, pairedItem: { item: 0 } },
		]);
		expect(resolvePostTypeMock).not.toHaveBeenCalled();
		expect(getContentSchemaMock).not.toHaveBeenCalled();
		expect(context.getNodeParameter).not.toHaveBeenCalledWith('userId', expect.anything());
	});

	it('paginates all Users and keeps per-item errors paired', async () => {
		requestWithResponseMock
			.mockResolvedValueOnce({ body: [{ id: 1 }], headers: paginationHeaders('2', true) })
			.mockResolvedValueOnce({ body: [{ id: 2 }], headers: paginationHeaders('2') });
		const allContext = createContext([
			{ resource: 'user', operation: 'getAll', returnAll: true, options: {} },
		]);

		await expect(executeV2(allContext)).resolves.toEqual([
			[
				{ json: { id: 1 }, pairedItem: { item: 0 } },
				{ json: { id: 2 }, pairedItem: { item: 0 } },
			],
		]);
		expect(requestWithResponseMock).toHaveBeenNthCalledWith(
			1,
			'GET',
			{ namespace: 'wp/v2', base: 'users' },
			{ per_page: 10, page: 1 },
		);
		expect(requestWithResponseMock).toHaveBeenNthCalledWith(
			2,
			'GET',
			{ namespace: 'wp/v2', base: 'users' },
			{ per_page: 10, page: 2 },
		);

		requestMock
			.mockReset()
			.mockRejectedValueOnce(new Error('Denied'))
			.mockResolvedValueOnce({ id: 3 });
		const continueContext = createContext(
			[
				{ resource: 'user', operation: 'get', userId: '2', options: {} },
				{ userId: '3', options: {} },
			],
			true,
		);
		const result = await executeV2(continueContext);
		expect(result[0]).toEqual([
			{ json: { error: 'Denied' }, pairedItem: { item: 0 } },
			{ json: { id: 3 }, pairedItem: { item: 1 } },
		]);
	});

	it.each([
		[{ body: [], headers: {} }, /didn't return the total page count/],
		[{ body: [], headers: paginationHeaders('many') }, /invalid total page count/],
		[{ body: [], headers: paginationHeaders('10001') }, /too many user pages/],
		[{ body: [], headers: [] }, /invalid pagination headers/],
		[{ body: [], headers: paginationHeaders('2') }, /empty user page/],
	])('rejects unsafe User pagination metadata', async (response, message) => {
		requestWithResponseMock.mockResolvedValue(response);
		const context = createContext([
			{ resource: 'user', operation: 'getAll', returnAll: true, options: {} },
		]);

		await expect(executeV2(context)).rejects.toThrow(message);
		expect(requestWithResponseMock).toHaveBeenCalledTimes(1);
		expect(context.getNodeParameter).not.toHaveBeenCalledWith('userId', expect.anything());
	});

	it.each([
		['Return All', { returnAll: 'yes', limit: 1 }, /Return All value isn't valid/],
		['fractional limit', { returnAll: false, limit: 1.5 }, /limit isn't valid/],
		['limit below range', { returnAll: false, limit: 0 }, /limit isn't valid/],
		['limit above range', { returnAll: false, limit: 11 }, /limit isn't valid/],
	])('rejects an invalid User %s before requesting data', async (_name, values, message) => {
		const context = createContext([
			{ resource: 'user', operation: 'getAll', options: {}, ...values },
		]);

		await expect(executeV2(context)).rejects.toThrow(message);
		expect(requestMock).not.toHaveBeenCalled();
		expect(requestWithResponseMock).not.toHaveBeenCalled();
	});

	it('reports an invalid single User response as an invalid user', async () => {
		requestMock.mockResolvedValue([]);
		const context = createContext([
			{ resource: 'user', operation: 'get', userId: '8', options: {} },
		]);

		await expect(executeV2(context)).rejects.toThrow(/invalid user\./);
	});

	it('sends resolved Resource Mapper arrays and objects as native values', async () => {
		requestMock.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue(
					{
						title: '',
						sticky: false,
						featured: false,
						score: 0,
						items: [],
						config: {},
						summary: '',
					},
					{},
					['content:featured'],
				),
				createSendMetadata: true,
				createMetadata: mapperValue({}, { enabled: false, settings: {} }),
			},
			{
				createFieldsToSend: mapperValue({ title: 'Second' }),
				createMetadata: mapperValue({}, {}),
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

	it.each([
		['create', 'createFieldsToSend'],
		['update', 'updateFieldsToSend'],
	] as const)(
		'uses only the %s operation mapper when it is configured',
		async (operation, name) => {
			requestMock.mockResolvedValue({ id: 14 });
			const context = createContext([
				{
					resource: 'post',
					operation,
					postType: 'bs_workflow',
					...(operation === 'update' ? { itemId: 14 } : {}),
					[name]: mapperValue({ title: operation }),
				},
			]);

			await executeV2(context);

			expect(requestMock).toHaveBeenCalledWith(
				'POST',
				{
					namespace: 'publisher/v3',
					base: 'library/items',
					...(operation === 'update' ? { suffix: [14] } : {}),
				},
				{ title: operation },
			);
		},
	);

	it('does not read or send hidden metadata when the toggle is false', async () => {
		requestMock.mockResolvedValue({ id: 20 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue({ title: 'No metadata' }),
				createSendMetadata: false,
				createMetadata: mapperValue({}, { enabled: true }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{ title: 'No metadata' },
		);
		expect(context.getNodeParameter).not.toHaveBeenCalledWith(
			'createMetadata',
			expect.anything(),
			expect.anything(),
		);
	});

	it('does not read metadata state from the other operation', async () => {
		requestMock.mockResolvedValue({ id: 20 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue({ title: 'Create' }),
				updateSendMetadata: true,
				updateMetadata: mapperValue({}, { enabled: true }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{ title: 'Create' },
		);
		expect(context.getNodeParameter).not.toHaveBeenCalledWith(
			'updateMetadata',
			expect.anything(),
			expect.anything(),
		);
	});

	it('sends selected metadata values when the toggle is true', async () => {
		requestMock.mockResolvedValue({ id: 21 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue({ title: '' }),
				createSendMetadata: true,
				createMetadata: mapperValue(
					{},
					{ enabled: false, count: 0, label: '', items: [], settings: {} },
				),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{
				title: '',
				meta: { enabled: false, count: 0, label: '', items: [], settings: {} },
			},
		);
	});

	it.each([
		['missing', undefined],
		['untouched', { mappingMode: 'defineBelow', value: null }],
		['empty', mapperValue({}, {})],
	] as const)('omits metadata when the enabled metadata mapper is %s', async (_name, metadata) => {
		requestMock.mockResolvedValue({ id: 22 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 22,
				updateFieldsToSend: mapperValue({}),
				updateSendMetadata: true,
				...(metadata === undefined ? {} : { updateMetadata: metadata }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [22] },
			{},
		);
	});

	it.each([
		['stale', mapperValue({ title: 'Wrong mapper' })],
		[
			'unsafe',
			{
				mappingMode: 'defineBelow',
				value: unsafeValue(),
				schema: [{ id: '__proto__', removed: false }],
			},
		],
	] as const)('rejects %s metadata when metadata is enabled', async (_name, metadata) => {
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue({ title: 'Test' }),
				createSendMetadata: true,
				createMetadata: metadata,
			},
		]);

		await expect(executeV2(context)).rejects.toThrow();
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('returns an item-paired error for invalid enabled metadata', async () => {
		const context = createContext(
			[
				{
					resource: 'post',
					operation: 'create',
					postType: 'bs_workflow',
					createFieldsToSend: mapperValue({ title: 'Test' }),
					createSendMetadata: true,
					createMetadata: mapperValue({ title: 'Wrong mapper' }),
				},
			],
			true,
		);

		const result = await executeV2(context);

		expect(result[0]?.[0]?.json.error).toContain('metadata mapping');
		expect(result[0]?.[0]?.pairedItem).toEqual({ item: 0 });
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('uses an untouched core mapper as an empty mapping', async () => {
		requestMock.mockResolvedValue({ id: 19 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 19,
				updateFieldsToSend: { mappingMode: 'defineBelow', value: null },
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [19] },
			{},
		);
	});

	it('reports invalid mapping when the core mapper is missing', async () => {
		const context = createContext([
			{ resource: 'post', operation: 'create', postType: 'bs_workflow' },
		]);

		await expect(executeV2(context)).rejects.toThrow('The field mapping is invalid');
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('preserves an explicit nullable field value', async () => {
		requestMock.mockResolvedValue({ id: 13 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'bs_workflow',
				createFieldsToSend: mapperValue({ title: 'Nullable', score: null }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items' },
			{ title: 'Nullable', score: null },
		);
		const parameterNames = context.getNodeParameter.mock.calls.map(([name]) => name);
		expect(parameterNames).toContain('createFieldsToSend');
		expect(parameterNames).toContain('createFieldsToSend.value');
		expect(parameterNames).not.toContain('createMetadata');
	});

	it('rejects malformed mapper values with the item index', async () => {
		const context = createContext([
			{
				resource: 'post',
				operation: 'create',
				postType: 'post',
				createFieldsToSend: { mappingMode: 'defineBelow', value: 'invalid', schema: [] },
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
				value: { [mapperId('content', 'title')]: 'Test' },
				schema: [
					{ id: 'content:title', removed: false },
					{ id: 'content:title', removed: true },
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
			mapper: {
				mappingMode: 'defineBelow',
				value: { [mapperId('content', 'title')]: 'Test' },
				schema: [],
			},
		},
		{
			name: 'automatic mapping',
			mapper: {
				mappingMode: 'autoMapInputData',
				value: { [mapperId('content', 'title')]: 'Test' },
				schema: [{ id: 'content:title', removed: false }],
			},
		},
		{
			name: 'a stale active value',
			mapper: {
				mappingMode: 'defineBelow',
				value: { [mapperId('content', 'retired')]: 'Test' },
				schema: [{ id: 'content:retired', removed: false }],
			},
		},
		{
			name: 'a metadata value in the content mapper',
			mapper: mapperValue({}, { enabled: true }),
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
				createFieldsToSend: mapper,
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
					updateFieldsToSend: mapperValue({}),
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

	it('updates one item without sending omitted metadata', async () => {
		requestMock.mockResolvedValue({ id: 21 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 21,
				updateFieldsToSend: mapperValue({ sticky: false }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [21] },
			{ sticky: false },
		);
	});

	it('omits visible untouched fields, including booleans', async () => {
		requestMock.mockResolvedValue({ id: 22 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 22,
				updateFieldsToSend: {
					mappingMode: 'defineBelow',
					value: {},
					schema: [
						{ id: 'content:title', removed: false },
						{ id: 'content:sticky', removed: false },
					],
				},
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [22] },
			{},
		);
	});

	it('keeps colliding content and metadata names in separate locations', async () => {
		requestMock.mockResolvedValue({ id: 22 });
		const context = createContext([
			{
				resource: 'post',
				operation: 'update',
				postType: 'bs_workflow',
				itemId: 22,
				updateFieldsToSend: mapperValue({ enabled: false }),
				updateSendMetadata: true,
				updateMetadata: mapperValue({}, { enabled: true }),
			},
		]);

		await executeV2(context);

		expect(requestMock).toHaveBeenCalledWith(
			'POST',
			{ namespace: 'publisher/v3', base: 'library/items', suffix: [22] },
			{ enabled: false, meta: { enabled: true } },
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
					updateFieldsToSend: mapperValue({}),
				},
				{ itemId: 22, updateFieldsToSend: mapperValue({}) },
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
