import { describe, expect, test } from 'bun:test';
import { browserOf, HOW } from './install-how.ts';

const UA = {
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
	ipadAsMac:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
	samsung:
		'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
	androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
	linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
	edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
};

describe('browserOf', () => {
	test('phones', () => {
		expect(browserOf(UA.iphone)).toBe('ios');
		expect(browserOf(UA.androidChrome)).toBe('android-chrome');
		expect(browserOf(UA.samsung)).toBe('android-samsung');
		expect(browserOf(UA.androidFirefox)).toBe('android-firefox');
	});

	test('an iPad says it is a Mac, but has a touch screen', () => {
		expect(browserOf(UA.ipadAsMac, 5)).toBe('ios');
		expect(browserOf(UA.ipadAsMac, 0)).toBe('mac-safari');
	});

	test('computers', () => {
		expect(browserOf(UA.macChrome)).toBe('pc-chromium');
		expect(browserOf(UA.edge)).toBe('pc-chromium');
		expect(browserOf(UA.linuxFirefox)).toBe('pc-firefox');
	});

	test('every browser has its steps', () => {
		for (const ua of Object.values(UA)) expect(HOW.some((h) => h.id === browserOf(ua))).toBe(true);
	});
});
