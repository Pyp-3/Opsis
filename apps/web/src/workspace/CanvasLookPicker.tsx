import { useEffect, useRef, useState } from 'react';
import { Check, Palette, Shapes } from 'lucide-react';
import {
  CANVAS_PALETTES,
  DEFAULT_LOOK,
  ICON_COLORS,
  paletteOf,
  setCanvasLook,
  useCanvasLook,
} from './canvas-theme';

/** Canvas background and icon colour choices; a preference for this browser only. */
export function CanvasLookPicker() {
  const look = useCanvasLook();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const deep = paletteOf(look).deep;
  const changed = look.canvas !== DEFAULT_LOOK.canvas || look.icon !== DEFAULT_LOOK.icon;
  return (
    <div className="look-picker" ref={root}>
      <button
        ref={trigger}
        aria-label="Canvas colours"
        title="Canvas colours"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Palette size={16} />
      </button>
      {open && (
        <div className="look-panel" role="dialog" aria-label="Canvas colours">
          <fieldset>
            <legend>Background</legend>
            <div className="look-backgrounds">
              {CANVAS_PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  aria-pressed={look.canvas === palette.id}
                  style={{
                    ['--swatch-from' as string]: palette.background[0],
                    ['--swatch-to' as string]: palette.background[2],
                    ['--swatch-ink' as string]: palette.ink,
                  }}
                  onClick={() => setCanvasLook({ ...look, canvas: palette.id })}
                >
                  <span className="look-background-swatch" aria-hidden>
                    {look.canvas === palette.id && <Check size={14} />}
                  </span>
                  <span>{palette.name}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Icons</legend>
            <div className="look-icons">
              {ICON_COLORS.map((icon) => (
                <button
                  key={icon.id}
                  aria-label={icon.name}
                  title={icon.name}
                  aria-pressed={look.icon === icon.id}
                  style={{
                    ['--swatch' as string]: icon.color,
                    ['--swatch-bg' as string]: deep,
                  }}
                  onClick={() => setCanvasLook({ ...look, icon: icon.id })}
                >
                  <Shapes size={16} aria-hidden />
                </button>
              ))}
            </div>
          </fieldset>
          <footer>
            <small>Saved in this browser</small>
            <button disabled={!changed} onClick={() => setCanvasLook(DEFAULT_LOOK)}>
              Reset
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
