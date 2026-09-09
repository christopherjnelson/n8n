import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { userFields, userOperations } from '../../../v1/UserDescription';
import type { WordpressUserOperation } from '../node.type';
import { execute as executeUser } from './user.operation';

export const description: INodeProperties[] = [
	...userOperations,
	...userFields.filter((property) => !property.displayOptions?.show?.operation?.includes('delete')),
];

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	operation: WordpressUserOperation,
): Promise<INodeExecutionData[]> {
	return await executeUser.call(this, items, operation);
}
