import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { buildRestPath } from '../../v2/helpers';

const node = { name: 'WordPress' } as INode;

describe('WordPress v2 REST routes', () => {
	it('builds collection and item paths from structured route data', () => {
		expect(buildRestPath(node, { namespace: 'wp/v2', base: 'workflows' })).toBe('/wp/v2/workflows');
		expect(
			buildRestPath(node, { namespace: 'acme/v1', base: 'content/workflows', suffix: [42] }),
		).toBe('/acme/v1/content/workflows/42');
	});

	it.each([
		['scheme', { namespace: 'https://evil.example', base: 'posts' }],
		['host', { namespace: '//evil.example', base: 'posts' }],
		['query', { namespace: 'wp/v2', base: 'posts?context=edit' }],
		['fragment', { namespace: 'wp/v2', base: 'posts#section' }],
		['traversal', { namespace: 'wp/v2', base: '../posts' }],
		['backslash', { namespace: 'wp/v2', base: 'content\\posts' }],
		['percent escape', { namespace: 'wp/v2', base: '%2e%2e/posts' }],
		['unsafe property', { namespace: 'wp/v2', base: 'constructor' }],
	])('rejects a route that contains a %s', (_label, route) => {
		expect(() => buildRestPath(node, route)).toThrow(NodeOperationError);
	});

	it.each(['__proto__', 'constructor', 'prototype'])('rejects unsafe suffix %s', (suffix) => {
		expect(() =>
			buildRestPath(node, { namespace: 'wp/v2', base: 'types', suffix: [suffix] }),
		).toThrow(NodeOperationError);
	});

	it.each([
		['a slash-containing value', 'draft/12'],
		['NaN', Number.NaN],
		['infinity', Number.POSITIVE_INFINITY],
		['a negative number', -1],
		['a fractional number', 1.5],
	])('rejects %s as one suffix segment', (_label, suffix) => {
		expect(() =>
			buildRestPath(node, { namespace: 'wp/v2', base: 'posts', suffix: [suffix] }),
		).toThrow(NodeOperationError);
	});

	it.each([
		['an empty value', { namespace: '', base: 'posts' }],
		['an empty segment', { namespace: 'wp//v2', base: 'posts' }],
		['a trailing slash', { namespace: 'wp/v2/', base: 'posts' }],
		['a control character', { namespace: 'wp/v2', base: 'post\u0000s' }],
		['an overlong part', { namespace: 'a'.repeat(201), base: 'posts' }],
		[
			'an overlong complete path',
			{ namespace: 'a'.repeat(200), base: 'b'.repeat(200), suffix: ['c'.repeat(100)] },
		],
	])('rejects a route with %s', (_label, route) => {
		expect(() => buildRestPath(node, route)).toThrow(NodeOperationError);
	});
});
