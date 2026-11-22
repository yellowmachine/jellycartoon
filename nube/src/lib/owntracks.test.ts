import { describe, expect, test } from 'bun:test';
import {
	basicPassword,
	owntracksConfig,
	owntracksLink,
	parseLocation,
	trackerId
} from './owntracks.ts';

const now = Date.UTC(2026, 10, 22, 12);
const tst = now / 1000 - 60;

describe('parseLocation', () => {
	test('a location, with what it says', () => {
		expect(
			parseLocation(
				{
					_type: 'location',
					lat: 37.98,
					lon: -1.13,
					tst,
					acc: 12,
					vel: 5,
					alt: 43,
					batt: 64,
					tid: 'MA'
				},
				'pixel',
				now
			)
		).toEqual({
			at: new Date(tst * 1000),
			lon: -1.13,
			lat: 37.98,
			accuracy: 12,
			speed: 5,
			altitude: 43,
			battery: 64,
			device: 'pixel'
		});
	});

	test('without header, the device from its topic, then its tid', () => {
		const base = { _type: 'location', lat: 1, lon: 2, tst };
		expect(
			parseLocation({ ...base, topic: 'owntracks/seilide/móvil', tid: 'MA' }, null, now)?.device
		).toBe('móvil');
		expect(parseLocation({ ...base, tid: 'MA' }, null, now)?.device).toBe('MA');
		expect(parseLocation(base, null, now)).toMatchObject({
			device: null,
			accuracy: null,
			battery: null
		});
	});

	test('anything else, or nonsense, is not kept', () => {
		const ok = { _type: 'location', lat: 1, lon: 2, tst };
		expect(parseLocation({ ...ok, _type: 'transition' }, null, now)).toBeNull();
		expect(parseLocation([ok], null, now)).toBeNull();
		expect(parseLocation(null, null, now)).toBeNull();
		expect(parseLocation({ ...ok, lat: 91 }, null, now)).toBeNull();
		expect(parseLocation({ ...ok, lon: '2' }, null, now)).toBeNull();
		// From the future, or older than what is kept.
		expect(parseLocation({ ...ok, tst: now / 1000 + 2 * 3600 }, null, now)).toBeNull();
		expect(parseLocation({ ...ok, tst: now / 1000 - 91 * 86400 }, null, now)).toBeNull();
		// A battery out of range: the position, without it.
		expect(parseLocation({ ...ok, batt: 300 }, null, now)?.battery).toBeNull();
	});
});

test('basicPassword', () => {
	expect(basicPassword('Basic ' + btoa('seilide:abc:def'))).toBe('abc:def');
	expect(basicPassword('Bearer xyz')).toBeNull();
	expect(basicPassword('Basic ' + btoa('sin-dos-puntos'))).toBeNull();
	expect(basicPassword('Basic %%%')).toBeNull();
	expect(basicPassword(null)).toBeNull();
});

test('trackerId', () => {
	expect(trackerId('Ana López')).toBe('AL');
	expect(trackerId('Ángel')).toBe('AN');
	expect(trackerId('M')).toBe('MX');
	expect(trackerId('')).toBe('YO');
});

test('the link carries the configuration, safe in an address', () => {
	const config = owntracksConfig({
		origin: 'https://seilide.app',
		password: 'p'.repeat(43),
		name: 'Ana'
	});
	expect(config).toMatchObject({
		_type: 'configuration',
		mode: 3,
		url: 'https://seilide.app/api/owntracks',
		auth: true,
		monitoring: 1,
		tid: 'AN'
	});
	const link = owntracksLink(config);
	expect(link.startsWith('owntracks:///config?inline=')).toBe(true);
	const inline = new URL(link.replace('owntracks:///', 'https://x/')).searchParams.get('inline')!;
	expect(link.split('inline=')[1]).not.toMatch(/[+/=]/);
	const json = new TextDecoder().decode(Uint8Array.from(atob(inline), (c) => c.charCodeAt(0)));
	expect(JSON.parse(json)).toEqual(config);
});
