import { useState } from 'react';
import { Trash2, Plus, Ruler, ArrowUpFromLine, Square, Layers } from 'lucide-react';
import { useStore, selectedPanel } from '../state/store';
import { PRESETS } from '../engine/presets';
import { area, dist, roomVolume, wallLength, DEFAULT_PANEL_HEIGHT } from '../engine/geometry';
import { removeVertex, setWallLength, uid } from '../engine/edit';
import { material } from '../engine/materials';
import { MaterialSelect } from './MaterialSelect';
import { firstReflectionPoint } from '../engine/reflections';

function NumberField({ value, onCommit, min, max, step = 0.05, suffix, label }: { value: number; onCommit: (v: number) => boolean | void; min: number; max: number; step?: number; suffix: string; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(v) || v < min || v > max || onCommit(v) === false) { setBad(true); setTimeout(() => setBad(false), 600); }
    setDraft(null);
  };
  return (
    <label className={`num ${bad ? 'shake' : ''}`}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft ?? value.toFixed(2)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? step : -step)));
            onCommit(Math.round(v * 100) / 100);
          }
        }}
        step={step}
      />
      <span>{suffix}</span>
    </label>
  );
}

export function RoomPanel() {
  const room = useStore((s) => s.room);
  const selection = useStore((s) => s.selection);
  const setRoom = useStore((s) => s.setRoom);
  const set = useStore((s) => s.set);
  const loadRoom = useStore((s) => s.loadRoom);
  const toast = useStore((s) => s.toast);
  const panelMaterial = useStore((s) => s.panelMaterial);
  const panel = useStore(selectedPanel);
  const wallSel = selection?.kind === 'wall' ? selection.index : panel ? panel.wall : null;

  const fl = area(room.vertices);
  const addPanelOn = (w: number) => {
    const L = wallLength(room, w);
    const t = firstReflectionPoint(room, w) ?? 0.5;
    const half = Math.min(0.5, 0.6 / L);
    const c = Math.min(1 - half, Math.max(half, t));
    const id = uid();
    setRoom({ ...room, panels: [...room.panels, { id, wall: w, t0: c - half, t1: c + half, material: panelMaterial }] });
    set({ selection: { kind: 'panel', id } });
  };

  return (
    <div className="panel-body">
      <section>
        <h3>Start from a template</h3>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="preset" onClick={() => { loadRoom(structuredClone(p.room)); toast(`Loaded “${p.name}”`); }}>
              <PresetGlyph vertices={p.room.vertices} />
              <span className="preset-name">{p.name}</span>
              <span className="preset-blurb">{p.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Room</h3>
        <div className="kv-grid">
          <div><span>Floor area</span><b>{fl.toFixed(1)} m²</b></div>
          <div><span>Volume</span><b>{roomVolume(room).toFixed(0)} m³</b></div>
          <div><span>Walls</span><b>{room.vertices.length}</b></div>
        </div>
        <div className="field-row">
          <span className="field-label"><ArrowUpFromLine size={13} /> Ceiling height</span>
          <NumberField label="Ceiling height" value={room.height} min={2} max={30} step={0.1} suffix="m" onCommit={(v) => setRoom({ ...room, height: v })} />
        </div>
        <div className="field-row">
          <span className="field-label"><Square size={13} /> Floor</span>
          <MaterialSelect label="Floor material" value={room.floor} onChange={(id) => setRoom({ ...room, floor: id })} />
        </div>
        <div className="field-row">
          <span className="field-label"><Layers size={13} /> Ceiling</span>
          <MaterialSelect label="Ceiling material" value={room.ceiling} onChange={(id) => setRoom({ ...room, ceiling: id })} />
        </div>
      </section>

      <section>
        <h3>Walls <span className="h-hint">click a wall on the plan · double-click to add a corner</span></h3>
        <div className="walls">
          {room.vertices.map((_, i) => {
            const L = wallLength(room, i);
            const panels = room.panels.filter((p) => p.wall === i);
            const open = wallSel === i;
            return (
              <div key={i} className={`wall ${open ? 'open' : ''}`}>
                <button className="wall-head" onClick={() => set({ selection: open ? null : { kind: 'wall', index: i } })}>
                  <i className="swatch" style={{ background: material(room.wallMaterials[i]).color }} />
                  <span className="wall-id">W{i + 1}</span>
                  <span className="wall-mat">{material(room.wallMaterials[i]).name}</span>
                  {panels.length > 0 && <span className="pill">{panels.length} panel{panels.length > 1 ? 's' : ''}</span>}
                  <span className="wall-len">{L.toFixed(2)} m</span>
                </button>
                {open && (
                  <div className="wall-body">
                    <div className="field-row">
                      <span className="field-label"><Ruler size={13} /> Length</span>
                      <NumberField
                        label={`Wall ${i + 1} length`}
                        value={L}
                        min={0.3}
                        max={200}
                        suffix="m"
                        onCommit={(v) => {
                          const next = setWallLength(room, i, v);
                          if (!next) { toast('That length would make walls cross', 'warn'); return false; }
                          setRoom(next);
                        }}
                      />
                    </div>
                    <div className="field-row">
                      <span className="field-label">Surface</span>
                      <MaterialSelect label={`Wall ${i + 1} material`} value={room.wallMaterials[i]} onChange={(id) => setRoom({ ...room, wallMaterials: room.wallMaterials.map((m, k) => (k === i ? id : m)) })} />
                    </div>
                    {panels.map((p) => {
                      const width = (p.t1 - p.t0) * L;
                      const active = panel?.id === p.id;
                      return (
                        <div key={p.id} className={`panel-row ${active ? 'on' : ''}`} onClick={() => set({ selection: { kind: 'panel', id: p.id } })}>
                          <MaterialSelect label="Panel material" value={p.material} onChange={(id) => setRoom({ ...room, panels: room.panels.map((x) => (x.id === p.id ? { ...x, material: id } : x)) })} />
                          <NumberField
                            label="Panel width"
                            value={width}
                            min={0.1}
                            max={L}
                            suffix="w"
                            onCommit={(v) => {
                              const c = (p.t0 + p.t1) / 2;
                              const half = Math.min(0.5, v / L / 2);
                              const cc = Math.min(1 - half, Math.max(half, c));
                              setRoom({ ...room, panels: room.panels.map((x) => (x.id === p.id ? { ...x, t0: cc - half, t1: cc + half } : x)) });
                            }}
                          />
                          <NumberField
                            label="Panel height"
                            value={Math.min(room.height, p.height ?? DEFAULT_PANEL_HEIGHT)}
                            min={0.1}
                            max={room.height}
                            suffix="h"
                            onCommit={(v) => setRoom({ ...room, panels: room.panels.map((x) => (x.id === p.id ? { ...x, height: v } : x)) })}
                          />
                          <button className="icon-btn" aria-label="Remove panel" title="Remove panel" onClick={(e) => { e.stopPropagation(); setRoom({ ...room, panels: room.panels.filter((x) => x.id !== p.id) }); set({ selection: { kind: 'wall', index: i } }); }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                    <button className="btn btn-ghost btn-sm" onClick={() => addPanelOn(i)}><Plus size={14} /> Mount panel{firstReflectionPoint(room, i) !== null ? ' at reflection point' : ''}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {selection?.kind === 'vertex' && (
          <button className="btn btn-ghost btn-sm danger" onClick={() => {
            const next = removeVertex(room, selection.index);
            if (!next) { toast('Cannot remove this corner', 'warn'); return; }
            setRoom(next); set({ selection: null });
          }}><Trash2 size={14} /> Remove corner {selection.index + 1}</button>
        )}
      </section>

      <section>
        <h3>Panel tool material</h3>
        <MaterialSelect label="Default panel material" value={panelMaterial} onChange={(id) => set({ panelMaterial: id })} filter={(m) => m.group === 'Treatment' || m.group === 'Furnishing' || m.group === 'Surface'} />
        <p className="note">Press <kbd>T</kbd> and click any wall to mount it. Drag panels along walls to reposition.</p>
      </section>

      <section className="positions">
        <div><span className="dot src" /> Source <b>{room.source.x.toFixed(2)}, {room.source.y.toFixed(2)}</b></div>
        <div><span className="dot lis" /> Listener <b>{room.listener.x.toFixed(2)}, {room.listener.y.toFixed(2)}</b></div>
        <div>Distance <b>{dist(room.source, room.listener).toFixed(2)} m</b></div>
      </section>
    </div>
  );
}

function PresetGlyph({ vertices }: { vertices: { x: number; y: number }[] }) {
  const xs = vertices.map((v) => v.x), ys = vertices.map((v) => v.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const s = 26 / Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  const d = vertices.map((v, i) => `${i ? 'L' : 'M'}${(v.x - minX) * s + 3},${(v.y - minY) * s + 3}`).join('') + 'Z';
  return <svg width={32} height={32} className="preset-glyph" aria-hidden><path d={d} /></svg>;
}


