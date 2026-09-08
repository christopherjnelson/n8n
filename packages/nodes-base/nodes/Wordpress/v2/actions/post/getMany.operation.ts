import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WordpressPostType } from '../../helpers/postTypes';
import { wordpressApiRequestWithResponse } from '../../transport';

// This bound prevents an untrusted pagination header from causing an excessive request loop.
const MAX_TOTAL_PAGES = 10_000;

export const description: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['post'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['post'], operation: ['getMany'], returnAll: [false] } },
	},
];

function parseLimit(context: IExecuteFunctions, itemIndex: number): number | undefined {
	const returnAll: unknown = context.getNodeParameter('returnAll', itemIndex);
	if (typeof returnAll !== 'boolean') {
		throw new NodeOperationError(
			context.getNode(),
			"The Return All value isn't valid. Select true or false and try again.",
			{ itemIndex },
		);
	}
	if (returnAll) return undefined;
	const limit: unknown = context.getNodeParameter('limit', itemIndex);
	if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
		throw new NodeOperationError(
			context.getNode(),
			"The limit isn't valid. Enter a positive whole number and try again.",
			{ itemIndex },
		);
	}
	return limit;
}

function isDataObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataObjectArray(value: unknown): value is IDataObject[] {
	return Array.isArray(value) && value.every(isDataObject);
}

function parseBody(context: IExecuteFunctions, body: unknown, itemIndex: number): IDataObject[] {
	if (!isDataObjectArray(body)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned an invalid item list. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	return body;
}

function parseTotalPages(context: IExecuteFunctions, headers: unknown, itemIndex: number): number {
	if (!isUnknownRecord(headers)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned invalid pagination headers. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	const value: unknown = Object.entries(headers).find(
		([name]) => name.toLowerCase() === 'x-wp-totalpages',
	)?.[1];
	if (value === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			"WordPress didn't return the total page count. Check the WordPress REST API configuration and try again.",
			{ itemIndex },
		);
	}
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned an invalid total page count. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	const totalPages = Number(value);
	if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned an invalid total page count. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	return totalPages;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
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
			const limit = parseLimit(this, itemIndex);
			const pageSize = limit === undefined ? 100 : Math.min(100, limit);
			const collected: IDataObject[] = [];
			let page = 1;
			let totalPages = 0;
			do {
				if (limit !== undefined && page > MAX_TOTAL_PAGES) {
					throw new NodeOperationError(
						this.getNode(),
						'WordPress pagination requires too many requests. Reduce Limit and try again.',
						{ itemIndex },
					);
				}
				const remaining = limit === undefined ? pageSize : limit - collected.length;
				const response = await wordpressApiRequestWithResponse.call(
					this,
					'GET',
					{ namespace: postType.restNamespace, base: postType.restBase },
					{ page, per_page: pageSize },
				);
				const pageItems = parseBody(this, response.body, itemIndex);
				totalPages = parseTotalPages(this, response.headers, itemIndex);
				if (limit === undefined && totalPages > MAX_TOTAL_PAGES) {
					throw new NodeOperationError(
						this.getNode(),
						'WordPress returned too many pages. Turn off Return All, set a finite Limit, and try again.',
						{ itemIndex },
					);
				}
				if (pageItems.length === 0 && totalPages > 0 && page <= totalPages) {
					throw new NodeOperationError(
						this.getNode(),
						'WordPress returned an empty page before pagination finished. Check the WordPress REST API configuration and try again.',
						{ itemIndex },
					);
				}
				collected.push.apply(collected, pageItems.slice(0, remaining));
				page++;
			} while ((limit === undefined || collected.length < limit) && page <= totalPages);

			for (const json of collected) {
				returnData.push({ json, pairedItem: { item: itemIndex } });
			}
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
