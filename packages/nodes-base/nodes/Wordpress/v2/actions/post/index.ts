import type { INodeProperties } from 'n8n-workflow';

import * as create from './create.operation';
import * as get from './get.operation';
import * as getMany from './getMany.operation';
import * as update from './update.operation';

export { create, get, getMany, update };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['post'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create content',
				description: 'Create content in the selected post type',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get content',
				description: 'Get content by ID from the selected post type',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many content items',
				description: 'Get content items from the selected post type',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update content',
				description: 'Update content in the selected post type',
			},
		],
		default: 'create',
	},
	...create.description,
	...get.description,
	...getMany.description,
	...update.description,
];
