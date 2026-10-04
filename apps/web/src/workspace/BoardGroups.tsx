import { useState } from 'react';
import { ChevronDown, Group } from 'lucide-react';
import { ViewportPortal } from '@xyflow/react';
import { BoardDocumentSchema, groupMembers, visibleBoard, type BoardDocument } from '@opsis/schema';
import { NODE_WIDTH, nodeHeight } from './geometry';

export function GroupBoundaries({ board }: { board: BoardDocument }) {
  const visible = visibleBoard(board);
  return (
    <ViewportPortal>
      <div className="group-boundaries" aria-hidden="true">
        {board.groups
          ?.filter((group) => group.boundary && !group.collapsed)
          .map((group) => {
            const ids = groupMembers(board, group.id);
            const members = visible.nodes.filter(
              (node) => ids.includes(node.id) && board.positions[node.id],
            );
            if (!members.length) return null;
            const left = Math.min(...members.map((node) => board.positions[node.id]!.x)) - 18;
            const top = Math.min(...members.map((node) => board.positions[node.id]!.y)) - 30;
            const right =
              Math.max(...members.map((node) => board.positions[node.id]!.x + NODE_WIDTH)) + 18;
            const bottom =
              Math.max(...members.map((node) => board.positions[node.id]!.y + nodeHeight(node))) +
              18;
            return (
              <div
                className="group-boundary"
                key={group.id}
                style={{ left, top, width: right - left, height: bottom - top }}
              >
                <span>{group.label}</span>
              </div>
            );
          })}
      </div>
    </ViewportPortal>
  );
}

export function BoardGroups({
  board,
  disabled,
  commit,
}: {
  board: BoardDocument;
  disabled: boolean;
  commit: (board: BoardDocument) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const groups = board.groups ?? [];
  const group = groups.find((item) => item.id === selected);
  function update(next: NonNullable<BoardDocument['groups']>) {
    const parsed = BoardDocumentSchema.safeParse({ ...board, groups: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid group.');
      return;
    }
    commit(parsed.data);
    setError('');
  }
  function patch(value: Partial<NonNullable<typeof group>>) {
    update(groups.map((item) => (item.id === selected ? { ...item, ...value } : item)));
  }
  return (
    <details className="header-menu board-groups">
      <GroupsSummary />
      <div className="header-menu-panel group-controls">
        <p className="header-menu-title">Groups and subgraphs</p>
        <label>
          New group name
          <input
            value={name}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          disabled={disabled || !name.trim() || groups.length >= 20}
          onClick={() => {
            const id = crypto.randomUUID();
            update([
              ...groups,
              { id, label: name.trim(), nodeIds: [], collapsed: false, boundary: false },
            ]);
            setSelected(id);
            setName('');
          }}
        >
          Add group
        </button>
        <label>
          Choose group
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Select a group…</option>
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {group && (
          <fieldset disabled={disabled}>
            <label>
              Group label
              <input
                key={group.id + group.label}
                defaultValue={group.label}
                maxLength={80}
                onBlur={(event) => {
                  if (event.target.value.trim() && event.target.value.trim() !== group.label)
                    patch({ label: event.target.value.trim() });
                }}
              />
            </label>
            <label>
              Parent group
              <select
                value={group.parentId ?? ''}
                onChange={(event) => patch({ parentId: event.target.value || undefined })}
              >
                <option value="">None</option>
                {groups
                  .filter((item) => item.id !== group.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={group.collapsed}
                onChange={(event) => patch({ collapsed: event.target.checked })}
              />
              Collapse subgraph
            </label>
            <label>
              <input
                type="checkbox"
                checked={group.boundary}
                onChange={(event) => patch({ boundary: event.target.checked })}
              />
              Show group boundary
            </label>
            <p>
              Each concept belongs directly to one group. Nested groups include their descendants.
            </p>
            {board.nodes.map((node) => (
              <label key={node.id}>
                <input
                  type="checkbox"
                  checked={group.nodeIds.includes(node.id)}
                  onChange={(event) =>
                    update(
                      groups.map((item) => ({
                        ...item,
                        nodeIds:
                          item.id === group.id && event.target.checked
                            ? [...item.nodeIds.filter((id) => id !== node.id), node.id]
                            : item.nodeIds.filter((id) => id !== node.id),
                      })),
                    )
                  }
                />
                {node.label}
              </label>
            ))}
            <button
              onClick={() => {
                update(
                  groups
                    .filter((item) => item.id !== group.id)
                    .map((item) =>
                      item.parentId === group.id ? { ...item, parentId: group.parentId } : item,
                    ),
                );
                setSelected('');
              }}
            >
              Remove group (keep concepts)
            </button>
          </fieldset>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}

export function GroupsSummary() {
  return (
    <summary aria-label="Groups and subgraphs" title="Groups and subgraphs">
      <Group size={15} aria-hidden /> <span className="button-label">Groups</span>
      <ChevronDown className="chevron" size={14} aria-hidden />
    </summary>
  );
}
