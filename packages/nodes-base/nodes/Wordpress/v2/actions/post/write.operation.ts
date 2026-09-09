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

const mapperDescription =
	'For taxonomy fields, enter a JSON array of term IDs, such as [12, 34]. Enter [] to remove all terms.';
const missingMapperParameter = Symbol('missingMapperParameter');

function getMapperParameterName(operation: WordpressWriteMode): string {
	return operation === 'create' ? 'createFieldsToSend' : 'updateFieldsToSend';
}

function getMetadataToggleName(operation: WordpressWriteMode): string {
	return operation === 'create' ? 'createSendMetadata' : 'updateSendMetadata';
}

function getMetadataParameterName(operation: WordpressWriteMode): string {
	return operation === 'create' ? 'createMetadata' : 'updateMetadata';
}

export function getWriteFieldsDescription(operation: WordpressWriteMode): INodeProperties[] {
	const toggleName = getMetadataToggleName(operation);
	return [
		{
			displayName: operation === 'create' ? 'Fields to send' : 'Fields to update',
			name: getMapperParameterName(operation),
			type: 'resourceMapper',
			default: { mappingMode: 'defineBelow', value: null },
			description: mapperDescription,
			noDataExpression: true,
			required: true,
			typeOptions: {
				loadOptionsDependsOn: ['postType.value', 'operation'],
				resourceMapper: {
					resourceMapperMethod: 'getContentFields',
					mode: 'add',
					valuesLabel: operation === 'create' ? 'Fields to send' : 'Fields to update',
					fieldWords: { singular: 'field', plural: 'fields' },
					addAllFields: false,
					supportAutoMap: false,
					allowEmptyValues: true,
				},
			},
			displayOptions: { show: { resource: ['post'], operation: [operation] } },
		},
		{
			displayName: 'Send Metadata',
			name: toggleName,
			type: 'boolean',
			default: false,
			noDataExpression: true,
			description: 'Whether to send registered metadata fields',
			displayOptions: { show: { resource: ['post'], operation: [operation] } },
		},
		{
			displayName: 'Metadata',
			name: getMetadataParameterName(operation),
			type: 'resourceMapper',
			default: { mappingMode: 'defineBelow', value: null },
			description: 'Select the registered metadata fields to send',
			noDataExpression: true,
			required: true,
			typeOptions: {
				loadOptionsDependsOn: ['postType.value', 'operation'],
				resourceMapper: {
					resourceMapperMethod: 'getMetadataFields',
					mode: 'add',
					valuesLabel: 'Metadata',
					fieldWords: { singular: 'metadata field', plural: 'metadata fields' },
					addAllFields: false,
					supportAutoMap: false,
					allowEmptyValues: true,
				},
			},
			displayOptions: {
				show: { resource: ['post'], operation: [operation], [toggleName]: [true] },
			},
		},
	];
}

function isDataObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUntouchedMapper(value: unknown): value is IDataObject {
	if (!isDataObject(value)) return false;
	const keys = Object.keys(value);
	return (
		keys.length === 2 &&
		keys.includes('mappingMode') &&
		keys.includes('value') &&
		value.mappingMode === 'defineBelow' &&
		value.value === null
	);
}

function parseMapperValue(
	context: IExecuteFunctions,
	itemIndex: number,
	parameter: string,
	mapper: unknown,
): Readonly<Record<string, unknown>> {
	if (!isDataObject(mapper)) {
		throw new NodeOperationError(
			context.getNode(),
			'The field mapping is invalid. Refresh the fields and try again.',
			{ itemIndex },
		);
	}
	const rawValue = mapper.value;
	if (rawValue === null || rawValue === undefined) return {};
	if (!isDataObject(rawValue)) {
		throw new NodeOperationError(
			context.getNode(),
			'The field values must be an object. Check the supplied values and try again.',
			{ itemIndex },
		);
	}
	if (mapper.mappingMode !== 'defineBelow') {
		throw new NodeOperationError(
			context.getNode(),
			"The field mapping mode isn't supported. Select fields manually and try again.",
			{ itemIndex },
		);
	}
	if (!Array.isArray(mapper.schema)) {
		throw new NodeOperationError(
			context.getNode(),
			'The field mapping schema is invalid. Refresh the fields and try again.',
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
				'The field mapping schema is invalid. Refresh the fields and try again.',
				{ itemIndex },
			);
		}
		fields.set(entry.id, entry.removed !== true);
	}
	const value: unknown = context.getNodeParameter(`${parameter}.value`, itemIndex);
	if (!isDataObject(value)) {
		throw new NodeOperationError(
			context.getNode(),
			'The field values must be an object. Check the supplied values and try again.',
			{ itemIndex },
		);
	}
	const selected: Record<string, unknown> = {};
	for (const [name, fieldValue] of Object.entries(value)) {
		if (!isSafeObjectProperty(name)) {
			throw new NodeOperationError(
				context.getNode(),
				'The field mapping contains an unsafe field name. Refresh the fields and try again.',
				{ itemIndex },
			);
		}
		const active = fields.get(name);
		if (active === undefined) {
			throw new NodeOperationError(
				context.getNode(),
				'The field mapping contains an unknown field. Refresh the fields and try again.',
				{ itemIndex },
			);
		}
		if (active) setSafeObjectProperty(selected, name, fieldValue);
	}
	return selected;
}

function getMapperValue(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: WordpressWriteMode,
): Readonly<Record<string, unknown>> {
	const parameter = getMapperParameterName(operation);
	const mapper: unknown = context.getNodeParameter(parameter, itemIndex, missingMapperParameter);
	return parseMapperValue(context, itemIndex, parameter, mapper);
}

function selectMapperValues(
	context: IExecuteFunctions,
	schema: WordpressContentSchema,
	values: Readonly<Record<string, unknown>>,
	itemIndex: number,
	kind: 'content' | 'metadata',
): Record<string, unknown> {
	const properties =
		kind === 'content'
			? schema.writableProperties.filter((property) => property.name !== 'meta')
			: schema.writableMetadata;
	const destinations = new Map(
		properties
			.filter((property) => !property.readOnly)
			.map((property) => [`${kind}:${property.name}`, property.name]),
	);
	const selected: Record<string, unknown> = {};
	for (const [id, value] of Object.entries(values)) {
		const name = destinations.get(id);
		if (name === undefined) {
			throw new NodeOperationError(
				context.getNode(),
				`The ${kind} mapping contains an unknown or stale field. Refresh the fields and try again.`,
				{ itemIndex },
			);
		}
		setSafeObjectProperty(selected, name, value);
	}
	return selected;
}

function getMetadataToggle(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: WordpressWriteMode,
): boolean {
	const name = getMetadataToggleName(operation);
	const value: unknown = context.getNodeParameter(name, itemIndex, false);
	if (typeof value !== 'boolean') {
		throw new NodeOperationError(
			context.getNode(),
			'The Send Metadata value is invalid. Select a valid value and try again.',
			{ itemIndex },
		);
	}
	return value;
}

function getConfiguredMetadataValues(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: WordpressWriteMode,
): Readonly<Record<string, unknown>> | undefined {
	const parameter = getMetadataParameterName(operation);
	const mapper: unknown = context.getNodeParameter(parameter, itemIndex, missingMapperParameter);
	if (mapper === missingMapperParameter || isUntouchedMapper(mapper)) return undefined;
	return parseMapperValue(context, itemIndex, parameter, mapper);
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
			const values = getMapperValue(context, itemIndex, mode);
			const fields = selectMapperValues(context, schema, values, itemIndex, 'content');
			const metadataToggle = getMetadataToggle(context, itemIndex, mode);
			let metadata: Record<string, unknown> = {};
			if (metadataToggle) {
				const configuredMetadata = getConfiguredMetadataValues(context, itemIndex, mode);
				if (configuredMetadata !== undefined) {
					metadata = selectMapperValues(context, schema, configuredMetadata, itemIndex, 'metadata');
				}
			}
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
