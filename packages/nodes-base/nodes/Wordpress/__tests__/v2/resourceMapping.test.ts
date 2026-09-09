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

function context(operation: 'create' | 'update'): ILoadOptionsFunctions {
	return {
		getNode: vi.fn().mockReturnValue(node),
		getNodeParameter: vi
			.fn()
			.mockImplementation((name: string) => (name === 'postType' ? 'custom' : operation)),
	} as unknown as ILoadOptionsFunctions;
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
