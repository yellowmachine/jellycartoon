import { expect, test } from 'bun:test';
import { parseCoordinates } from './coordinates.ts';

const SOL: [number, number] = [-3.7038, 40.4168];
const near = (got: [number, number] | null, want: [number, number]) => {
	expect(got).not.toBeNull();
	expect(got![0]).toBeCloseTo(want[0], 4);
	expect(got![1]).toBeCloseTo(want[1], 4);
};

test('decimal, latitude first, as Google Maps copies them', () => {
	near(parseCoordinates('40.4168, -3.7038'), SOL);
	near(parseCoordinates('40.4168 -3.7038'), SOL);
	near(parseCoordinates('  40.4168,-3.7038 '), SOL);
	near(parseCoordinates('40,4168; -3,7038'), SOL);
	near(parseCoordinates('40,4168 -3,7038'), SOL);
});

test('degrees, minutes and seconds, with their letters (O for oeste too)', () => {
	near(parseCoordinates(`40°25'00.5"N 3°42'13.7"W`), [-3.703806, 40.416806]);
	near(parseCoordinates(`40°25'00.5"N 3°42'13.7"O`), [-3.703806, 40.416806]);
	near(parseCoordinates(`N 40° 25.008' W 3° 42.228'`), [-3.7038, 40.4168]);
	near(parseCoordinates(`3°42'13.7"W 40°25'00.5"N`), [-3.703806, 40.416806]);
});

test('map links: the pin first, then where the map looks', () => {
	near(
		parseCoordinates(
			'https://www.google.com/maps/place/Puerta+del+Sol/@40.4169,-3.7035,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d40.4168!4d-3.7038'
		),
		SOL
	);
	near(parseCoordinates('https://www.google.com/maps/@40.4168,-3.7038,15z'), SOL);
	near(parseCoordinates('https://maps.google.com/?q=40.4168,-3.7038'), SOL);
	near(parseCoordinates('https://www.google.com/maps/search/?api=1&query=40.4168%2C-3.7038'), SOL);
	near(parseCoordinates('https://www.google.com/maps/place/40.4168,-3.7038'), SOL);
	near(
		parseCoordinates('https://www.openstreetmap.org/?mlat=40.4168&mlon=-3.7038#map=17/40.41/-3.70'),
		SOL
	);
	near(parseCoordinates('https://www.openstreetmap.org/#map=17/40.4168/-3.7038'), SOL);
	near(parseCoordinates('geo:40.4168,-3.7038?z=15'), SOL);
});

test('anything else, null', () => {
	expect(parseCoordinates('')).toBeNull();
	expect(parseCoordinates('Calle Mayor 5, Madrid')).toBeNull();
	expect(parseCoordinates('91, 10')).toBeNull();
	expect(parseCoordinates('https://maps.app.goo.gl/abc123')).toBeNull();
	expect(parseCoordinates('12')).toBeNull();
});
