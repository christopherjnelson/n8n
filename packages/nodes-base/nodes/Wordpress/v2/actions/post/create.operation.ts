import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { executeWrite, getWriteFieldsDescription } from './write.operation';
import type { WordpressPostType } from '../../helpers/postTypes';
import type { WordpressContentSchema } from '../../helpers/schemas';

export const description: INodeProperties[] = getWriteFieldsDescription('create');

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	postType: WordpressPostType,
	schema: WordpressContentSchema,
): Promise<INodeExecutionData[]> {
	return await executeWrite(this, items, postType, schema, 'create');
}
