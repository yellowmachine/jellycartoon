import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isShape, shapeUrl } from './electric-shape.ts';

const electric = { url: 'http://electric:3000', secret: 'secreto' };

describe('shapeUrl', () => {
	test('la familia y la tabla, fijas', () => {
		const url = shapeUrl(electric, 'a', 'tag', new URLSearchParams('offset=-1'));
		expect(url.origin + url.pathname).toBe('http://electric:3000/v1/shape');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			offset: '-1',
			table: 'tag',
			columns: 'id,name',
			where: 'family_id = $1',
			'params[1]': 'a',
			secret: 'secreto'
		});
	});

	test('de la petición, solo el protocolo', () => {
		const query = new URLSearchParams({
			offset: '0_0',
			handle: 'h',
			live: 'true',
			cursor: 'c',
			table: 'expense',
			where: 'true',
			columns: 'id',
			'params[1]': 'b',
			secret: 'otro',
			subset__where: 'true'
		});
		const url = shapeUrl(electric, 'a', 'series_tag', query).searchParams;
		expect(url.get('table')).toBe('series_tag');
		expect(url.get('where')).toBe('family_id = $1');
		expect(url.get('params[1]')).toBe('a');
		expect(url.get('secret')).toBe('secreto');
		expect(url.get('columns')).toBe('family_id,series_id,tag_id');
		expect(url.get('subset__where')).toBeNull();
		expect(url.get('handle')).toBe('h');
		expect(url.get('live')).toBe('true');
	});

	test('una familia con comillas no cambia el filtro', () => {
		const url = shapeUrl(electric, "a' or '1'='1", 'tag', new URLSearchParams()).searchParams;
		expect(url.get('where')).toBe('family_id = $1');
		expect(url.get('params[1]')).toBe("a' or '1'='1");
	});

	test('sin familia, ninguna dirección', () => {
		expect(() => shapeUrl(electric, '', 'tag', new URLSearchParams())).toThrow('Sin familia');
	});

	test('solo las tablas de la lista', () => {
		expect(isShape('tag')).toBe(true);
		expect(isShape('expense')).toBe(false);
		expect(isShape('constructor')).toBe(false);
	});
});

test('la dirección y el secreto de Electric, solo en electric.ts (y declarados en env.ts)', () => {
	const src = join(import.meta.dir, '../..');
	const found: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (
				!path.endsWith('electric-shape.test.ts') &&
				/ELECTRIC_(URL|SECRET)/.test(readFileSync(path, 'utf8'))
			)
				found.push(path.slice(src.length + 1));
		}
	};
	walk(src);
	expect(found.sort()).toEqual(['env.ts', 'lib/server/electric.ts']);
});
