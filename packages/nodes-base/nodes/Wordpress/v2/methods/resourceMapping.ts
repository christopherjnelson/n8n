import type {
	FieldType,
	ILoadOptionsFunctions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { resolvePostType } from '../helpers/postTypes';
import { getContentSchema, type WordpressContentProperty } from '../helpers/schemas';

function mapType(type: WordpressContentProperty['type']): FieldType {
	if (type === 'integer') return 'number';
	return type;
}

function getOptionName(value: string | number | boolean): string {
	const text = String(value);
	return typeof value === 'string' ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function toMapperField(
	property: WordpressContentProperty,
	id: string,
	displayName: string,
	required: boolean,
	removed: boolean,
): ResourceMapperField {
	const usesOptions =
		property.enum !== undefined &&
		['string', 'integer', 'number', 'boolean'].includes(property.type);
	return {
		id,
		displayName,
		required,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		removed,
		type: usesOptions
			? 'options'
			: property.type === 'string' && property.format === 'date-time'
				? 'dateTime'
				: mapType(property.type),
		...(usesOptions
			? { options: property.enum?.map((value) => ({ name: getOptionName(value), value })) ?? [] }
			: {}),
	};
}

async function getSchema(this: ILoadOptionsFunctions) {
	const slug: unknown = this.getCurrentNodeParameter('postType', { extractValue: true });
	if (slug === undefined || slug === null || slug === '') return undefined;
	if (typeof slug !== 'string') {
		throw new NodeOperationError(this.getNode(), 'Select a valid post type and try again.');
	}
	const postType = await resolvePostType.call(this, slug);
	const schema = await getContentSchema.call(this, postType);
	if (!schema.canCreate) {
		throw new NodeOperationError(
			this.getNode(),
			"The selected post type doesn't have a writable REST schema. Check the WordPress permissions and post type REST settings, then try again.",
		);
	}
	return schema;
}

function isCreateOperation(context: ILoadOptionsFunctions): boolean {
	return context.getCurrentNodeParameter('operation') === 'create';
}

export async function getContentFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const schema = await getSchema.call(this);
	if (schema === undefined) return { fields: [] };
	const isCreate = isCreateOperation(this);
	const contentFields = schema.writableProperties
		.filter((property) => property.name !== 'meta' && !property.readOnly)
		.map((property) => {
			const required = isCreate && property.required;
			return toMapperField(
				property,
				`content:${property.name}`,
				property.name,
				required,
				!required,
			);
		});
	return { fields: contentFields };
}

export async function getMetadataFields(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const schema = await getSchema.call(this);
	if (schema === undefined) return { fields: [] };
	const metaRequired = schema.writableProperties.find(
		(property) => property.name === 'meta',
	)?.required;
	return {
		fields: schema.writableMetadata
			.filter((property) => !property.readOnly)
			.map((property) => {
				const required = isCreateOperation(this) && metaRequired === true && property.required;
				return toMapperField(
					property,
					`metadata:${property.name}`,
					property.name,
					required,
					!required,
				);
			}),
	};
}
