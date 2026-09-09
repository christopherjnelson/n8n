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
	for (const name of value) {
		if (!isSafeObjectProperty(name)) throw schemaError(node, 'an unsafe required-property name');
	}
	return new Set(value);
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
): WordpressContentProperty {
	if (!isSafeObjectProperty(name)) throw schemaError(node, 'an unsafe schema property name');
	if (!isRecord(value)) throw schemaError(node, 'an invalid schema property record');
	if (value.description !== undefined && typeof value.description !== 'string') {
		throw schemaError(node, 'an invalid schema property description');
	}
	if (value.readonly !== undefined && typeof value.readonly !== 'boolean') {
		throw schemaError(node, 'an invalid schema property read-only flag');
	}
	const parsedType = parseType(node, value.type);
	const hasNestedRequired = parsedType.type === 'object' && Array.isArray(value.required);
	if (hasNestedRequired) parseRequired(node, value.required);
	if (value.required !== undefined && typeof value.required !== 'boolean' && !hasNestedRequired) {
		throw schemaError(node, 'an invalid schema property required flag');
	}
	const required = value.required === true || topLevelRequired.has(name);
	return {
		name,
		...(value.description === undefined ? {} : { description: value.description }),
		...parsedType,
		readOnly: value.readonly === true,
		required,
	};
}

function parseProperties(
	node: INode,
	value: unknown,
	topLevelRequired: Set<string>,
): WordpressContentProperty[] {
	if (!isRecord(value)) throw schemaError(node, 'invalid schema properties');
	return Object.entries(value).map(([name, property]) =>
		parseProperty(node, name, property, topLevelRequired),
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
	return Object.entries(meta.properties).map(([name, property]) =>
		parseProperty(node, name, property, required),
	);
}

type WritableSchema = Pick<WordpressContentSchema, 'writableProperties' | 'writableMetadata'>;

function parseWritableSchema(node: INode, args: unknown): WritableSchema {
	if (!isRecord(args)) throw schemaError(node, 'a POST endpoint with invalid arguments');
	const writableProperties = parseProperties(node, args, new Set());

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
