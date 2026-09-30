import { describe, expect, test } from 'bun:test';
import { testApp, json, signInDev } from './helpers';

describe('device OAuth', () => {
  test('start → approve → poll token', async () => {
    const { app } = testApp();
    const start = await json(app, 'POST', '/api/auth/device', {
      body: { label: 'agentio on test' },
    });
    expect(start.status).toBe(200);
    const started = start.data as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresInSeconds: number;
      intervalSeconds: number;
    };
    expect(started.deviceCode.length).toBeGreaterThan(20);
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(started.verificationUrl).toContain('/auth/device?code=');
    expect(started.expiresInSeconds).toBe(600);

    const pending = await json(app, 'POST', '/api/auth/device/token', {
      body: { deviceCode: started.deviceCode },
    });
    expect(pending.status).toBe(202);
    expect((pending.data as { state: string }).state).toBe('pending');

    const { cookie } = await signInDev(app);
    const approve = await json(app, 'POST', '/api/auth/device/approve', {
      cookie,
      body: { userCode: started.userCode, approve: true },
    });
    expect(approve.status).toBe(200);
    expect((approve.data as { approved: boolean }).approved).toBe(true);

    const approved = await json(app, 'POST', '/api/auth/device/token', {
      body: { deviceCode: started.deviceCode },
    });
    expect(approved.status).toBe(200);
    const tok = approved.data as { state: string; token: string; expiresAt: string };
    expect(tok.state).toBe('approved');
    expect(tok.token.length).toBeGreaterThan(20);

    // Token works for API
    const me = await json(app, 'GET', '/api/auth/me', { token: tok.token });
    expect(me.status).toBe(200);
    expect((me.data as { email: string }).email).toBe('pierre@example.com');

    // Second poll fails (already claimed)
    const again = await json(app, 'POST', '/api/auth/device/token', {
      body: { deviceCode: started.deviceCode },
    });
    expect(again.status).toBe(401);
  });

  test('deny flow', async () => {
    const { app } = testApp();
    const start = await json(app, 'POST', '/api/auth/device', { body: { label: 'x' } });
    const started = start.data as { deviceCode: string; userCode: string };
    const { cookie } = await signInDev(app);
    await json(app, 'POST', '/api/auth/device/approve', {
      cookie,
      body: { userCode: started.userCode, approve: false },
    });
    const denied = await json(app, 'POST', '/api/auth/device/token', {
      body: { deviceCode: started.deviceCode },
    });
    expect(denied.status).toBe(403);
    expect((denied.data as { state: string }).state).toBe('denied');
  });

  test('approve requires session', async () => {
    const { app } = testApp();
    const start = await json(app, 'POST', '/api/auth/device', { body: {} });
    const started = start.data as { userCode: string };
    const res = await json(app, 'POST', '/api/auth/device/approve', {
      body: { userCode: started.userCode, approve: true },
    });
    expect(res.status).toBe(401);
  });
});
