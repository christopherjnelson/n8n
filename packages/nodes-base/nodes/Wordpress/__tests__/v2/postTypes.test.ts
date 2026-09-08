import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { Mock } from 'vitest';

import { getPostTypes, parsePostTypeCollection, resolvePostType } from '../../v2/helpers/postTypes';
import * as Transport from '../../v2/transport';
import type * as TransportType from '../../v2/transport';

vi.mock('../../v2/transport', async () => ({
	...(await vi.importActual<typeof TransportType>('../../v2/transport')),
	wordpressApiRequest: vi.fn(),
}));

const wordpressApiRequestMock = Transport.wordpressApiRequest as Mock;
const node = { name: 'WordPress' } as INode;
const context = { getNode: vi.fn().mockReturnValue(node) } as unknown as ILoadOptionsFunctions;

const workflowType = {
	slug: 'bs_workflow',
	name: 'Workflows',
	rest_base: 'workflows',
	rest_namespace: 'wp/v2',
};

describe('WordPress v2 post type discovery', () => {
	beforeEach(() => {
		wordpressApiRequestMock.mockReset();
	});

	it('keeps the registered slug separate from its REST route', async () => {
		wordpressApiRequestMock.mockResolvedValue(workflowType);

		await expect(resolvePostType.call(context, 'bs_workflow')).resolves.toEqual({
			slug: 'bs_workflow',
			name: 'Workflows',
			restBase: 'workflows',
			restNamespace: 'wp/v2',
		});
		expect(wordpressApiRequestMock).toHaveBeenCalledWith(
			'GET',
			{ namespace: 'wp/v2', base: 'types', suffix: ['bs_workflow'] },
			undefined,
			{ context: 'edit' },
		);
	});

	it('preserves a discovered non-default namespace', async () => {
		wordpressApiRequestMock.mockResolvedValue({
			...workflowType,
			rest_namespace: 'acme/v1',
			rest_base: 'content/workflows',
		});

		await expect(resolvePostType.call(context, 'bs_workflow')).resolves.toMatchObject({
			restNamespace: 'acme/v1',
			restBase: 'content/workflows',
		});
	});

	it('requests the collection with edit context', async () => {
		wordpressApiRequestMock.mockResolvedValue({ bs_workflow: workflowType });

		await expect(getPostTypes.call(context)).resolves.toHaveLength(1);
		expect(wordpressApiRequestMock).toHaveBeenCalledWith(
			'GET',
			{ namespace: 'wp/v2', base: 'types' },
			undefined,
			{ context: 'edit' },
		);
	});

	it('makes one detail request for one resolver call', async () => {
		wordpressApiRequestMock.mockResolvedValue(workflowType);

		await resolvePostType.call(context, 'bs_workflow');

		expect(wordpressApiRequestMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		['an array', []],
		['a missing field', { slug: 'post', name: 'Posts', rest_base: 'posts' }],
		['an invalid route', { ...workflowType, rest_namespace: 'https://evil.example' }],
	])('rejects malformed detail data with %s', async (_label, response) => {
		wordpressApiRequestMock.mockResolvedValue(response);

		await expect(resolvePostType.call(context, 'bs_workflow')).rejects.toThrow(NodeOperationError);
	});

	it('rejects a detail response with a different slug', async () => {
		wordpressApiRequestMock.mockResolvedValue({ ...workflowType, slug: 'other_type' });

		await expect(resolvePostType.call(context, 'bs_workflow')).rejects.toThrow(
			/doesn't match the selected post type/,
		);
	});

	it('rejects a collection entry whose key differs from its slug', () => {
		expect(() => parsePostTypeCollection(node, { different_slug: workflowType })).toThrow(
			/doesn't match its list key/,
		);
	});

	it('rejects unsafe collection keys without assigning them', () => {
		const response = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(response, '__proto__', { enumerable: true, value: workflowType });

		expect(() => parsePostTypeCollection(node, response)).toThrow(/invalid post type key/);
	});

	it.each([null, []])('rejects a malformed post type collection: %j', (response) => {
		expect(() => parsePostTypeCollection(node, response)).toThrow(/invalid post type list/);
	});

	it('accepts a registered slug at the official length limit', async () => {
		const slug = 'a'.repeat(20);
		wordpressApiRequestMock.mockResolvedValue({ ...workflowType, slug });

		await expect(resolvePostType.call(context, slug)).resolves.toMatchObject({ slug });
	});

	it('accepts an underscore in a registered slug', async () => {
		wordpressApiRequestMock.mockResolvedValue(workflowType);

		await expect(resolvePostType.call(context, 'bs_workflow')).resolves.toMatchObject({
			slug: 'bs_workflow',
		});
	});

	it.each(['BS_WORKFLOW', 'bs.workflow', 'bs~workflow'])(
		'rejects the invalid registered slug %s',
		async (slug) => {
			await expect(resolvePostType.call(context, slug)).rejects.toThrow(
				/selected post type isn't valid/,
			);
			expect(wordpressApiRequestMock).not.toHaveBeenCalled();
		},
	);

	it('rejects a registered slug over the official length limit', async () => {
		await expect(resolvePostType.call(context, 'a'.repeat(21))).rejects.toThrow(
			/selected post type isn't valid/,
		);
		expect(wordpressApiRequestMock).not.toHaveBeenCalled();
	});
});
