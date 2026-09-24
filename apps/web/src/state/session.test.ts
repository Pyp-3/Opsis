import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { fakeApi } from './fakeApi';
import { createSessionStore, currentOsg, explanationKey, type SessionApi } from './session';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('session store', () => {
  it('draws a sentence, recording each progress stage', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    const stages: (string | null)[] = [];
    store.subscribe((s) => stages.push(s.stage));
    store.getState().submit('A sandwich can contain bread, tomato, ham.');
    expect(store.getState().status).toBe('loading');
    await settle();
    expect(store.getState().status).toBe('ready');
    expect(currentOsg(store.getState())?.title).toBe('A Sandwich and Its Parts');
    expect(stages).toEqual(expect.arrayContaining(['parsing', 'mapping', 'layout']));
    expect(api.visualize.mock.calls[0]?.[0]).toEqual({
      utterance: 'A sandwich can contain bread, tomato, ham.',
      audience: 'teen',
    });
  });

  it('caches explanations per diagram, node, level and reading level', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    await settle();
    const { requestExplanation } = store.getState();
    requestExplanation('e_tomato', 'summary');
    requestExplanation('e_tomato', 'summary');
    await settle();
    requestExplanation('e_tomato', 'summary');
    expect(api.explain).toHaveBeenCalledTimes(1);
    const osgId = currentOsg(store.getState())!.id;
    expect(
      store.getState().explanations[explanationKey(osgId, 'e_tomato', 'summary', 'teen')],
    ).toMatchObject({
      status: 'ready',
    });
    store.getState().setAudience('child');
    store.getState().requestExplanation('e_tomato', 'summary');
    expect(api.explain).toHaveBeenCalledTimes(2);
  });

  it('retries a failed explanation on the next request', async () => {
    const failing = new ApiError({ code: 'x', message: 'nope', stage: 'explain', retryable: true });
    const api = fakeApi();
    api.explain.mockRejectedValueOnce(failing);
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    await settle();
    store.getState().requestExplanation('e_ham', 'explanation');
    await settle();
    const key = explanationKey(currentOsg(store.getState())!.id, 'e_ham', 'explanation', 'teen');
    expect(store.getState().explanations[key]).toMatchObject({ status: 'error' });
    store.getState().requestExplanation('e_ham', 'explanation');
    await settle();
    expect(store.getState().explanations[key]).toMatchObject({ status: 'ready' });
  });

  it('does not request an explanation for a locally added node until it is persisted', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    await settle();
    const osg = structuredClone(currentOsg(store.getState())!);
    const sourceNode = osg.scenes[0]!.nodes[1]!;
    osg.scenes[0]!.nodes.push({ ...sourceNode, id: 'user_new', label: 'New idea' });
    osg.sg.entities.push({
      ...osg.sg.entities[1]!,
      id: 'user_new',
      surface: 'New idea',
      lemma: 'new idea',
      summary: 'New idea was added to this diagram.',
    });
    store.getState().replaceCurrentOsg(osg);

    store.getState().requestExplanation('user_new', 'summary');
    expect(api.explain).not.toHaveBeenCalled();

    store.getState().markPersisted(osg);
    store.getState().requestExplanation('user_new', 'summary');
    await settle();
    expect(api.explain).toHaveBeenCalledOnce();
  });

  it('opens a drillable part and goes back up the breadcrumbs', async () => {
    const store = createSessionStore(fakeApi());
    store.getState().submit('sandwich');
    await settle();
    store.getState().select('e_tomato');
    store.getState().toggleExplode();
    expect(store.getState().exploded).toBe(true);
    store.getState().open('e_tomato');
    await settle();
    expect(store.getState().trail).toHaveLength(2);
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().exploded).toBe(false);
    store.getState().goUp();
    expect(store.getState().trail).toHaveLength(1);
    expect(currentOsg(store.getState())?.title).toBe('A Sandwich and Its Parts');
  });

  it('does not open parts that are not drillable', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    await settle();
    store.getState().open('e_sandwich');
    expect(api.drilldown).not.toHaveBeenCalled();
  });

  it('loads an ancestor that is not in memory from the API', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    store.setState({ trail: [await api.drilldown({ osgId: 'x', nodeId: 'y' })], status: 'ready' });
    store.getState().goUp();
    await settle();
    expect(api.loadOsg).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000002');
    expect(store.getState().trail).toHaveLength(1);
  });

  it('shows retryable errors with a retry action', async () => {
    const api = fakeApi();
    api.visualize.mockRejectedValueOnce(
      new ApiError({
        code: 'pipeline_error',
        message: 'Could not build.',
        stage: 'visualize',
        retryable: true,
      }),
    );
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    await settle();
    expect(store.getState()).toMatchObject({ status: 'error', error: { code: 'pipeline_error' } });
    store.getState().retry?.();
    await settle();
    expect(store.getState().status).toBe('ready');
  });

  it('cancels an in-flight request and returns to onboarding', async () => {
    const api = fakeApi({
      visualize: vi.fn<SessionApi['visualize']>((_body, _progress, { signal } = {}) => {
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        );
      }),
    });
    const store = createSessionStore(api);
    store.getState().submit('sandwich');
    store.getState().cancel();
    await settle();
    expect(store.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('keeps one edited OSG while switching between 2D and 3D', async () => {
    const store = createSessionStore(fakeApi());
    store.getState().submit('sandwich');
    await settle();
    const osg = structuredClone(currentOsg(store.getState())!);
    osg.scenes[0]!.nodes[0]!.label = 'Edited sandwich';
    store.getState().replaceCurrentOsg(osg);
    store.getState().setViewMode('2d');
    store.getState().setViewMode('3d');
    expect(currentOsg(store.getState())?.scenes[0]?.nodes[0]?.label).toBe('Edited sandwich');
  });

  it('restores a saved OSG by id after a reload', async () => {
    const api = fakeApi();
    const store = createSessionStore(api);
    store.getState().restoreSaved('20000000-0000-4000-8000-000000000002');
    await settle();
    expect(api.loadOsg).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000002');
    expect(currentOsg(store.getState())?.id).toBe('20000000-0000-4000-8000-000000000002');
  });
});
