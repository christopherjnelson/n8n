import type {
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INode,
} from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError } from 'n8n-workflow';

import { wordpressApiRequest } from '../transport';
import type { WordpressPostType } from './postTypes';

type WordpressFunctions = IExecuteFunctions | ILoadOptionsFunctions;

export type WordpressSchemaValueType =
	| 'string'
	| 'boolean'
	| 'integer'
	| 'number'
	| 'array'
	| 'object';

export type WordpressContentProperty = {
	name: string;
	description?: string;
	type: WordpressSchemaValueType;
	itemType?: WordpressSchemaValueType;
	enum?: Array<string | number | boolean>;
	format?: string;
	properties?: Array<{
		name: string;
		type: WordpressSchemaValueType;
		required: boolean;
		readOnly: boolean;
	}>;
	nullable: boolean;
	readOnly: boolean;
	required: boolean;
};

export type WordpressMetadataProperty = WordpressContentProperty;

export type WordpressContentSchema = {
	canCreate: boolean;
	canRead: boolean;
	writableProperties: WordpressContentProperty[];
	writableMetadata: WordpressMetadataProperty[];
};

const supportedTypes: readonly WordpressSchemaValueType[] = [
	'string',
	'boolean',
	'integer',
	'number',
	'array',
	'object',
];

const coreRawStringFields = new Set(['title', 'content', 'excerpt']);
const MAX_SCHEMA_PROPERTIES = 200;
const MAX_ENUM_VALUES = 100;
const MAX_FIELD_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_SCHEMA_VALUE_LENGTH = 500;
const MAX_ENDPOINTS = 20;
const MAX_METHODS = 20;

function isSupportedType(value: string): value is WordpressSchemaValueType {
	return supportedTypes.some((type) => type === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

function schemaError(node: INode, detail: string): NodeOperationError {
	return new NodeOperationError(
		node,
		`WordPress returned ${detail}. Check the post type REST schema and try again.`,
	);
}

function parseRequired(node: INode, value: unknown): Set<string> {
	if (value === undefined) return new Set();
	if (!isStringArray(value)) {
		throw schemaError(node, 'an invalid required-property list');
	}
	if (value.length > MAX_SCHEMA_PROPERTIES) {
		throw schemaError(node, 'an oversized required-property list');
	}
	for (const name of value) {
		if (!isSafeObjectProperty(name) || name.length > MAX_FIELD_NAME_LENGTH) {
			throw schemaError(node, 'an unsafe or oversized required-property name');
		}
	}
	return new Set(value);
}

function parseDescription(node: INode, value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.length > MAX_DESCRIPTION_LENGTH) {
		throw schemaError(node, 'an invalid schema property description');
	}
	return value;
}

function parseEnum(
	node: INode,
	value: unknown,
): Array<string | number | boolean | null> | undefined {
	if (value === undefined) return undefined;
	const values: unknown[] = Array.isArray(value) ? value : [];
	if (
		!Array.isArray(value) ||
		values.length > MAX_ENUM_VALUES ||
		!values.every((entry): entry is string | number | boolean | null =>
			typeof entry === 'string'
				? entry.length <= MAX_SCHEMA_VALUE_LENGTH
				: (typeof entry === 'number' && Number.isFinite(entry)) ||
					typeof entry === 'boolean' ||
					entry === null,
		)
	) {
		throw schemaError(node, 'an invalid schema property enum');
	}
	return values;
}

function parseType(
	node: INode,
	value: unknown,
): { type: WordpressSchemaValueType; nullable: boolean } {
	const values: unknown[] = Array.isArray(value) ? value : [value];
	if (values.length === 0 || !isStringArray(values)) {
		throw schemaError(node, 'a schema property with a missing or invalid type');
	}
	const nullable = values.includes('null');
	const nonNull = values.filter((entry) => entry !== 'null');
	const type = nonNull[0];
	if (nonNull.length !== 1 || type === undefined || !isSupportedType(type)) {
		throw schemaError(
			node,
			'an unsupported or ambiguous property type. Update its registered schema to use one supported value type',
		);
	}
	return { type, nullable };
}

function parseProperty(
	node: INode,
	name: string,
	value: unknown,
	topLevelRequired: Set<string>,
	normalizeCoreEnvelope = false,
): WordpressContentProperty {
	if (!isSafeObjectProperty(name) || name.length > MAX_FIELD_NAME_LENGTH) {
		throw schemaError(node, 'an unsafe or oversized schema property name');
	}
	if (!isRecord(value)) throw schemaError(node, 'an invalid schema property record');
	const description = parseDescription(node, value.description);
	if (value.readonly !== undefined && typeof value.readonly !== 'boolean') {
		throw schemaError(node, 'an invalid schema property read-only flag');
	}
	let parsedType = parseType(node, value.type);
	if (
		normalizeCoreEnvelope &&
		coreRawStringFields.has(name) &&
		parsedType.type === 'object' &&
		isRecord(value.properties)
	) {
		const raw = value.properties.raw;
		const rendered = value.properties.rendered;
		if (isRecord(raw) && raw.readonly !== undefined && typeof raw.readonly !== 'boolean') {
			throw schemaError(node, 'an invalid core raw property read-only flag');
		}
		if (
			isRecord(raw) &&
			parseType(node, raw.type).type === 'string' &&
			raw.readonly !== true &&
			isRecord(rendered) &&
			parseType(node, rendered.type).type === 'string' &&
			rendered.readonly === true
		) {
			parsedType = { type: 'string', nullable: parsedType.nullable };
		}
	}
	const hasNestedRequired = parsedType.type === 'object' && Array.isArray(value.required);
	const nestedRequired = hasNestedRequired
		? parseRequired(node, value.required)
		: new Set<string>();
	if (value.required !== undefined && typeof value.required !== 'boolean' && !hasNestedRequired) {
		throw schemaError(node, 'an invalid schema property required flag');
	}
	const required = value.required === true || topLevelRequired.has(name);
	const parsedEnum = parseEnum(node, value.enum);
	const enumValues =
		parsedEnum?.filter((entry): entry is string | number | boolean => entry !== null) ?? [];
	if (
		parsedEnum !== undefined &&
		((parsedType.type === 'string' && enumValues.some((entry) => typeof entry !== 'string')) ||
			(parsedType.type === 'integer' &&
				enumValues.some((entry) => typeof entry !== 'number' || !Number.isInteger(entry))) ||
			(parsedType.type === 'number' && enumValues.some((entry) => typeof entry !== 'number')) ||
			(parsedType.type === 'boolean' && enumValues.some((entry) => typeof entry !== 'boolean')) ||
			parsedType.type === 'array' ||
			parsedType.type === 'object' ||
			parsedEnum.some((entry) => entry === null && !parsedType.nullable))
	) {
		throw schemaError(node, 'an enum that does not match its property type');
	}
	let itemType: WordpressContentProperty['itemType'];
	if (parsedType.type === 'array' && value.items !== undefined) {
		if (!isRecord(value.items)) throw schemaError(node, 'invalid schema array items');
		const parsedItem = parseType(node, value.items.type);
		itemType = parsedItem.type;
	}
	let properties: WordpressContentProperty['properties'];
	if (parsedType.type === 'object' && name !== 'meta' && value.properties !== undefined) {
		if (Array.isArray(value.properties)) {
			if (value.properties.length > 0) throw schemaError(node, 'invalid nested schema properties');
			properties = [];
		} else {
			if (!isRecord(value.properties)) throw schemaError(node, 'invalid nested schema properties');
			const entries = Object.entries(value.properties);
			if (entries.length > MAX_SCHEMA_PROPERTIES) {
				throw schemaError(node, 'oversized nested schema properties');
			}
			properties = entries.map(([childName, child]) => {
				if (!isSafeObjectProperty(childName) || childName.length > MAX_FIELD_NAME_LENGTH) {
					throw schemaError(node, 'an unsafe nested property name');
				}
				if (!isRecord(child)) throw schemaError(node, 'an invalid nested property record');
				if (child.readonly !== undefined && typeof child.readonly !== 'boolean') {
					throw schemaError(node, 'an invalid nested property read-only flag');
				}
				const childType = parseType(node, child.type).type;
				return {
					name: childName,
					type: childType,
					required: nestedRequired.has(childName),
					readOnly: child.readonly === true,
				};
			});
		}
	}
	if (
		value.format !== undefined &&
		(typeof value.format !== 'string' || value.format.length > MAX_SCHEMA_VALUE_LENGTH)
	) {
		throw schemaError(node, 'an invalid schema property format');
	}
	return {
		name,
		...(description === undefined ? {} : { description }),
		...parsedType,
		...(itemType === undefined ? {} : { itemType }),
		...(enumValues.length === 0 ? {} : { enum: enumValues }),
		...(value.format === undefined ? {} : { format: value.format }),
		...(properties === undefined ? {} : { properties }),
		readOnly: value.readonly === true,
		required,
	};
}

function parseProperties(
	node: INode,
	value: unknown,
	topLevelRequired: Set<string>,
	normalizeCoreEnvelopes = false,
): WordpressContentProperty[] {
	if (!isRecord(value)) throw schemaError(node, 'invalid schema properties');
	if (Object.keys(value).length > MAX_SCHEMA_PROPERTIES) {
		throw schemaError(node, 'oversized schema properties');
	}
	return Object.entries(value).map(([name, property]) =>
		parseProperty(node, name, property, topLevelRequired, normalizeCoreEnvelopes),
	);
}

function parseMetadata(
	node: INode,
	properties: Record<string, unknown>,
): WordpressMetadataProperty[] {
	const meta = properties.meta;
	if (meta === undefined) return [];
	if (!isRecord(meta)) throw schemaError(node, 'an invalid metadata property record');
	const metaType = parseType(node, meta.type);
	if (metaType.type !== 'object') {
		throw schemaError(node, 'a metadata container that is not an object');
	}
	const required =
		meta.required === undefined || typeof meta.required === 'boolean'
			? new Set<string>()
			: parseRequired(node, meta.required);
	if (meta.properties === undefined) return [];
	if (Array.isArray(meta.properties)) {
		if (meta.properties.length === 0) return [];
		throw schemaError(node, 'invalid metadata properties');
	}
	if (!isRecord(meta.properties)) throw schemaError(node, 'invalid metadata properties');
	if (Object.keys(meta.properties).length > MAX_SCHEMA_PROPERTIES) {
		throw schemaError(node, 'oversized metadata properties');
	}
	return Object.entries(meta.properties).map(([name, property]) =>
		parseProperty(node, name, property, required),
	);
}

type WritableSchema = Pick<WordpressContentSchema, 'writableProperties' | 'writableMetadata'>;

function parseWritableSchema(node: INode, args: unknown): WritableSchema {
	if (!isRecord(args)) throw schemaError(node, 'a POST endpoint with invalid arguments');
	const writableProperties = parseProperties(node, args, new Set(), true);

	return {
		writableProperties,
		writableMetadata: parseMetadata(node, args),
	};
}

function writableSchemasMatch(left: WritableSchema, right: WritableSchema): boolean {
	const sortProperties = (properties: WordpressContentProperty[]) =>
		[...properties].sort((a, b) => a.name.localeCompare(b.name));
	return (
		JSON.stringify(sortProperties(left.writableProperties)) ===
			JSON.stringify(sortProperties(right.writableProperties)) &&
		JSON.stringify(sortProperties(left.writableMetadata)) ===
			JSON.stringify(sortProperties(right.writableMetadata))
	);
}

function parseMethods(node: INode, value: unknown, field: string): string[] {
	if (!isStringArray(value)) {
		throw schemaError(node, `an invalid ${field}`);
	}
	if (value.length > MAX_METHODS) throw schemaError(node, `an oversized ${field}`);
	return value;
}

export function parseContentSchema(
	node: INode,
	payload: unknown,
	postType: WordpressPostType,
): WordpressContentSchema {
	if (!isRecord(payload)) throw schemaError(node, 'an invalid OPTIONS response');
	if (payload.namespace !== postType.restNamespace) {
		throw schemaError(node, "an OPTIONS namespace that doesn't match the selected post type");
	}
	const methods = parseMethods(node, payload.methods, 'route method list');
	if (!Array.isArray(payload.endpoints)) throw schemaError(node, 'an invalid endpoint list');
	if (payload.endpoints.length > MAX_ENDPOINTS)
		throw schemaError(node, 'an oversized endpoint list');
	const endpointMethods: string[] = [];
	const postSchemas: WritableSchema[] = [];
	for (const endpoint of payload.endpoints) {
		if (!isRecord(endpoint)) throw schemaError(node, 'an invalid endpoint record');
		const methods = parseMethods(node, endpoint.methods, 'endpoint method list');
		for (const method of methods) endpointMethods.push(method);
		if (methods.includes('POST')) postSchemas.push(parseWritableSchema(node, endpoint.args));
	}
	if (!isRecord(payload.schema)) throw schemaError(node, 'a missing or invalid resource schema');
	if (payload.schema.type !== 'object') {
		throw schemaError(node, 'a resource schema that is not an object');
	}
	const schemaProperties = payload.schema.properties;
	if (!isRecord(schemaProperties)) throw schemaError(node, 'invalid schema properties');
	const resourceRequired = parseRequired(node, payload.schema.required);
	parseProperties(node, schemaProperties, resourceRequired);
	parseMetadata(node, schemaProperties);

	const writableSchema = postSchemas[0] ?? {
		writableProperties: [],
		writableMetadata: [],
	};
	if (postSchemas.some((schema) => !writableSchemasMatch(writableSchema, schema))) {
		throw schemaError(node, 'conflicting POST endpoint argument schemas');
	}

	return {
		canCreate: methods.includes('POST') && postSchemas.length > 0,
		canRead: methods.includes('GET') && endpointMethods.includes('GET'),
		...writableSchema,
	};
}

export async function getContentSchema(
	this: WordpressFunctions,
	postType: WordpressPostType,
): Promise<WordpressContentSchema> {
	// The request runtime supports OPTIONS, but the legacy shared method type omits it.
	const response = await wordpressApiRequest.call(this, 'OPTIONS' as IHttpRequestMethods, {
		namespace: postType.restNamespace,
		base: postType.restBase,
	});
	return parseContentSchema(this.getNode(), response, postType);
}
