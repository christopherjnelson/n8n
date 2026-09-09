import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { getPostTypes } from '../helpers/postTypes';

export async function searchPostTypes(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const normalizedFilter = filter?.trim().toLocaleLowerCase();
	const postTypes = await getPostTypes.call(this);

	return {
		results: postTypes
			.filter(
				(postType) =>
					!normalizedFilter ||
					postType.name.toLocaleLowerCase().includes(normalizedFilter) ||
					postType.slug.toLocaleLowerCase().includes(normalizedFilter),
			)
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((postType) => ({ name: postType.name, value: postType.slug })),
	};
}
