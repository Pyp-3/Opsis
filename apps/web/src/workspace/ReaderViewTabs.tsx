import { BookOpen, Workflow } from 'lucide-react';

/**
 * Canvas or Info, for people who only view a shared board: the same page as a diagram or read as
 * a page of a book.
 */
export function ReaderViewTabs({
  view,
  onView,
}: {
  view: 'canvas' | 'info';
  onView: (view: 'canvas' | 'info') => void;
}) {
  const views = [
    { id: 'canvas' as const, name: 'Canvas', Icon: Workflow },
    { id: 'info' as const, name: 'Info', Icon: BookOpen },
  ];
  return (
    <div className="workspace-tabs reader-view-tabs" role="tablist" aria-label="Board views">
      {views.map(({ id, name, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          tabIndex={view === id ? 0 : -1}
          onClick={() => onView(id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const next = id === 'canvas' ? 'info' : 'canvas';
            onView(next);
            (
              event.currentTarget.parentElement?.querySelector(
                `[role="tab"]:not([aria-selected="true"])`,
              ) as HTMLElement | null
            )?.focus();
          }}
        >
          <Icon size={15} aria-hidden />
          <span className="tab-label">{name}</span>
        </button>
      ))}
    </div>
  );
}
