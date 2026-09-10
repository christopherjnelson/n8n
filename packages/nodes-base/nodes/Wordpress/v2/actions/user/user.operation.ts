import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError, setSafeObjectProperty } from 'n8n-workflow';

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

function getRequiredString(context: IExecuteFunctions, name: string, itemIndex: number): string {
	const value: unknown = context.getNodeParameter(name, itemIndex);
	if (typeof value !== 'string') {
		throw new NodeOperationError(context.getNode(), `The ${name} value must be text.`, {
			itemIndex,
		});
	}
	return value;
}

function addUserFields(
	context: IExecuteFunctions,
	body: IDataObject,
	fields: IDataObject,
	itemIndex: number,
): void {
	const mappings = new Map([
		['name', 'name'],
		['firstName', 'first_name'],
		['lastName', 'last_name'],
		['email', 'email'],
		['password', 'password'],
		['username', 'username'],
		['url', 'url'],
		['description', 'description'],
		['nickname', 'nickname'],
		['slug', 'slug'],
	]);
	for (const [source, destination] of mappings) {
		const value = fields[source];
		if (value === undefined || value === '') continue;
		if (typeof value !== 'string') {
			throw new NodeOperationError(context.getNode(), `The ${source} value must be text.`, {
				itemIndex,
			});
		}
		setSafeObjectProperty(body, destination, value);
	}
}

function addOptionalQueryString(
	context: IExecuteFunctions,
	query: IDataObject,
	options: IDataObject,
	source: string,
	destination: string,
	itemIndex: number,
): void {
	const value = options[source];
	if (value === undefined || value === '') return;
	if (typeof value !== 'string') {
		throw new NodeOperationError(context.getNode(), `The ${source} option must be text.`, {
			itemIndex,
		});
	}
	setSafeObjectProperty(query, destination, value);
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
			username: getRequiredString(context, 'username', itemIndex),
			name: getRequiredString(context, 'name', itemIndex),
			first_name: getRequiredString(context, 'firstName', itemIndex),
			last_name: getRequiredString(context, 'lastName', itemIndex),
			email: getRequiredString(context, 'email', itemIndex),
			password: getRequiredString(context, 'password', itemIndex),
		};
		addUserFields(context, body, getCollection(context, 'additionalFields', itemIndex), itemIndex);
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
		addUserFields(context, body, getCollection(context, 'updateFields', itemIndex), itemIndex);
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
		addOptionalQueryString(context, query, options, 'context', 'context', itemIndex);
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
	addOptionalQueryString(context, query, options, 'context', 'context', itemIndex);
	addOptionalQueryString(context, query, options, 'orderBy', 'orderby', itemIndex);
	addOptionalQueryString(context, query, options, 'order', 'order', itemIndex);
	addOptionalQueryString(context, query, options, 'search', 'search', itemIndex);
	addOptionalQueryString(context, query, options, 'who', 'who', itemIndex);
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
