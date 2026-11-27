import { describe, expect, test } from 'bun:test';
import { switchReading } from './plug-watch.ts';

describe('lo que dice un Shelly de su enchufe (#651)', () => {
	test('sus vatios y si está encendido, de NotifyStatus y NotifyFullStatus', () => {
		const status = (method: string, sw: unknown) =>
			JSON.stringify({ src: 'shellyplugmg3-1', method, params: { 'switch:0': sw } });
		expect(switchReading(status('NotifyStatus', { apower: 512.3 }))).toEqual({
			power: 512.3,
			output: null
		});
		expect(switchReading(status('NotifyFullStatus', { apower: 0, output: true }))).toEqual({
			power: 0,
			output: true
		});
	});

	test('lo demás, nada', () => {
		expect(switchReading('no es json')).toBeNull();
		expect(switchReading(JSON.stringify({ id: 3, result: {} }))).toBeNull();
		expect(
			switchReading(JSON.stringify({ method: 'NotifyStatus', params: { 'switch:0': {} } }))
		).toBeNull();
		expect(
			switchReading(
				JSON.stringify({ method: 'NotifyEvent', params: { 'switch:0': { apower: 9 } } })
			)
		).toBeNull();
	});
});
