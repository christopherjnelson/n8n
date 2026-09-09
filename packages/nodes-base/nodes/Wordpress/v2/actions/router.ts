import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WordpressOperation } from './node.type';
import * as post from './post';
import { resolvePostType } from '../helpers/postTypes';

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const resource: unknown = this.getNodeParameter('resource', 0);
	const operation: unknown = this.getNodeParameter('operation', 0);
	if (resource !== 'post') {
		throw new NodeOperationError(
			this.getNode(),
			`The resource "${String(resource)}" isn't supported.`,
		);
	}
	if (operation !== 'get' && operation !== 'getMany') {
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
	return [await post[selectedOperation].execute.call(this, this.getInputData(), postType)];
}
