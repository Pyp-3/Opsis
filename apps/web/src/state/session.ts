import type {
  Explanation,
  OSG,
  PositionedScene,
  VisualizeProgress,
  VisualizeRequest,
} from '@opsis/schema';
import type { PaletteId } from '@opsis/ui';
import { createStore, type StoreApi } from 'zustand/vanilla';
import * as defaultApi from './api';
import { ApiError, isAbort } from './api';

/** Reading level sent to `/v1/visualize` and `/v1/explain` (PROMPT.md §5.4). */
export type Audience = 'child' | 'teen' | 'adult';
/** Explanation depth: the Summary and Explanation tabs of the side panel. */
export type Level = Explanation['level'];
export const LAST_OSG_STORAGE_KEY = 'opsis:last-saved-osg';

/** The API surface the session needs; tests inject a fake. */
export type SessionApi = Pick<
  typeof defaultApi,
  'visualize' | 'explain' | 'drilldown' | 'loadOsg' | 'saveOsg' | 'shareOsg'
>;

/** A cached `/v1/explain` result. */
export type ExplanationEntry =
  | { status: 'loading' }
  | { status: 'ready'; data: Explanation }
  | { status: 'error'; error: ApiError };

export type SessionState = {
  /** Text in the input bar. */
  draft: string;
  /** `idle` = onboarding, `loading` = a diagram request is in flight. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Latest pipeline stage reported over SSE while loading. */
  stage: VisualizeProgress | null;
  error: ApiError | null;
  /** The action to re-run when the user presses "Try again". */
  retry: (() => void) | null;
  /** Diagrams opened so far, root first; the last one is on screen. */
  trail: OSG[];
  selectedId: string | null;
  panelTab: Level;
  exploded: boolean;
  /** Bumped to ask the 3D view to zoom to fit. */
  fitSignal: number;
  audience: Audience;
  paletteId: PaletteId;
  /** User override for motion; `null` follows `prefers-reduced-motion`. */
  reduceMotion: boolean | null;
  /** Both renderers read the same OSG from `trail`; this only chooses its presentation. */
  viewMode: '2d' | '3d';
  /** `/v1/explain` results keyed by `explanationKey`. */
  explanations: Record<string, ExplanationEntry>;
  /** Node ids known to exist in the API's persisted copy of each diagram. */
  persistedNodeIds: Record<string, string[]>;

  setDraft: (draft: string) => void;
  /** Draws `utterance` (default: the draft) and puts it in the input bar. */
  submit: (utterance?: string) => void;
  cancel: () => void;
  dismissError: () => void;
  select: (nodeId: string | null, tab?: Level) => void;
  setPanelTab: (tab: Level) => void;
  requestExplanation: (nodeId: string, level: Level) => void;
  open: (nodeId: string) => void;
  goTo: (index: number) => void;
  goUp: () => void;
  toggleExplode: () => void;
  zoomToFit: () => void;
  setAudience: (audience: Audience) => void;
  setPaletteId: (paletteId: PaletteId) => void;
  setReduceMotion: (reduce: boolean | null) => void;
  setViewMode: (mode: '2d' | '3d') => void;
  /** Replaces the current OSG after a canvas edit has passed shared-schema validation. */
  replaceCurrentOsg: (osg: OSG) => void;
  /** Records the server-confirmed node set after an explicit save. */
  markPersisted: (osg: OSG) => void;
  /** Loads a saved diagram by id, used to restore the last explicit save after reload. */
  restoreSaved: (id: string) => void;
};

export type SessionStore = StoreApi<SessionState>;

/** Cache key for an explanation: one entry per diagram, node, depth and reading level. */
export function explanationKey(
  osgId: string,
  nodeId: string,
  level: Level,
  audience: Audience,
): string {
  return `${osgId}|${nodeId}|${level}|${audience}`;
}

/** The diagram on screen. */
export function currentOsg(state: Pick<SessionState, 'trail'>): OSG | undefined {
  return state.trail[state.trail.length - 1];
}

function persistedNodes(osg: OSG): string[] {
  return osg.scenes.flatMap((scene) => scene.nodes.map((node) => node.id));
}

/** True if any node in the scene can explode. */
export function sceneExplodable(scene: PositionedScene | undefined): boolean {
  return (
    scene?.nodes.some((n) => n.explodable === true && n.explodedPosition !== undefined) ?? false
  );
}

/** Breadcrumbs for a diagram: the API's drill-down path, or just its own title at the root. */
export function breadcrumbsFor(osg: OSG): { id: string; label: string }[] {
  return osg.breadcrumbs.length > 0 ? osg.breadcrumbs : [{ id: osg.id, label: osg.title }];
}

/** Creates a session store. One per app; tests create their own with a fake API. */
export function createSessionStore(api: SessionApi = defaultApi): SessionStore {
  let inFlight: AbortController | null = null;

  /** Starts a request that replaces the diagram, cancelling any earlier one. */
  const run = (
    set: SessionStore['setState'],
    work: (signal: AbortSignal) => Promise<OSG[]>,
    retry: () => void,
  ) => {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    set({ status: 'loading', stage: null, error: null, retry: null });
    work(controller.signal).then(
      (trail) => {
        if (inFlight !== controller) return;
        inFlight = null;
        set((state) => ({
          status: 'ready',
          stage: null,
          trail,
          selectedId: null,
          panelTab: 'summary',
          exploded: false,
          persistedNodeIds: {
            ...state.persistedNodeIds,
            ...Object.fromEntries(trail.map((osg) => [osg.id, persistedNodes(osg)])),
          },
        }));
      },
      (error: unknown) => {
        if (inFlight !== controller) return;
        inFlight = null;
        if (isAbort(error)) {
          set((s) => ({ status: s.trail.length > 0 ? 'ready' : 'idle', stage: null }));
          return;
        }
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError({
                code: 'client_error',
                message: String(error),
                stage: 'client',
                retryable: true,
              });
        set({ status: 'error', stage: null, error: apiError, retry });
      },
    );
  };

  return createStore<SessionState>()((set, get) => ({
    draft: '',
    status: 'idle',
    stage: null,
    error: null,
    retry: null,
    trail: [],
    selectedId: null,
    panelTab: 'summary',
    exploded: false,
    fitSignal: 0,
    audience: 'teen',
    paletteId: 'default',
    reduceMotion: null,
    viewMode: '3d',
    explanations: {},
    persistedNodeIds: {},

    setDraft: (draft) => set({ draft }),

    submit: (utterance = get().draft) => {
      set({ draft: utterance });
      const body: VisualizeRequest = { utterance: utterance.trim(), audience: get().audience };
      const again = () => get().submit(utterance);
      run(
        set,
        async (signal) => [await api.visualize(body, (stage) => set({ stage }), { signal })],
        again,
      );
    },

    cancel: () => inFlight?.abort(),

    dismissError: () =>
      set((s) => ({ status: s.trail.length > 0 ? 'ready' : 'idle', error: null, retry: null })),

    select: (nodeId, tab) =>
      set((s) => ({
        selectedId: nodeId,
        panelTab: tab ?? (nodeId === s.selectedId ? s.panelTab : 'summary'),
      })),

    setPanelTab: (panelTab) => set({ panelTab }),

    requestExplanation: (nodeId, level) => {
      const { audience, explanations } = get();
      const osg = currentOsg(get());
      if (!osg) return;
      if (!get().persistedNodeIds[osg.id]?.includes(nodeId)) return;
      const key = explanationKey(osg.id, nodeId, level, audience);
      const cached = explanations[key];
      if (cached && cached.status !== 'error') return;
      const put = (entry: ExplanationEntry) =>
        set((s) => ({ explanations: { ...s.explanations, [key]: entry } }));
      put({ status: 'loading' });
      api.explain({ osgId: osg.id, nodeId, level, audience }).then(
        (data) => put({ status: 'ready', data }),
        (error: unknown) =>
          put({
            status: 'error',
            error:
              error instanceof ApiError
                ? error
                : new ApiError({
                    code: 'client_error',
                    message: String(error),
                    stage: 'explain',
                    retryable: true,
                  }),
          }),
      );
    },

    open: (nodeId) => {
      const { trail } = get();
      const osg = currentOsg(get());
      const node = osg?.scenes.flatMap((s) => s.nodes).find((n) => n.id === nodeId);
      if (!osg || !node?.drillable) return;
      const again = () => get().open(nodeId);
      run(
        set,
        async (signal) => [...trail, await api.drilldown({ osgId: osg.id, nodeId }, { signal })],
        again,
      );
    },

    goTo: (index) => {
      const osg = currentOsg(get());
      if (!osg) return;
      const crumbs = breadcrumbsFor(osg);
      const crumb = crumbs[index];
      if (!crumb || index === crumbs.length - 1) return;
      const { trail } = get();
      const at = trail.findIndex((o) => o.id === crumb.id);
      if (at >= 0) {
        inFlight?.abort();
        set({
          status: 'ready',
          error: null,
          trail: trail.slice(0, at + 1),
          selectedId: null,
          panelTab: 'summary',
          exploded: false,
        });
        return;
      }
      // Opened from a saved or shared child: the ancestor is not in memory yet.
      const again = () => get().goTo(index);
      run(set, async () => [await api.loadOsg(crumb.id)], again);
    },

    goUp: () => {
      const osg = currentOsg(get());
      if (!osg) return;
      const crumbs = breadcrumbsFor(osg);
      if (crumbs.length > 1) get().goTo(crumbs.length - 2);
    },

    toggleExplode: () => {
      const osg = currentOsg(get());
      if (sceneExplodable(osg?.scenes[0])) set((s) => ({ exploded: !s.exploded }));
    },

    zoomToFit: () => set((s) => ({ fitSignal: s.fitSignal + 1 })),

    setAudience: (audience) => set({ audience }),
    setPaletteId: (paletteId) => set({ paletteId }),
    setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    setViewMode: (viewMode) => set({ viewMode }),
    replaceCurrentOsg: (osg) =>
      set((state) => ({
        trail: state.trail.length > 0 ? [...state.trail.slice(0, -1), osg] : [osg],
        selectedId:
          state.selectedId &&
          osg.scenes.some((scene) => scene.nodes.some((n) => n.id === state.selectedId))
            ? state.selectedId
            : null,
      })),
    markPersisted: (osg) =>
      set((state) => ({
        persistedNodeIds: {
          ...state.persistedNodeIds,
          [osg.id]: persistedNodes(osg),
        },
      })),
    restoreSaved: (id) => {
      if (get().trail.length > 0) return;
      const again = () => get().restoreSaved(id);
      run(set, async () => [await api.loadOsg(id)], again);
    },
  }));
}
