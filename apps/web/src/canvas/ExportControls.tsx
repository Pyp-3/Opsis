import type { OSG } from '@opsis/schema';
import { t } from '@opsis/ui';
import { useState } from 'react';
import { downloadBlob, exportBaseName, osgGlb, osgJson, osgPng, osgSvg } from './export';

type Format = 'png' | 'svg' | 'glb' | 'json';

/** Toolbar export menu for every format required by M4. */
export function ExportControls({ osg }: { osg: OSG }) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: Format) => {
    setBusy(format);
    setError(null);
    try {
      const blob =
        format === 'json'
          ? osgJson(osg)
          : format === 'svg'
            ? osgSvg(osg)
            : format === 'png'
              ? await osgPng(osg)
              : await osgGlb(osg);
      downloadBlob(blob, `${exportBaseName(osg)}.${format}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="opsis-export" role="group" aria-label={t('export.group')}>
      {(['png', 'svg', 'glb', 'json'] as const).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(format)}
          aria-label={t('export.action', { format: format.toUpperCase() })}
        >
          {busy === format ? t('export.inProgress') : format.toUpperCase()}
        </button>
      ))}
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}
