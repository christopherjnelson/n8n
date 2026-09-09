import type { IDataObject, INode } from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError, setSafeObjectProperty } from 'n8n-workflow';

import type { WordpressContentProperty, WordpressContentSchema } from './schemas';

export type WordpressWriteMode = 'create' | 'update';

export type WordpressRequestValues = {
	fields: Readonly<Record<string, unknown>>;
	metadata?: Readonly<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestBodyError(node: INode, detail: string): NodeOperationError {
	return new NodeOperationError(
		node,
		`The WordPress request ${detail}. Check the supplied fields and try again.`,
	);
}

function propertyMap(
	node: INode,
	properties: WordpressContentProperty[],
	kind: 'field' | 'metadata field',
): Map<string, WordpressContentProperty> {
	const result = new Map<string, WordpressContentProperty>();
	for (const property of properties) {
		if (!isSafeObjectProperty(property.name)) {
			throw requestBodyError(node, `schema contains an unsafe ${kind} name`);
		}
		result.set(property.name, property);
	}
	return result;
}

function validateValue(node: INode, property: WordpressContentProperty, value: unknown): void {
	if (value === null) {
		if (!property.nullable) {
			throw requestBodyError(node, `field "${property.name}" does not allow null`);
		}
		return;
	}

	let valid = false;
	switch (property.type) {
		case 'string':
			valid = typeof value === 'string';
			break;
		case 'boolean':
			valid = typeof value === 'boolean';
			break;
		case 'integer':
			valid = typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
			break;
		case 'number':
			valid = typeof value === 'number' && Number.isFinite(value);
			break;
		case 'array':
			valid = Array.isArray(value);
			break;
		case 'object':
			valid = typeof value === 'object' && value !== null && !Array.isArray(value);
			break;
	}

	if (!valid) {
		throw requestBodyError(node, `field "${property.name}" must have type ${property.type}`);
	}
}

function addSuppliedValues(
	node: INode,
	target: Record<string, unknown>,
	values: Readonly<Record<string, unknown>>,
	properties: Map<string, WordpressContentProperty>,
	kind: 'field' | 'metadata field',
): void {
	for (const [name, value] of Object.entries(values)) {
		if (!isSafeObjectProperty(name)) {
			throw requestBodyError(node, `contains an unsafe ${kind} name`);
		}
		const property = properties.get(name);
		if (property === undefined) {
			throw requestBodyError(node, `contains the unknown ${kind} "${name}"`);
		}
		if (property.readOnly) {
			throw requestBodyError(node, `contains the read-only ${kind} "${name}"`);
		}
		validateValue(node, property, value);
		setSafeObjectProperty(target, name, value);
	}
}

function validateRequiredValues(
	node: INode,
	values: Readonly<Record<string, unknown>>,
	properties: Map<string, WordpressContentProperty>,
	kind: 'field' | 'metadata field',
): void {
	for (const property of properties.values()) {
		if (property.required && !property.readOnly && !Object.hasOwn(values, property.name)) {
			throw requestBodyError(node, `is missing the required ${kind} "${property.name}"`);
		}
	}
}

export function buildWordpressRequestBody(
	node: INode,
	schema: WordpressContentSchema,
	mode: WordpressWriteMode,
	values: WordpressRequestValues,
): IDataObject {
	if (!isRecord(values)) {
		throw requestBodyError(node, 'values must be an object');
	}
	if (!isRecord(values.fields)) {
		throw requestBodyError(node, 'fields must be an object');
	}
	if (values.metadata !== undefined && !isRecord(values.metadata)) {
		throw requestBodyError(node, 'metadata must be an object');
	}

	const metaProperty = schema.writableProperties.find((property) => property.name === 'meta');
	const coreProperties = propertyMap(
		node,
		schema.writableProperties.filter((property) => property.name !== 'meta'),
		'field',
	);
	const metadataProperties = propertyMap(node, schema.writableMetadata, 'metadata field');
	const metadata = values.metadata;
	const hasMetadata = metadata !== undefined && Object.keys(metadata).length > 0;

	if (Object.hasOwn(values.fields, 'meta')) {
		throw requestBodyError(
			node,
			'contains the reserved field "meta". Supply registered metadata through metadata instead',
		);
	}
	if (hasMetadata && metaProperty?.readOnly) {
		throw requestBodyError(node, 'contains the read-only field "meta"');
	}

	if (mode === 'create') {
		validateRequiredValues(node, values.fields, coreProperties, 'field');
		if (metaProperty?.required && !hasMetadata) {
			throw requestBodyError(node, 'is missing the required field "meta"');
		}
		if (hasMetadata) {
			validateRequiredValues(node, metadata, metadataProperties, 'metadata field');
		}
	}

	const body: IDataObject = {};
	addSuppliedValues(node, body, values.fields, coreProperties, 'field');

	if (hasMetadata) {
		const metadataBody: IDataObject = {};
		addSuppliedValues(node, metadataBody, metadata, metadataProperties, 'metadata field');
		setSafeObjectProperty(body, 'meta', metadataBody);
	}

	return body;
}
