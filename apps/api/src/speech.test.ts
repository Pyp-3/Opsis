import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SpeechEngine, SpeechStatus, SpeechVoice } from './speech';
import { signIn } from './test-session';

/** Records generations and lets the test decide when each one finishes. */
function fakeEngine() {
  const calls: { text: string; voice: SpeechVoice; finish: () => void }[] = [];
  let status: SpeechStatus = { state: 'idle' };
  const engine: SpeechEngine = {
    status: () => status,
    warm: () => {
      status = { state: 'loading', progress: 0.5 };
    },
    generate: (text, voice) =>
      new Promise((resolve) =>
        calls.push({ text, voice, finish: () => resolve(Buffer.from(`RIFF:${voice}:${text}`)) }),
      ),
  };
  return { engine, calls };
}

const apps: ReturnType<typeof buildApp>[] = [];
/** A member's narrator: any line may be spoken. narration-access.test.ts covers everyone else. */
const start = (speech: SpeechEngine | null) => {
  const app = buildApp({ databasePath: ':memory:', speech, rateLimit: 2 });
  void signIn(app);
  apps.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('natural narrator speech', () => {
  it('reports status and warms the model on request', async () => {
    const { engine } = fakeEngine();
    const app = start(engine);
    expect((await app.inject({ method: 'GET', url: '/v1/speech' })).json()).toEqual({
      state: 'idle',
    });
    const warmed = await app.inject({ method: 'POST', url: '/v1/speech/warm' });
    expect(warmed.json()).toEqual({ state: 'loading', progress: 0.5 });
  });

  it('returns WAV audio and reuses a recording for the same line', async () => {
    const { engine, calls } = fakeEngine();
    const app = start(engine);
    const body = { text: 'The resolver asks the root.', voice: 'bf_emma' };
    const first = app.inject({ method: 'POST', url: '/v1/speech', payload: body });
    const second = app.inject({ method: 'POST', url: '/v1/speech', payload: body });
    await until(() => calls.length > 0);
    calls[0]!.finish();
    for (const response of await Promise.all([first, second])) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('audio/wav');
      expect(response.body).toBe('RIFF:bf_emma:The resolver asks the root.');
    }
    expect(calls).toHaveLength(1);
  });

  it('speaks one line at a time, urgent lines first, and is exempt from the rate limit', async () => {
    const { engine, calls } = fakeEngine();
    const app = start(engine);
    const say = (text: string, urgent: boolean) =>
      app.inject({
        method: 'POST',
        url: '/v1/speech',
        payload: { text, voice: 'bm_george', urgent },
      });
    const busy = say('Now.', true);
    await until(() => calls.length === 1);
    const ahead = [say('Later one.', false), say('Later two.', false)];
    const needed = say('Needed now.', true);
    const promoted = say('Later two.', true);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.map((call) => call.text)).toEqual(['Now.']);
    for (let i = 0; i < 4; i++) {
      await until(() => calls.length === i + 1);
      calls[i]!.finish();
    }
    expect(calls.map((call) => call.text)).toEqual([
      'Now.',
      'Needed now.',
      'Later two.',
      'Later one.',
    ]);
    for (const response of await Promise.all([busy, ...ahead, needed, promoted]))
      expect(response.statusCode).toBe(200);
  });

  it('rejects unknown voices and overlong text', async () => {
    const app = start(fakeEngine().engine);
    for (const payload of [
      { text: 'Hello.', voice: 'af_heart' },
      { text: 'x'.repeat(601), voice: 'bf_emma' },
      { text: '  ', voice: 'bf_emma' },
    ])
      expect((await app.inject({ method: 'POST', url: '/v1/speech', payload })).statusCode).toBe(
        400,
      );
  });

  it('can be turned off', async () => {
    const app = start(null);
    expect((await app.inject({ method: 'GET', url: '/v1/speech' })).json()).toEqual({
      state: 'off',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/speech',
      payload: { text: 'Hello.', voice: 'bf_emma' },
    });
    expect(response.statusCode).toBe(503);
  });
});
