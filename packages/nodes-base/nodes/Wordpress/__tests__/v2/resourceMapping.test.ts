import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import type { Mock } from 'vitest';

import * as PostTypes from '../../v2/helpers/postTypes';
import type * as PostTypesType from '../../v2/helpers/postTypes';
import * as Schemas from '../../v2/helpers/schemas';
import type * as SchemasType from '../../v2/helpers/schemas';
import { getContentFields, getMetadataFields } from '../../v2/methods/resourceMapping';

vi.mock('../../v2/helpers/postTypes', async () => ({
	...(await vi.importActual<typeof PostTypesType>('../../v2/helpers/postTypes')),
	resolvePostType: vi.fn(),
}));
vi.mock('../../v2/helpers/schemas', async () => ({
	...(await vi.importActual<typeof SchemasType>('../../v2/helpers/schemas')),
	getContentSchema: vi.fn(),
}));

const resolvePostTypeMock = PostTypes.resolvePostType as Mock;
const getContentSchemaMock = Schemas.getContentSchema as Mock;
const node = { name: 'WordPress' } as INode;
const postType = { slug: 'custom', name: 'Custom', restNamespace: 'site/v3', restBase: 'things' };

type TestLoadContext = ILoadOptionsFunctions & {
	getCurrentNodeParameter: Mock<ILoadOptionsFunctions['getCurrentNodeParameter']>;
};

function context(operation: 'create' | 'update'): TestLoadContext {
	return {
		getNode: vi.fn().mockReturnValue(node),
		getCurrentNodeParameter: vi
			.fn()
			.mockImplementation((name: string) => (name === 'postType' ? 'custom' : operation)),
	} as unknown as TestLoadContext;
}

describe('WordPress v2 resource mapping', () => {
	beforeEach(() => {
		resolvePostTypeMock.mockReset().mockResolvedValue(postType);
		getContentSchemaMock.mockReset().mockResolvedValue({
			canCreate: true,
			canRead: true,
			writableProperties: [
				{ name: 'name', type: 'string', nullable: false, readOnly: false, required: true },
				{ name: 'count', type: 'integer', nullable: false, readOnly: false, required: false },
				{ name: 'ratio', type: 'number', nullable: true, readOnly: false, required: false },
				{ name: 'enabled', type: 'boolean', nullable: false, readOnly: false, required: false },
				{ name: 'list', type: 'array', nullable: false, readOnly: false, required: false },
				{ name: 'config', type: 'object', nullable: false, readOnly: false, required: false },
				{ name: 'hidden', type: 'string', nullable: false, readOnly: true, required: false },
				{ name: 'meta', type: 'object', nullable: false, readOnly: false, required: false },
			],
			writableMetadata: [
				{ name: 'flag', type: 'boolean', nullable: false, readOnly: false, required: false },
				{ name: 'label', type: 'string', nullable: false, readOnly: false, required: false },
				{ name: 'count', type: 'integer', nullable: false, readOnly: false, required: true },
				{ name: 'ratio', type: 'number', nullable: true, readOnly: false, required: false },
				{ name: 'items', type: 'array', nullable: false, readOnly: false, required: false },
				{ name: 'config', type: 'object', nullable: false, readOnly: false, required: false },
				{ name: 'internal', type: 'string', nullable: false, readOnly: true, required: false },
			],
		});
	});

	it('returns empty fields without discovery while the post type is blank', async () => {
		const loadContext = context('create');
		loadContext.getCurrentNodeParameter.mockReturnValue('');

		await expect(getContentFields.call(loadContext)).resolves.toEqual({ fields: [] });
		expect(resolvePostTypeMock).not.toHaveBeenCalled();
		expect(getContentSchemaMock).not.toHaveBeenCalled();
	});

	it('resolves the post type and schema once for one mapper load', async () => {
		const loadContext = context('create');

		await getContentFields.call(loadContext);

		expect(loadContext.getCurrentNodeParameter.mock.calls).toContainEqual([
			'postType',
			{ extractValue: true },
		]);
		expect(resolvePostTypeMock).toHaveBeenCalledTimes(1);
		expect(resolvePostTypeMock).toHaveBeenCalledWith('custom');
		expect(getContentSchemaMock).toHaveBeenCalledTimes(1);
		expect(getContentSchemaMock).toHaveBeenCalledWith(postType);
	});

	it.each([
		['Posts', { type: 'object', required: false, properties: [] }, 0],
		['Pages', { type: 'object', required: true, properties: [] }, 0],
		[
			'custom content',
			{
				type: 'object',
				required: false,
				properties: { external_id: { type: 'string', required: false } },
			},
			1,
		],
	])('loads %s metadata from a realistic OPTIONS schema', async (_name, meta, count) => {
		const payload = {
			namespace: 'site/v3',
			methods: ['GET', 'POST'],
			endpoints: [{ methods: ['POST'], args: { meta } }],
			schema: { type: 'object', properties: { meta } },
		};
		getContentSchemaMock.mockResolvedValue(Schemas.parseContentSchema(node, payload, postType));

		const create = await getMetadataFields.call(context('create'));
		const update = await getMetadataFields.call(context('update'));

		expect(create.fields).toHaveLength(count);
		expect(update.fields).toHaveLength(count);
	});

	it('shows required Create fields initially and keeps optional fields addable', async () => {
		const result = await getContentFields.call(context('create'));

		expect(result.fields).toEqual([
			expect.objectContaining({
				id: 'content:name',
				displayName: 'name',
				type: 'string',
				required: true,
				removed: false,
			}),
			expect.objectContaining({
				id: 'content:count',
				displayName: 'count',
				type: 'number',
				required: false,
				removed: true,
			}),
			expect.objectContaining({
				id: 'content:ratio',
				displayName: 'ratio',
				type: 'number',
				required: false,
				removed: true,
			}),
			expect.objectContaining({
				id: 'content:enabled',
				displayName: 'enabled',
				type: 'boolean',
				removed: true,
			}),
			expect.objectContaining({
				id: 'content:list',
				displayName: 'list',
				type: 'array',
				removed: true,
			}),
			expect.objectContaining({
				id: 'content:config',
				displayName: 'config',
				type: 'object',
				removed: true,
			}),
		]);
		expect(result.fields.slice(1).every((field) => field.display && field.removed)).toBe(true);
	});

	it('hides every Update field initially while keeping it addable', async () => {
		const result = await getContentFields.call(context('update'));

		expect(result.fields.every((field) => !field.required)).toBe(true);
		expect(result.fields.every((field) => field.removed)).toBe(true);
		expect(result.fields.every((field) => field.display)).toBe(true);
	});

	it.each(['create', 'update'] as const)(
		'shows supported common fields for %s without inventing fields or defaults',
		async (operation) => {
			getContentSchemaMock.mockResolvedValue({
				canCreate: true,
				canRead: true,
				writableProperties: [
					{ name: 'title', type: 'string', nullable: false, readOnly: false, required: false },
					{ name: 'content', type: 'string', nullable: false, readOnly: false, required: false },
					{ name: 'excerpt', type: 'string', nullable: false, readOnly: false, required: false },
					{
						name: 'status',
						type: 'string',
						enum: ['draft', 'publish'],
						nullable: false,
						readOnly: false,
						required: false,
					},
					{
						name: 'external_id',
						type: 'string',
						nullable: false,
						readOnly: false,
						required: true,
					},
					{
						name: 'custom_score',
						type: 'number',
						nullable: false,
						readOnly: false,
						required: false,
					},
				],
				writableMetadata: [],
			});

			const { fields } = await getContentFields.call(context(operation));

			expect(fields.map((field) => field.id)).toEqual([
				'content:title',
				'content:content',
				'content:excerpt',
				'content:status',
				'content:external_id',
				'content:custom_score',
			]);
			expect(fields.find((field) => field.id === 'content:title')).toMatchObject({
				type: 'string',
				removed: false,
				required: false,
			});
			expect(fields.find((field) => field.id === 'content:status')).toMatchObject({
				type: 'options',
				removed: false,
				required: false,
			});
			expect(fields.find((field) => field.id === 'content:content')).toMatchObject({
				type: 'string',
				removed: false,
				required: false,
			});
			expect(fields.find((field) => field.id === 'content:excerpt')).toMatchObject({
				type: 'string',
				removed: false,
				required: false,
			});
			expect(fields.find((field) => field.id === 'content:external_id')).toMatchObject({
				display: true,
				removed: operation === 'update',
				required: operation === 'create',
			});
			expect(fields.find((field) => field.id === 'content:custom_score')).toMatchObject({
				display: true,
				removed: true,
				required: false,
			});
			expect(fields.every((field) => field.defaultValue === undefined)).toBe(true);
		},
	);

	it('uses short labels and reliable controls', async () => {
		getContentSchemaMock.mockResolvedValue({
			canCreate: true,
			canRead: true,
			writableProperties: [
				{
					name: 'title',
					type: 'string',
					nullable: false,
					readOnly: false,
					required: true,
					description: 'The title.',
				},
				{
					name: 'tags',
					type: 'array',
					itemType: 'integer',
					nullable: false,
					readOnly: false,
					required: false,
				},
				{
					name: 'status',
					type: 'string',
					enum: ['draft', 'publish'],
					nullable: false,
					readOnly: false,
					required: false,
				},
				{
					name: 'published_at',
					type: 'string',
					format: 'date-time',
					nullable: false,
					readOnly: false,
					required: false,
				},
				{
					name: 'settings',
					type: 'object',
					properties: [
						{ name: 'mode', type: 'string', required: true, readOnly: false },
						{ name: 'rendered', type: 'string', required: false, readOnly: true },
					],
					nullable: false,
					readOnly: false,
					required: false,
				},
			],
			writableMetadata: [],
		});

		const { fields } = await getContentFields.call(context('create'));
		expect(fields).toMatchObject([
			{ id: 'content:title', displayName: 'title', type: 'string' },
			{
				id: 'content:tags',
				displayName: 'tags',
				type: 'array',
			},
			{
				id: 'content:status',
				type: 'options',
				options: [
					{ name: 'Draft', value: 'draft' },
					{ name: 'Publish', value: 'publish' },
				],
			},
			{ id: 'content:published_at', type: 'dateTime' },
			{
				id: 'content:settings',
				displayName: 'settings',
				type: 'object',
			},
		]);
		expect(fields.every((field) => field.defaultValue === undefined)).toBe(true);
	});

	it('requires metadata children on create only when the metadata container is required', async () => {
		getContentSchemaMock.mockResolvedValue({
			canCreate: true,
			canRead: true,
			writableProperties: [
				{ name: 'meta', type: 'object', nullable: false, readOnly: false, required: true },
			],
			writableMetadata: [
				{ name: 'flag', type: 'boolean', nullable: false, readOnly: false, required: true },
			],
		});

		const create = await getMetadataFields.call(context('create'));
		const update = await getMetadataFields.call(context('update'));

		expect(create.fields[0]).toMatchObject({
			id: 'metadata:flag',
			required: true,
			removed: false,
		});
		expect(update.fields[0]).toMatchObject({
			id: 'metadata:flag',
			required: false,
			removed: true,
		});
	});

	it('returns registered metadata with native controls and excludes read-only fields', async () => {
		const create = await getMetadataFields.call(context('create'));

		expect(create.fields).toEqual([
			expect.objectContaining({ id: 'metadata:flag', displayName: 'flag', type: 'boolean' }),
			expect.objectContaining({ id: 'metadata:label', displayName: 'label', type: 'string' }),
			expect.objectContaining({ id: 'metadata:count', displayName: 'count', type: 'number' }),
			expect.objectContaining({ id: 'metadata:ratio', displayName: 'ratio', type: 'number' }),
			expect.objectContaining({ id: 'metadata:items', displayName: 'items', type: 'array' }),
			expect.objectContaining({ id: 'metadata:config', displayName: 'config', type: 'object' }),
		]);
		expect(create.fields.every((field) => field.display)).toBe(true);
		expect(create.fields.every((field) => field.defaultValue === undefined)).toBe(true);
	});

	it('returns no metadata fields when discovery is blank', async () => {
		const loadContext = context('create');
		loadContext.getCurrentNodeParameter.mockReturnValue('');

		await expect(getMetadataFields.call(loadContext)).resolves.toEqual({ fields: [] });
	});
});
