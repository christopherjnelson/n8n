import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError, setSafeObjectProperty } from 'n8n-workflow';

import type { WordpressPostType } from '../../helpers/postTypes';
import { buildWordpressRequestBody, type WordpressWriteMode } from '../../helpers/requestBody';
import type { WordpressContentSchema } from '../../helpers/schemas';
import { wordpressApiRequest } from '../../transport';

export function getWriteFieldsDescription(operation: WordpressWriteMode): INodeProperties[] {
	const mapper = (
		name: 'fieldsToSend' | 'metadata',
		displayName: string,
		method: string,
	): INodeProperties => ({
		displayName,
		name,
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		noDataExpression: true,
		required: name === 'fieldsToSend',
		typeOptions: {
			loadOptionsDependsOn: ['postType.value', 'operation'],
			resourceMapper: {
				resourceMapperMethod: method,
				mode: 'add',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: false,
				supportAutoMap: false,
				allowEmptyValues: true,
			},
		},
		displayOptions: { show: { resource: ['post'], operation: [operation] } },
	});

	return [
		mapper('fieldsToSend', 'Fields to send', 'getContentFields'),
		mapper('metadata', 'Metadata', 'getMetadataFields'),
	];
}

function isDataObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMapperValue(
	context: IExecuteFunctions,
	parameter: 'fieldsToSend' | 'metadata',
	itemIndex: number,
): Readonly<Record<string, unknown>> {
	const mapper: unknown = context.getNodeParameter(parameter, itemIndex, {});
	if (!isDataObject(mapper)) {
		throw new NodeOperationError(
			context.getNode(),
			`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping is invalid. Refresh the fields and try again.`,
			{ itemIndex },
		);
	}
	const rawValue = mapper.value;
	if (rawValue === null || rawValue === undefined) return {};
	if (!isDataObject(rawValue)) {
		throw new NodeOperationError(
			context.getNode(),
			`The ${parameter === 'metadata' ? 'metadata' : 'field'} values must be an object. Check the supplied values and try again.`,
			{ itemIndex },
		);
	}
	if (mapper.mappingMode !== 'defineBelow') {
		throw new NodeOperationError(
			context.getNode(),
			`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping mode isn't supported. Select fields manually and try again.`,
			{ itemIndex },
		);
	}
	if (!Array.isArray(mapper.schema)) {
		throw new NodeOperationError(
			context.getNode(),
			`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping schema is invalid. Refresh the fields and try again.`,
			{ itemIndex },
		);
	}
	const fields = new Map<string, boolean>();
	for (const entry of mapper.schema) {
		if (
			!isDataObject(entry) ||
			typeof entry.id !== 'string' ||
			!isSafeObjectProperty(entry.id) ||
			(entry.removed !== undefined && typeof entry.removed !== 'boolean') ||
			fields.has(entry.id)
		) {
			throw new NodeOperationError(
				context.getNode(),
				`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping schema is invalid. Refresh the fields and try again.`,
				{ itemIndex },
			);
		}
		fields.set(entry.id, entry.removed !== true);
	}
	const value: unknown = context.getNodeParameter(`${parameter}.value`, itemIndex);
	if (!isDataObject(value)) {
		throw new NodeOperationError(
			context.getNode(),
			`The ${parameter === 'metadata' ? 'metadata' : 'field'} values must be an object. Check the supplied values and try again.`,
			{ itemIndex },
		);
	}
	const selected: Record<string, unknown> = {};
	for (const [name, fieldValue] of Object.entries(value)) {
		if (!isSafeObjectProperty(name)) {
			throw new NodeOperationError(
				context.getNode(),
				`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping contains an unsafe field name. Refresh the fields and try again.`,
				{ itemIndex },
			);
		}
		const active = fields.get(name);
		if (active === undefined) {
			throw new NodeOperationError(
				context.getNode(),
				`The ${parameter === 'metadata' ? 'metadata' : 'field'} mapping contains an unknown field. Refresh the fields and try again.`,
				{ itemIndex },
			);
		}
		if (active) setSafeObjectProperty(selected, name, fieldValue);
	}
	return selected;
}

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

export async function executeWrite(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
	postType: WordpressPostType,
	schema: WordpressContentSchema,
	mode: WordpressWriteMode,
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];
	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const fields = getMapperValue(context, 'fieldsToSend', itemIndex);
			const metadata = getMapperValue(context, 'metadata', itemIndex);
			const body = buildWordpressRequestBody(context.getNode(), schema, mode, {
				fields,
				...(Object.keys(metadata).length > 0 ? { metadata } : {}),
			});
			const response = await wordpressApiRequest.call(
				context,
				'POST',
				{
					namespace: postType.restNamespace,
					base: postType.restBase,
					...(mode === 'update' ? { suffix: [getItemId(context, itemIndex)] } : {}),
				},
				body,
			);
			if (!isDataObject(response)) {
				throw new NodeOperationError(
					context.getNode(),
					'WordPress returned an invalid item. Check the WordPress REST API configuration and try again.',
					{ itemIndex },
				);
			}
			returnData.push({ json: response, pairedItem: { item: itemIndex } });
		} catch (error) {
			if (!context.continueOnFail()) throw error;
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
