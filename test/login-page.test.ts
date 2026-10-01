import { describe, expect, test } from 'bun:test';
import { testApp, signInDev } from './helpers';

const ORIGIN = 'https://todo.example';

/** Where a browser would actually go when following `location` from our origin. */
function landingOrigin(location: string): string {
  return new URL(location, ORIGIN).origin;
}

const OFFSITE = [
  '//evil.example',
  '/\\evil.example',
  '/\\/evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r\n/evil.example',
  '/ /evil.example',
  '///evil.example',
  'https://evil.example',
  'javascript:alert(1)',
  '\\\\evil.example',
  'evil.example',
  '',
];

describe('redirectTo is same-origin only', () => {
  for (const raw of OFFSITE) {
    test(`signed-in /login refuses ${JSON.stringify(raw)}`, async () => {
      const { app } = testApp();
      const { token } = await signInDev(app);
      const res = await app.request(`/login?redirectTo=${encodeURIComponent(raw)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(landingOrigin(location)).toBe(ORIGIN);
      expect(location.startsWith('//')).toBe(false);
      expect(location.includes('\\')).toBe(false);
    });

    test(`Google start refuses ${JSON.stringify(raw)} in the signed state`, async () => {
      const ctx = testApp({ devAuth: false });
      ctx.config.google = { clientId: 'cid', clientSecret: 'csecret' };
      const res = await ctx.app.request(`/api/auth/google/start?redirectTo=${encodeURIComponent(raw)}`);
      const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
      const payload = JSON.parse(Buffer.from(state.split('.')[0]!, 'base64url').toString()) as {
        redirectTo: string;
      };
      expect(landingOrigin(payload.redirectTo)).toBe(ORIGIN);
    });
  }

  test('a normal same-origin path with query is kept', async () => {
    const { app } = testApp();
    const { token } = await signInDev(app);
    const res = await app.request(
      `/login?redirectTo=${encodeURIComponent('/auth/device?code=ABCD-EFGH')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.headers.get('location')).toBe('/auth/device?code=ABCD-EFGH');
  });
});

describe('login page does not reflect script', () => {
  const payloads = [
    '/</script><script>alert(1)</script>',
    '/"><script>alert(1)</script>',
    '/" onmouseover="alert(1)',
    "/'-alert(1)-'",
    '/ alert(1)',
  ];

  for (const payload of payloads) {
    test(JSON.stringify(payload), async () => {
      const { app } = testApp();
      const res = await app.request(`/login?redirectTo=${encodeURIComponent(payload)}`);
      const html = await res.text();
      expect(html).not.toContain('<script>alert(1)');
      expect(html).not.toContain('" onmouseover=');
      expect(html.match(/<script>/g)?.length ?? 0).toBe(1);
      // The redirect target lives in an attribute, never inside the script.
      const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
      expect(script).not.toContain('alert(1)');
    });
  }

  test('error message is escaped', async () => {
    const { app } = testApp();
    const html = await (
      await app.request(`/login?error=${encodeURIComponent('<img src=x onerror=alert(1)>')}`)
    ).text();
    expect(html).not.toContain('<img src=x');
  });
});
