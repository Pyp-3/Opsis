/** Native capabilities are present only inside the Wails window. Browser builds
 * keep their normal HTTP transport, downloads, and clipboard behavior. */
type DesktopBridge = {
  CancelRequest(id: string): Promise<void>;
  SaveFile(name: string, base64: string): Promise<boolean>;
  CopyText(text: string): Promise<void>;
  // Windows desktop builds only; older or Linux hosts may not provide them.
  CheckForUpdate?(): Promise<UpdateStatus>;
  InstallUpdate?(): Promise<void>;
  OpenUpdatePage?(): Promise<void>;
};

export type UpdateStatus = {
  supported: boolean;
  available: boolean;
  current: string;
  version: string;
  /** False for portable copies, which can only open the release page. */
  canInstall: boolean;
};

export type DesktopUpdates = {
  check(): Promise<UpdateStatus>;
  install(): Promise<void>;
  openPage(): Promise<void>;
};

/** The native updater, when this window is a desktop build that has one. */
export function desktopUpdates(): DesktopUpdates | undefined {
  const native = bridge();
  const { CheckForUpdate, InstallUpdate, OpenUpdatePage } = native ?? {};
  if (!native || !CheckForUpdate || !InstallUpdate || !OpenUpdatePage) return undefined;
  return {
    check: () => CheckForUpdate.call(native),
    install: () => InstallUpdate.call(native),
    openPage: () => OpenUpdatePage.call(native),
  };
}

function bridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { go?: { main?: { Desktop?: DesktopBridge } } }).go?.main?.Desktop;
}

export async function saveBlob(blob: Blob, name: string): Promise<void> {
  const native = bridge();
  if (native) {
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The export could not be read.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(blob);
    });
    await native.SaveFile(name, encoded);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<void> {
  const native = bridge();
  return native ? native.CopyText(text) : navigator.clipboard.writeText(text);
}

/** WebKit custom-scheme fetch cancellation needs an explicit native signal.
 * Keep Response streaming intact so NDJSON progress and audio use the same code. */
export function installDesktopTransport() {
  const native = bridge();
  if (!native) return;
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(url, location.href);
    if (
      target.protocol !== location.protocol ||
      target.host !== location.host ||
      !target.pathname.startsWith('/v1/')
    )
      return fetch(input, init);
    const id = crypto.randomUUID();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('X-Opsis-Request-ID', id);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const cancel = () => void native.CancelRequest(id).catch(() => undefined);
    signal?.addEventListener('abort', cancel, { once: true });
    // Keep the listener through body consumption: fetch resolves at headers, before
    // an agent stream completes. The signal and listener can be collected together.
    return fetch(input, { ...init, headers }).catch((error: unknown) => {
      signal?.removeEventListener('abort', cancel);
      throw error;
    });
  };
}

installDesktopTransport();
