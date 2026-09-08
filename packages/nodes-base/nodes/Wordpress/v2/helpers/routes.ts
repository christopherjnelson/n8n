import type { INode } from 'n8n-workflow';
import { isSafeObjectProperty, NodeOperationError } from 'n8n-workflow';

const MAX_ROUTE_PART_LENGTH = 200;
const MAX_ROUTE_LENGTH = 500;
const MAX_POST_TYPE_SLUG_LENGTH = 20;
const SAFE_ROUTE_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const WORDPRESS_POST_TYPE_SLUG = /^[a-z0-9_-]+$/;

export type WordpressRestRoute = {
	namespace: string;
	base: string;
	suffix?: ReadonlyArray<string | number>;
};

function invalidRoutePart(node: INode, fieldName: string): NodeOperationError {
	if (fieldName === 'post type slug') {
		return new NodeOperationError(
			node,
			"The selected post type isn't valid. Select a REST-exposed post type and try again.",
		);
	}
	return new NodeOperationError(
		node,
		`WordPress returned an invalid ${fieldName}. Check the post type REST configuration and try again.`,
	);
}

function parseRoutePart(node: INode, value: string, fieldName: string): string[] {
	const hasControlCharacter = [...value].some((character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || code === 127;
	});
	if (
		value.length === 0 ||
		value.length > MAX_ROUTE_PART_LENGTH ||
		value.startsWith('/') ||
		value.endsWith('/') ||
		/[?#%\\]/.test(value) ||
		hasControlCharacter
	) {
		throw invalidRoutePart(node, fieldName);
	}

	const segments = value.split('/');
	for (const segment of segments) {
		if (
			segment.length === 0 ||
			segment === '.' ||
			segment === '..' ||
			!SAFE_ROUTE_SEGMENT.test(segment) ||
			!isSafeObjectProperty(segment)
		) {
			throw invalidRoutePart(node, fieldName);
		}
	}

	return segments;
}

function parseSuffix(node: INode, suffix: ReadonlyArray<string | number> = []): string[] {
	return suffix.flatMap((value) => {
		if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
			throw invalidRoutePart(node, 'REST route suffix');
		}
		const stringValue = String(value);
		const segments = parseRoutePart(node, stringValue, 'REST route suffix');
		if (segments.length !== 1) {
			throw invalidRoutePart(node, 'REST route suffix');
		}
		return segments;
	});
}

export function validateRegisteredSlug(node: INode, slug: string): string {
	if (slug.length > MAX_POST_TYPE_SLUG_LENGTH || !WORDPRESS_POST_TYPE_SLUG.test(slug)) {
		throw invalidRoutePart(node, 'post type slug');
	}
	const segments = parseRoutePart(node, slug, 'post type slug');
	if (segments.length !== 1) {
		throw invalidRoutePart(node, 'post type slug');
	}
	return segments[0];
}

export function buildRestPath(node: INode, route: WordpressRestRoute): string {
	const segments = [
		...parseRoutePart(node, route.namespace, 'REST namespace'),
		...parseRoutePart(node, route.base, 'REST base'),
		...parseSuffix(node, route.suffix),
	];
	const path = `/${segments.join('/')}`;

	if (path.length > MAX_ROUTE_LENGTH) {
		throw new NodeOperationError(
			node,
			'The WordPress REST route is too long. Select a different post type and try again.',
		);
	}

	return path;
}
