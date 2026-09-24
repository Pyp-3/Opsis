import type { Explanation, OSG } from '@opsis/schema';
import { vi, type Mock } from 'vitest';
import { loadFixture } from '../scene/fixtures';
import type { SessionApi } from './session';

/** Test-only child diagram for "open tomato" built from the sandwich fixture. */
export function tomatoChild(parent: OSG): OSG {
  const id = '30000000-0000-4000-8000-000000000003';
  return {
    ...parent,
    id,
    title: 'A tomato has skin, flesh and seeds',
    parentId: parent.id,
    breadcrumbs: [...parent.breadcrumbs, { id, label: 'Tomato' }],
  };
}

/** The session API with every method replaced by a mock. */
export type FakeApi = { [K in keyof SessionApi]: Mock<SessionApi[K]> };

/** A fake API: sentences mentioning "sun" draw the sun fixture, anything else the sandwich. */
export function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    visualize: vi.fn<SessionApi['visualize']>(async (body, onProgress) => {
      for (const stage of ['parsing', 'mapping', 'layout', 'done'] as const) onProgress(stage);
      return loadFixture(/sun/i.test(body.utterance) ? 'sun-east' : 'sandwich');
    }),
    explain: vi.fn<SessionApi['explain']>(
      async ({ osgId, nodeId, level, audience }): Promise<Explanation> => ({
        schemaVersion: 'exp/1',
        osgId,
        nodeId,
        level,
        audience,
        summary: `Summary of ${nodeId} for ${audience}.`,
        ...(level === 'explanation'
          ? {
              sections: {
                whatItIs: `What ${nodeId} is.`,
                whyItMattersHere: `Why ${nodeId} matters here.`,
                commonMisconception: 'Botanically a tomato is a fruit.',
              },
            }
          : {}),
        confidence: level === 'explanation' ? 'low' : 'high',
      }),
    ),
    drilldown: vi.fn<SessionApi['drilldown']>(async () => tomatoChild(loadFixture('sandwich'))),
    loadOsg: vi.fn<SessionApi['loadOsg']>(async () => loadFixture('sandwich')),
    saveOsg: vi.fn<SessionApi['saveOsg']>(async (osg) => osg),
    shareOsg: vi.fn<SessionApi['shareOsg']>(async (id) => ({
      token: 'test-share-token',
      osgId: id,
      url: '/v1/shared/test-share-token',
      readOnly: true,
    })),
    ...overrides,
  };
}
