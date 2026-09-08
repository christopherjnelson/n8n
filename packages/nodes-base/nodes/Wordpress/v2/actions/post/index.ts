import type { INodeProperties } from 'n8n-workflow';

import * as get from './get.operation';
import * as getMany from './getMany.operation';

export { get, getMany };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['post'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get an item', description: 'Get one item by ID' },
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many items',
				description: 'Get items from the selected post type',
			},
		],
		default: 'get',
	},
	...get.description,
	...getMany.description,
];
