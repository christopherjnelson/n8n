import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WordpressOperation } from './node.type';
import * as post from './post';
import { resolvePostType } from '../helpers/postTypes';
import { getContentSchema } from '../helpers/schemas';

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const resource: unknown = this.getNodeParameter('resource', 0);
	const operation: unknown = this.getNodeParameter('operation', 0);
	if (resource !== 'post') {
		throw new NodeOperationError(
			this.getNode(),
			`The resource "${String(resource)}" isn't supported.`,
		);
	}
	if (
		operation !== 'create' &&
		operation !== 'get' &&
		operation !== 'getMany' &&
		operation !== 'update'
	) {
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${String(operation)}" isn't supported.`,
		);
	}
	const registeredSlug: unknown = this.getNodeParameter('postType', 0, undefined, {
		extractValue: true,
	});
	if (typeof registeredSlug !== 'string') {
		throw new NodeOperationError(this.getNode(), 'Select a post type and try again.');
	}

	// Discovery is shared by all input items, so a failure stops the execution.
	const postType = await resolvePostType.call(this, registeredSlug);
	const selectedOperation: WordpressOperation = operation;
	if (selectedOperation === 'create' || selectedOperation === 'update') {
		const schema = await getContentSchema.call(this, postType);
		if (!schema.canCreate) {
			throw new NodeOperationError(
				this.getNode(),
				"The selected post type doesn't have a writable REST schema. Check the WordPress permissions and post type REST settings, then try again.",
			);
		}
		return [
			await post[selectedOperation].execute.call(this, this.getInputData(), postType, schema),
		];
	}
	return [await post[selectedOperation].execute.call(this, this.getInputData(), postType)];
}
