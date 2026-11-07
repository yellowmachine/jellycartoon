import { describe, expect, test } from 'bun:test';
import { hearingKeys } from './hearing-keys.ts';

const settled = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('the keys to the house’s Whisper (#430)', () => {
	test('null at first, without waiting; then told, and asked for only once', async () => {
		const asked: string[] = [];
		const key = hearingKeys(async (family, satellite) => {
			asked.push(`${family}/${satellite}`);
			return 'solo-oir';
		});
		let told = 0;
		expect(key('f', 's', () => told++)).toBeNull();
		await settled();
		expect(told).toBe(1);
		expect(key('f', 's', () => told++)).toBe('solo-oir');
		expect(asked).toEqual(['f/s']);
	});

	test('each satellite its own', async () => {
		const key = hearingKeys(async (_, satellite) => `clave-${satellite}`);
		key('f', 'a', () => {});
		key('f', 'b', () => {});
		await settled();
		expect(key('f', 'a', () => {})).toBe('clave-a');
		expect(key('f', 'b', () => {})).toBe('clave-b');
	});

	test('the house not answering: not asked again until a while later', async () => {
		let time = 1000;
		let asked = 0;
		let works = false;
		const warn = console.warn;
		console.warn = () => {};
		const key = hearingKeys(
			async () => {
				asked++;
				if (!works) throw new Error('no contesta');
				return 'solo-oir';
			},
			() => time
		);
		let told = 0;
		key('f', 's', () => told++);
		await settled();
		key('f', 's', () => told++);
		await settled();
		expect(asked).toBe(1);
		expect(told).toBe(0);
		time += 60_000;
		works = true;
		key('f', 's', () => told++);
		await settled();
		console.warn = warn;
		expect(asked).toBe(2);
		expect(told).toBe(1);
		expect(key('f', 's', () => told++)).toBe('solo-oir');
	});
});
