import { useEffect, useState } from 'react';
import { InstanceInfoSchema, LOCAL_INSTANCE, type InstanceInfo } from '@opsis/schema';

/** What this Opsis host allows; a host without `/v1/instance` is a local install. */
export async function loadInstance(): Promise<InstanceInfo> {
  try {
    const response = await fetch('/v1/instance');
    return response.ok ? InstanceInfoSchema.parse(await response.json()) : LOCAL_INSTANCE;
  } catch {
    return LOCAL_INSTANCE;
  }
}

/** The host's capabilities, or null until they have loaded. */
export function useInstance() {
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  useEffect(() => {
    let live = true;
    void loadInstance().then((value) => live && setInstance(value));
    return () => {
      live = false;
    };
  }, []);
  return instance;
}
