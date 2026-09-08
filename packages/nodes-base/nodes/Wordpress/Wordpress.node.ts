import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { WordpressV1 } from './v1/WordpressV1.node';

export class Wordpress extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Wordpress',
			name: 'wordpress',
			icon: 'file:wordpress.svg',
			group: ['output'],
			defaultVersion: 1,
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			description: 'Consume Wordpress API',
			usableAsTool: true,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new WordpressV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
