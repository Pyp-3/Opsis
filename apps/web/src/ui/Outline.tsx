import type { OSG, PositionedScene } from '@opsis/schema';
import { t } from '@opsis/ui';
import { useId, type KeyboardEvent } from 'react';
import { nodeInfo } from '../scene/model';
import type { Level } from '../state/session';

type Props = {
  osg: OSG;
  scene: PositionedScene;
  selectedId: string | null;
  onSelect: (nodeId: string, tab: Level) => void;
  onHover: (nodeId: string | null) => void;
};

/**
 * "Diagram as list" (PROMPT.md §12.2): a text mirror of the scene. Each node is a button
 * named by its label and described by its summary; Tab moves between nodes, Enter opens the
 * summary and Shift+Enter the explanation. Connections are listed in words underneath.
 */
export function Outline({ osg, scene, selectedId, onSelect, onHover }: Props) {
  const headingId = useId();
  const descPrefix = useId();
  const labels = new Map(scene.nodes.map((n) => [n.id, n.label]));
  const connections = scene.edges.filter((e) => e.kind !== 'leader');

  const onKeyDown = (nodeId: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      onSelect(nodeId, 'explanation');
    }
  };

  return (
    <nav className="opsis-outline" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('outline.title')}</h3>
      <ul>
        {scene.nodes.map((node) => {
          const descId = `${descPrefix}-${scene.nodes.indexOf(node)}`;
          return (
            <li key={node.id}>
              <button
                type="button"
                data-node-id={node.id}
                aria-pressed={selectedId === node.id}
                aria-describedby={descId}
                aria-keyshortcuts={node.drillable ? 'Enter Shift+Enter O' : 'Enter Shift+Enter'}
                onClick={() => onSelect(node.id, 'summary')}
                onKeyDown={onKeyDown(node.id)}
                onFocus={() => onHover(node.id)}
                onBlur={() => onHover(null)}
                onMouseEnter={() => onHover(node.id)}
                onMouseLeave={() => onHover(null)}
              >
                <span>
                  {node.label}
                  {node.role === 'anchor' ? (
                    <span className="opsis-muted"> ({t('outline.anchor')})</span>
                  ) : null}
                </span>
                {node.optional ? (
                  <span className="opsis-badge">{t('outline.optional')}</span>
                ) : null}
              </button>
              <span id={descId} className="opsis-visually-hidden">
                {nodeInfo(osg, node).summary}
              </span>
            </li>
          );
        })}
      </ul>
      {connections.length > 0 ? (
        <>
          <h4>{t('outline.relations')}</h4>
          <ul className="opsis-outline__relations">
            {connections.map((edge) => (
              <li key={edge.id}>
                {t(edge.label ? 'outline.relationLabelled' : 'outline.relation', {
                  from: labels.get(edge.from) ?? edge.from,
                  verb: t(`edge.${edge.kind as Exclude<typeof edge.kind, 'leader'>}`),
                  to: labels.get(edge.to) ?? edge.to,
                  label: edge.label ?? '',
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
