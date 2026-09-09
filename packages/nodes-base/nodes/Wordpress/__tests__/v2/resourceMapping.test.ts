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
				{ name: 'flag', type: 'boolean', nullable: false, readOnly: false, required: true },
				{ name: 'label', type: 'string', nullable: false, readOnly: false, required: false },
				{ name: 'count', type: 'integer', nullable: false, readOnly: false, required: false },
				{ name: 'ratio', type: 'number', nullable: true, readOnly: false, required: false },
				{ name: 'items', type: 'array', nullable: false, readOnly: false, required: false },
				{ name: 'config', type: 'object', nullable: false, readOnly: false, required: false },
				{ name: 'internal', type: 'string', nullable: false, readOnly: true, required: false },
			],
		});
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
	])('loads %s fields from a realistic OPTIONS metadata schema', async (_name, meta, count) => {
		const payload = {
			namespace: 'site/v3',
			methods: ['GET', 'POST'],
			endpoints: [{ methods: ['POST'], args: { meta } }],
			schema: { type: 'object', properties: { meta } },
		};
		getContentSchemaMock.mockResolvedValue(Schemas.parseContentSchema(node, payload, postType));

		await expect(getContentFields.call(context('create'))).resolves.toEqual({ fields: [] });
		const createMetadata = await getMetadataFields.call(context('create'));
		expect(createMetadata.fields).toHaveLength(count);
		await expect(getContentFields.call(context('update'))).resolves.toEqual({ fields: [] });
		const metadata = await getMetadataFields.call(context('update'));
		expect(metadata.fields).toHaveLength(count);
	});

	it('returns empty fields while the post type selection is blank', async () => {
		const loadContext = context('create');
		loadContext.getCurrentNodeParameter.mockReturnValue('');

		await expect(getContentFields.call(loadContext)).resolves.toEqual({ fields: [] });
		await expect(getMetadataFields.call(loadContext)).resolves.toEqual({ fields: [] });
		expect(resolvePostTypeMock).not.toHaveBeenCalled();
		expect(getContentSchemaMock).not.toHaveBeenCalled();
	});

	it('reads the current post type selection and loads its fields', async () => {
		const loadContext = context('create');

		await getContentFields.call(loadContext);

		expect(loadContext.getCurrentNodeParameter.mock.calls).toContainEqual([
			'postType',
			{ extractValue: true },
		]);
		expect(resolvePostTypeMock).toHaveBeenCalledWith('custom');
		expect(getContentSchemaMock).toHaveBeenCalledWith(postType);
	});

	it('maps writable POST arguments without a hardcoded title or meta container', async () => {
		const result = await getContentFields.call(context('create'));

		expect(
			result.fields.map(({ id, type, required, display }) => ({ id, type, required, display })),
		).toEqual([
			{ id: 'name', type: 'string', required: true, display: true },
			{ id: 'count', type: 'number', required: false, display: true },
			{ id: 'ratio', type: 'number', required: false, display: true },
			{ id: 'enabled', type: 'boolean', required: false, display: true },
			{ id: 'list', type: 'array', required: false, display: true },
			{ id: 'config', type: 'object', required: false, display: true },
		]);
		expect(result.fields.some((field) => field.id === 'title')).toBe(false);
	});

	it('keeps children optional when the metadata container is optional', async () => {
		const create = await getMetadataFields.call(context('create'));
		const update = await getMetadataFields.call(context('update'));

		expect(create.fields.map(({ id, type, required }) => ({ id, type, required }))).toEqual([
			{ id: 'flag', type: 'boolean', required: false },
			{ id: 'label', type: 'string', required: false },
			{ id: 'count', type: 'number', required: false },
			{ id: 'ratio', type: 'number', required: false },
			{ id: 'items', type: 'array', required: false },
			{ id: 'config', type: 'object', required: false },
		]);
		expect(update.fields.every((field) => !field.required)).toBe(true);
	});

	it('requires a child on create only when the metadata container is required', async () => {
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

		expect(create.fields[0]).toMatchObject({ id: 'flag', required: true });
		expect(update.fields[0]).toMatchObject({ id: 'flag', required: false });
	});

	it('returns a clear notice when the post type has no registered metadata', async () => {
		getContentSchemaMock.mockResolvedValue({
			canCreate: true,
			canRead: true,
			writableProperties: [],
			writableMetadata: [],
		});

		await expect(getMetadataFields.call(context('create'))).resolves.toEqual({
			fields: [],
			emptyFieldsNotice:
				'No registered metadata is available for this post type. Register REST metadata in WordPress, then refresh the fields.',
		});
	});
});
