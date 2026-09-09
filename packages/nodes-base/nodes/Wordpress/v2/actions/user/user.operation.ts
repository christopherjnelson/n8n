import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { WordpressUserOperation } from '../node.type';
import { wordpressApiRequest, wordpressApiRequestWithResponse } from '../../transport';

const MAX_TOTAL_PAGES = 10_000;

function isDataObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUser(context: IExecuteFunctions, value: unknown, itemIndex: number): IDataObject {
	if (!isDataObject(value)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned an invalid user. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	return value;
}

function parseUsers(context: IExecuteFunctions, value: unknown, itemIndex: number): IDataObject[] {
	if (!Array.isArray(value) || !value.every(isDataObject)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned an invalid user list. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	return value;
}

function getOptions(context: IExecuteFunctions, itemIndex: number): IDataObject {
	const value: unknown = context.getNodeParameter('options', itemIndex, {});
	if (!isDataObject(value)) {
		throw new NodeOperationError(context.getNode(), 'The Options value is invalid.', { itemIndex });
	}
	return value;
}

function getCollection(
	context: IExecuteFunctions,
	name: 'additionalFields' | 'updateFields',
	itemIndex: number,
): IDataObject {
	const value: unknown = context.getNodeParameter(name, itemIndex, {});
	if (!isDataObject(value)) {
		throw new NodeOperationError(context.getNode(), `The ${name} value is invalid.`, { itemIndex });
	}
	return value;
}

function getUserId(context: IExecuteFunctions, itemIndex: number): number {
	const value: unknown = context.getNodeParameter('userId', itemIndex);
	if (typeof value !== 'string' || !/^\d+$/.test(value)) {
		throw new NodeOperationError(
			context.getNode(),
			'The User ID must be a positive whole number.',
			{
				itemIndex,
			},
		);
	}
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new NodeOperationError(
			context.getNode(),
			'The User ID must be a positive whole number.',
			{
				itemIndex,
			},
		);
	}
	return id;
}

function addUserFields(body: IDataObject, fields: IDataObject): void {
	if (fields.name) body.name = fields.name as string;
	if (fields.firstName) body.first_name = fields.firstName as string;
	if (fields.lastName) body.last_name = fields.lastName as string;
	if (fields.email) body.email = fields.email as string;
	if (fields.password) body.password = fields.password as string;
	if (fields.username) body.username = fields.username as string;
	if (fields.url) body.url = fields.url as string;
	if (fields.description) body.description = fields.description as string;
	if (fields.nickname) body.nickname = fields.nickname as string;
	if (fields.slug) body.slug = fields.slug as string;
}

function parseTotalPages(context: IExecuteFunctions, headers: unknown, itemIndex: number): number {
	if (!isDataObject(headers)) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned invalid pagination headers. Check the WordPress REST API configuration and try again.',
			{ itemIndex },
		);
	}
	const value = Object.entries(headers).find(
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
	if (totalPages > MAX_TOTAL_PAGES) {
		throw new NodeOperationError(
			context.getNode(),
			'WordPress returned too many user pages. Turn off Return All, set a finite Limit, and try again.',
			{ itemIndex },
		);
	}
	return totalPages;
}

async function getAllUsers(
	context: IExecuteFunctions,
	itemIndex: number,
	query: IDataObject,
): Promise<IDataObject[]> {
	const returnAll: unknown = context.getNodeParameter('returnAll', itemIndex);
	if (typeof returnAll !== 'boolean') {
		throw new NodeOperationError(
			context.getNode(),
			"The Return All value isn't valid. Select true or false and try again.",
			{ itemIndex },
		);
	}
	if (!returnAll) {
		const limit: unknown = context.getNodeParameter('limit', itemIndex);
		if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
			throw new NodeOperationError(
				context.getNode(),
				"The limit isn't valid. Enter a whole number from 1 to 10 and try again.",
				{ itemIndex },
			);
		}
		query.per_page = limit;
		const response = await wordpressApiRequest.call(
			context,
			'GET',
			{ namespace: 'wp/v2', base: 'users' },
			undefined,
			query,
		);
		return parseUsers(context, response, itemIndex);
	}

	const users: IDataObject[] = [];
	query.per_page = 10;
	let page = 0;
	let totalPages = 0;
	do {
		page++;
		const response = await wordpressApiRequestWithResponse.call(
			context,
			'GET',
			{ namespace: 'wp/v2', base: 'users' },
			{ ...query, page },
		);
		const pageUsers = parseUsers(context, response.body, itemIndex);
		totalPages = parseTotalPages(context, response.headers, itemIndex);
		if (pageUsers.length === 0 && totalPages > 0 && page <= totalPages) {
			throw new NodeOperationError(
				context.getNode(),
				'WordPress returned an empty user page before pagination finished. Check the WordPress REST API configuration and try again.',
				{ itemIndex },
			);
		}
		users.push(...pageUsers);
	} while (totalPages > page);
	return users;
}

async function executeItem(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: WordpressUserOperation,
): Promise<IDataObject[]> {
	if (operation === 'create') {
		const body: IDataObject = {
			username: context.getNodeParameter('username', itemIndex) as string,
			name: context.getNodeParameter('name', itemIndex) as string,
			first_name: context.getNodeParameter('firstName', itemIndex) as string,
			last_name: context.getNodeParameter('lastName', itemIndex) as string,
			email: context.getNodeParameter('email', itemIndex) as string,
			password: context.getNodeParameter('password', itemIndex) as string,
		};
		addUserFields(body, getCollection(context, 'additionalFields', itemIndex));
		const response = await wordpressApiRequest.call(
			context,
			'POST',
			{ namespace: 'wp/v2', base: 'users' },
			body,
		);
		return [parseUser(context, response, itemIndex)];
	}

	if (operation === 'update') {
		const userId = getUserId(context, itemIndex);
		const body: IDataObject = { id: userId };
		addUserFields(body, getCollection(context, 'updateFields', itemIndex));
		const response = await wordpressApiRequest.call(
			context,
			'POST',
			{ namespace: 'wp/v2', base: 'users', suffix: [userId] },
			body,
		);
		return [parseUser(context, response, itemIndex)];
	}
	if (operation === 'get') {
		const userId = getUserId(context, itemIndex);
		const options = getOptions(context, itemIndex);
		const query: IDataObject = {};
		if (options.context) query.context = options.context;
		const response = await wordpressApiRequest.call(
			context,
			'GET',
			{ namespace: 'wp/v2', base: 'users', suffix: [userId] },
			undefined,
			query,
		);
		return [parseUser(context, response, itemIndex)];
	}

	const options = getOptions(context, itemIndex);
	const query: IDataObject = {};
	if (options.context) query.context = options.context;
	if (options.orderBy) query.orderby = options.orderBy;
	if (options.order) query.order = options.order;
	if (options.search) query.search = options.search;
	if (options.who) query.who = options.who;
	return await getAllUsers(context, itemIndex, query);
}

export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	operation: WordpressUserOperation,
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const response = await executeItem(this, itemIndex, operation);
			returnData.push(...response.map((json) => ({ json, pairedItem: { item: itemIndex } })));
		} catch (error) {
			if (!this.continueOnFail()) throw error;
			returnData.push({
				json: { error: error instanceof Error ? error.message : 'WordPress request failed.' },
				pairedItem: { item: itemIndex },
			});
		}
	}
	return returnData;
}
