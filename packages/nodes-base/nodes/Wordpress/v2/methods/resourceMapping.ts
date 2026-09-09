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

function toMapperField(property: WordpressContentProperty, required: boolean): ResourceMapperField {
	return {
		id: property.name,
		displayName: property.name,
		required,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		removed: true,
		type: mapType(property.type),
	};
}

async function getSchema(this: ILoadOptionsFunctions) {
	const slug: unknown = this.getNodeParameter('postType', undefined, { extractValue: true });
	if (typeof slug !== 'string' || slug.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Select a post type and try again.');
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
	return context.getNodeParameter('operation') === 'create';
}

export async function getContentFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const schema = await getSchema.call(this);
	const fields = schema.writableProperties
		.filter((property) => property.name !== 'meta' && !property.readOnly)
		.map((property) => toMapperField(property, isCreateOperation(this) && property.required));
	return { fields };
}

export async function getMetadataFields(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const schema = await getSchema.call(this);
	const metaRequired = schema.writableProperties.find(
		(property) => property.name === 'meta',
	)?.required;
	const fields = schema.writableMetadata
		.filter((property) => !property.readOnly)
		.map((property) =>
			toMapperField(
				property,
				isCreateOperation(this) && metaRequired === true && property.required,
			),
		);
	return {
		fields,
		...(fields.length === 0
			? {
					emptyFieldsNotice:
						'No registered metadata is available for this post type. Register REST metadata in WordPress, then refresh the fields.',
				}
			: {}),
	};
}
