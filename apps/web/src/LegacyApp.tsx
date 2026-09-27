import { SessionProvider } from './state/context';
import type { SessionStore } from './state/session';
import { AppShell } from './ui/AppShell';

/** Root component: one session store around the app shell. */
export function LegacyApp({ store }: { store?: SessionStore }) {
  return (
    <SessionProvider {...(store ? { store } : {})}>
      <AppShell />
    </SessionProvider>
  );
}
