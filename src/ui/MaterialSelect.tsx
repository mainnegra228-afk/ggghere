import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { MATERIALS, material } from '../engine/materials';
import type { Material } from '../engine/types';

export function AlphaSpark({ m, w = 42, h = 16 }: { m: Material; w?: number; h?: number }) {
  const bw = w / 6;
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      {m.alpha.map((a, i) => (
        <rect key={i} x={i * bw + 0.5} width={bw - 1.5} y={h - Math.max(1, a * h)} height={Math.max(1, a * h)} rx={1} />
      ))}
    </svg>
  );
}

export function MaterialSelect({ value, onChange, filter, label }: { value: string; onChange: (id: string) => void; filter?: (m: Material) => boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 280, up: false });
  const m = material(value);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const up = r.bottom + 420 > window.innerHeight && r.top > 420;
    setPos({ left: Math.min(r.left, window.innerWidth - width - 8), top: up ? r.top - 6 : r.bottom + 6, width, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const list = MATERIALS.filter((x) => (filter ? filter(x) : true));
  const groups = [...new Set(list.map((x) => x.group))];

  return (
    <>
      <button ref={btn} className="mat-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label ?? 'Material'}>
        <i className="swatch" style={{ background: m.color }} />
        <span className="mat-name">{m.name}</span>
        <AlphaSpark m={m} />
        <ChevronDown size={14} className="muted" />
      </button>
      {open && createPortal(
        <div
          ref={pop}
          className="mat-pop"
          role="listbox"
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
        >
          {groups.map((g) => (
            <div key={g} className="mat-group">
              <div className="mat-group-label">{g}</div>
              {list.filter((x) => x.group === g).map((x) => (
                <button key={x.id} role="option" aria-selected={x.id === value} className={`mat-opt ${x.id === value ? 'on' : ''}`} onClick={() => { onChange(x.id); setOpen(false); }}>
                  <i className="swatch" style={{ background: x.color }} />
                  <span className="mat-name">{x.name}</span>
                  <span className="mat-nrc" title="Noise reduction coefficient (avg. 250–2k Hz)">{((x.alpha[1] + x.alpha[2] + x.alpha[3] + x.alpha[4]) / 4).toFixed(2)}</span>
                  <AlphaSpark m={x} />
                  {x.id === value ? <Check size={13} /> : <span style={{ width: 13 }} />}
                </button>
              ))}
            </div>
          ))}
          <div className="mat-foot">Bars: absorption at 125 · 250 · 500 · 1k · 2k · 4k Hz</div>
        </div>,
        document.body,
      )}
    </>
  );
}
