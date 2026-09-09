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

function toMapperField(
	property: WordpressContentProperty,
	id: string,
	displayName: string,
	required: boolean,
	removed: boolean,
): ResourceMapperField {
	return {
		id,
		displayName,
		required,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		removed,
		type: mapType(property.type),
		defaultValue: null,
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
	const contentFields = schema.writableProperties
		.filter((property) => property.name !== 'meta' && !property.readOnly)
		.map((property) =>
			toMapperField(
				property,
				`content:${property.name}`,
				property.name,
				isCreateOperation(this) && property.required,
				false,
			),
		);
	const metaRequired = schema.writableProperties.find(
		(property) => property.name === 'meta',
	)?.required;
	const metadataFields = schema.writableMetadata
		.filter((property) => !property.readOnly)
		.map((property) => {
			const required = isCreateOperation(this) && metaRequired === true && property.required;
			return toMapperField(
				property,
				`metadata:${property.name}`,
				`Metadata: ${property.name}`,
				required,
				!required,
			);
		});
	return { fields: [...contentFields, ...metadataFields] };
}
