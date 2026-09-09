import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { Mock } from 'vitest';

import * as GenericFunctions from '../v1/GenericFunctions';
import type * as GenericFunctionsType from '../v1/GenericFunctions';
import { WordpressV1 } from '../v1/WordpressV1.node';
import { WordpressV2 } from '../v2/WordpressV2.node';
import { Wordpress } from '../Wordpress.node';

vi.mock('../v1/GenericFunctions', async () => ({
	...(await vi.importActual<typeof GenericFunctionsType>('../v1/GenericFunctions')),
	wordpressApiRequest: vi.fn(),
	wordpressApiRequestAllItems: vi.fn(),
}));

const wordpressApiRequestMock = GenericFunctions.wordpressApiRequest as Mock;

type ParameterValues = Record<string, unknown>;

function createExecuteFunctions(
	resource: string,
	operation: string,
	parameters: ParameterValues[],
	continueOnFail = false,
): IExecuteFunctions {
	return {
		getInputData: vi.fn().mockReturnValue(parameters.map((json) => ({ json }))),
		getNodeParameter: vi
			.fn()
			.mockImplementation((name: string, itemIndex: number, fallback?: unknown) => {
				if (name === 'resource') return resource;
				if (name === 'operation') return operation;

				const value = parameters[itemIndex]?.[name];
				return value === undefined ? fallback : value;
			}),
		getNode: vi.fn().mockReturnValue({ name: 'Wordpress' }),
		continueOnFail: vi.fn().mockReturnValue(continueOnFail),
		helpers: {
			returnJsonArray: vi.fn().mockImplementation((data: IDataObject | IDataObject[]) => {
				const values = Array.isArray(data) ? data : [data];
				return values.map((json) => ({ json }));
			}),
			constructExecutionMetaData: vi
				.fn()
				.mockImplementation(
					(data: INodeExecutionData[], metadata: { itemData: { item: number } }) =>
						data.map((item) => ({ ...item, pairedItem: metadata.itemData })),
				),
		},
	} as unknown as IExecuteFunctions;
}

describe('Wordpress node v1', () => {
	beforeEach(() => {
		wordpressApiRequestMock.mockReset();
	});

	it('registers and resolves version 1', () => {
		const wordpress = new Wordpress();

		expect(Object.keys(wordpress.nodeVersions)).toEqual(['1', '2']);
		expect(wordpress.description).toMatchObject({
			displayName: 'Wordpress',
			name: 'wordpress',
			icon: 'file:wordpress.svg',
			group: ['output'],
			defaultVersion: 1,
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			description: 'Consume Wordpress API',
			usableAsTool: true,
		});
		expect(wordpress.nodeVersions[1]).toBeInstanceOf(WordpressV1);
		expect(wordpress.nodeVersions[2]).toBeInstanceOf(WordpressV2);
		expect(wordpress.getNodeType()).toBe(wordpress.nodeVersions[1]);
		expect(wordpress.getNodeType(1)).toBe(wordpress.nodeVersions[1]);
	});

	it('keeps the stored workflow description contract', () => {
		const { description } = new Wordpress().getNodeType(1);

		expect(description).toMatchObject({
			name: 'wordpress',
			version: 1,
			credentials: [
				{ name: 'wordpressApi', displayOptions: { show: { authType: ['basicAuth'] } } },
				{ name: 'wordpressOAuth2Api', displayOptions: { show: { authType: ['oAuth2'] } } },
			],
		});
		expect(description.properties).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'authType',
					default: 'basicAuth',
					options: [
						{ name: 'Basic Auth', value: 'basicAuth' },
						{ name: 'OAuth2 (WordPress.com)', value: 'oAuth2' },
					],
				}),
				expect.objectContaining({
					name: 'resource',
					default: 'post',
					options: [
						{ name: 'Post', value: 'post' },
						{ name: 'Page', value: 'page' },
						{ name: 'User', value: 'user' },
					],
				}),
			]),
		);

		for (const resource of ['post', 'page', 'user']) {
			const operationProperty = description.properties.find(
				(property) =>
					property.name === 'operation' &&
					property.displayOptions?.show?.resource?.includes(resource),
			);

			expect(operationProperty).toBeDefined();
			expect(
				operationProperty?.options?.map((option) => ('value' in option ? option.value : undefined)),
			).toEqual(['create', 'get', 'getAll', 'update']);
		}
	});

	it.each([
		{
			resource: 'post',
			parameters: { postId: '11', options: { force: true } },
			path: '/posts/11',
			query: { force: true },
		},
		{
			resource: 'page',
			parameters: { pageId: '12', options: { force: true } },
			path: '/pages/12',
			query: { force: true },
		},
		{
			resource: 'user',
			parameters: { reassign: '13' },
			path: '/users/me',
			query: { reassign: '13', force: true },
		},
	])('runs a stored $resource delete operation', async ({ resource, parameters, path, query }) => {
		wordpressApiRequestMock.mockResolvedValue({ deleted: true });
		const executeFunctions = createExecuteFunctions(resource, 'delete', [parameters]);

		const wordpressV1 = new Wordpress().getNodeType(1);
		const result = await wordpressV1.execute!.call(executeFunctions);

		expect(wordpressApiRequestMock).toHaveBeenCalledWith('DELETE', path, {}, query);
		expect(result).toEqual([[{ json: { deleted: true }, pairedItem: { item: 0 } }]]);
	});

	it('returns an error item and continues with later input', async () => {
		wordpressApiRequestMock
			.mockRejectedValueOnce(new Error('Request failed'))
			.mockResolvedValueOnce({ id: 22 });
		const executeFunctions = createExecuteFunctions(
			'post',
			'get',
			[
				{ postId: '21', options: {} },
				{ postId: '22', options: {} },
			],
			true,
		);

		const wordpressV1 = new Wordpress().getNodeType(1);
		const result = await wordpressV1.execute!.call(executeFunctions);

		expect(wordpressApiRequestMock).toHaveBeenNthCalledWith(1, 'GET', '/posts/21', {}, {});
		expect(wordpressApiRequestMock).toHaveBeenNthCalledWith(2, 'GET', '/posts/22', {}, {});
		expect(result).toEqual([
			[{ json: { error: 'Request failed' } }, { json: { id: 22 }, pairedItem: { item: 1 } }],
		]);
	});

	it('omits false and empty string post update values but keeps empty arrays', async () => {
		wordpressApiRequestMock.mockResolvedValue({ id: 23 });
		const executeFunctions = createExecuteFunctions('post', 'update', [
			{
				postId: '23',
				updateFields: { title: '', sticky: false, categories: [], tags: [] },
			},
		]);

		const wordpressV1 = new Wordpress().getNodeType(1);
		await wordpressV1.execute!.call(executeFunctions);

		expect(wordpressApiRequestMock).toHaveBeenCalledWith('POST', '/posts/23', {
			id: 23,
			categories: [],
			tags: [],
		});
	});
});
