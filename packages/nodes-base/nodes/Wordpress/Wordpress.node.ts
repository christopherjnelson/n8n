import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { WordpressV1 } from './v1/WordpressV1.node';
import { WordpressV2 } from './v2/WordpressV2.node';

export class Wordpress extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Wordpress',
			name: 'wordpress',
			icon: 'file:wordpress.svg',
			group: ['output'],
			defaultVersion: 2,
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			description: 'Consume Wordpress API',
			usableAsTool: true,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new WordpressV1(baseDescription),
			2: new WordpressV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
