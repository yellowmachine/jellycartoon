import { describe, expect, test } from 'bun:test';
import { houseUrl } from './house-url.ts';

describe('the house’s address', () => {
	test('https, without its trailing slash', () => {
		expect(houseUrl(' https://media.example.com/ ')).toBe('https://media.example.com');
	});

	test('not http: the key goes with each request', () => {
		expect(houseUrl('http://media.example.com')).toBeNull();
	});

	test('only the address, not a path', () => {
		expect(houseUrl('https://media.example.com/api/v1')).toBeNull();
		expect(houseUrl('https://media.example.com/?x=1')).toBeNull();
	});

	test('not something else', () => {
		expect(houseUrl('media.example.com')).toBeNull();
	});
});
