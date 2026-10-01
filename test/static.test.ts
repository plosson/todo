import { describe, expect, test } from 'bun:test';
import { testApp } from './helpers';

const FILES: Array<[route: string, type: string]> = [
  ['/', 'text/html'],
  ['/sessions', 'text/html'],
  ['/app.js', 'application/javascript'],
  ['/styles.css', 'text/css'],
  ['/icon.svg', 'image/svg+xml'],
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/sw.js', 'application/javascript'],
];

describe('public files', () => {
  for (const [route, type] of FILES) {
    test(`${route} must be revalidated so a deploy is never served stale`, async () => {
      const { app } = testApp();
      const res = await app.request(route);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toStartWith(type);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect((await res.text()).length).toBeGreaterThan(0);
    });
  }

  test('service worker may control the whole origin', async () => {
    const { app } = testApp();
    const res = await app.request('/sw.js');
    expect(res.headers.get('service-worker-allowed')).toBe('/');
  });

  const outside = [
    '/../src/config.ts',
    '/%2e%2e/src/config.ts',
    '/public/app.js',
    '/.env',
    '/.data/secret',
    '/src/db/schema.sql',
    '/index.html',
  ];
  for (const path of outside) {
    test(`does not serve ${path}`, async () => {
      const { app } = testApp();
      const res = await app.request(path);
      expect(res.status).toBe(404);
    });
  }
});
