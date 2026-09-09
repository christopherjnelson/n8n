/* eslint-disable n8n-nodes-base/node-filename-against-convention */
import { NodeConnectionTypes, type INodeTypeDescription } from 'n8n-workflow';

import * as post from './post';

export const versionDescription: INodeTypeDescription = {
	displayName: 'WordPress',
	name: 'wordpress',
	icon: 'file:wordpress.svg',
	group: ['output'],
	version: 2,
	subtitle: '={{ $parameter["postType"].value }}',
	description: 'Consume the WordPress API',
	defaults: { name: 'WordPress' },
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	credentials: [
		{
			name: 'wordpressApi',
			required: true,
			displayOptions: { show: { authType: ['basicAuth'] } },
		},
		{
			name: 'wordpressOAuth2Api',
			required: true,
			displayOptions: { show: { authType: ['oAuth2'] } },
		},
	],
	properties: [
		{
			displayName: 'Authentication',
			name: 'authType',
			type: 'options',
			options: [
				{ name: 'Basic Auth', value: 'basicAuth' },
				{ name: 'OAuth2 (WordPress.com)', value: 'oAuth2' },
			],
			default: 'basicAuth',
			description: 'Authentication method to use',
		},
		{
			displayName: 'Resource',
			name: 'resource',
			type: 'options',
			noDataExpression: true,
			options: [{ name: 'Content', value: 'post' }],
			default: 'post',
		},
		{
			displayName: 'Post Type',
			name: 'postType',
			type: 'resourceLocator',
			default: { mode: 'list', value: '' },
			required: true,
			noDataExpression: true,
			description: 'Post type to use',
			displayOptions: { show: { resource: ['post'] } },
			modes: [
				{
					displayName: 'From list',
					name: 'list',
					type: 'list',
					placeholder: 'Select a post type',
					typeOptions: { searchListMethod: 'searchPostTypes', searchable: true },
				},
				{
					displayName: 'By slug',
					name: 'slug',
					type: 'string',
					placeholder: 'post',
					validation: [
						{
							type: 'regex',
							properties: {
								regex: '[a-z0-9_-]+',
								errorMessage: 'Enter a registered post type slug',
							},
						},
					],
				},
			],
		},
		...post.description,
	],
};
