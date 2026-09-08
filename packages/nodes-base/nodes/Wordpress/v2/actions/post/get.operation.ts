import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WordpressPostType } from '../../helpers/postTypes';
import { wordpressApiRequest } from '../../transport';

export const description: INodeProperties[] = [
	{
		displayName: 'ID',
		name: 'itemId',
		type: 'number',
		required: true,
		default: 0,
		typeOptions: { minValue: 1 },
		description: 'ID of the item to get',
		displayOptions: { show: { resource: ['post'], operation: ['get'] } },
	},
];

function getItemId(context: IExecuteFunctions, itemIndex: number): number {
	const value: unknown = context.getNodeParameter('itemId', itemIndex);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new NodeOperationError(
			context.getNode(),
			"The item ID isn't valid. Enter a positive whole number and try again.",
			{ itemIndex },
		);
	}
	return value;
}

function isDataObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	postType: WordpressPostType,
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const response = await wordpressApiRequest.call(this, 'GET', {
				namespace: postType.restNamespace,
				base: postType.restBase,
				suffix: [getItemId(this, itemIndex)],
			});
			if (!isDataObject(response)) {
				throw new NodeOperationError(
					this.getNode(),
					'WordPress returned an invalid item. Check the WordPress REST API configuration and try again.',
					{ itemIndex },
				);
			}
			returnData.push({ json: response, pairedItem: { item: itemIndex } });
		} catch (error) {
			if (!this.continueOnFail()) throw error;
			returnData.push({
				json: {
					error:
						error instanceof Error
							? error.message
							: 'WordPress request failed. Check the node configuration and try again.',
				},
				pairedItem: { item: itemIndex },
			});
		}
	}
	return returnData;
}
