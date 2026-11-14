import { expect, test } from 'bun:test';
import { deviceLabel } from './device-label.ts';

test('a browser said briefly', () => {
	expect(
		deviceLabel(
			'Mozilla/5.0 (Linux; Android 14; 23124RN87G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
		)
	).toBe('Android · Chrome');
	expect(
		deviceLabel(
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
		)
	).toBe('iPhone · Safari');
	expect(
		deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')
	).toBe('Linux · Firefox');
	expect(deviceLabel('curl/8.0')).toBeNull();
	expect(deviceLabel(null)).toBeNull();
});
