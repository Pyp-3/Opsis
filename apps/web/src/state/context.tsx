import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createSessionStore, type SessionState, type SessionStore } from './session';

const SessionContext = createContext<SessionStore | null>(null);

/** Provides one session store to the app; pass `store` in tests to inject a fake API. */
export function SessionProvider({
  store,
  children,
}: {
  store?: SessionStore;
  children: ReactNode;
}) {
  const [value] = useState(() => store ?? createSessionStore());
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The raw store, for event handlers that read state without subscribing. */
export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSession must be used inside <SessionProvider>');
  return store;
}

/** Reads a slice of the session state, re-rendering when it changes. */
export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(useSessionStore(), selector);
}
