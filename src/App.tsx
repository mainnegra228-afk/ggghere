import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  MousePointer2, PenLine, Speaker, Ear, PanelLeft, Undo2, Redo2, Share2, FolderOpen, Keyboard, Maximize, Waves,
  Radar, Map as MapIcon, Box, LayoutGrid, Activity, Headphones, Sparkles, SlidersHorizontal, Save, Download, Upload, Trash2, FilePlus2, X, Loader2,
} from 'lucide-react';
import { useStore, type Tab, type Tool, type View } from './state/store';
import { Stage } from './ui/Stage';
import { RoomPanel } from './ui/RoomPanel';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { ListenPanel } from './ui/ListenPanel';
import { AdvicePanel } from './ui/AdvicePanel';
import { shareLink } from './state/sim';
import { area, roomVolume } from './engine/geometry';
import { removeVertex, sanitizeRoom } from './engine/edit';
import { download } from './audio/engine';
import { PRESETS } from './engine/presets';
import { midT } from './engine/advisor';

const Room3D = lazy(() => import('./ui/Room3D'));

const TOOLS: { id: Tool; label: string; key: string; icon: typeof PenLine }[] = [
  { id: 'select', label: 'Select & move', key: 'V', icon: MousePointer2 },
  { id: 'draw', label: 'Draw room', key: 'D', icon: PenLine },
  { id: 'source', label: 'Place source', key: 'S', icon: Speaker },
  { id: 'listener', label: 'Place listener', key: 'L', icon: Ear },
  { id: 'panel', label: 'Mount panel', key: 'T', icon: PanelLeft },
];

const VIEWS: { id: View; label: string; icon: typeof Waves; hint: string }[] = [
  { id: 'plan', label: 'Plan', icon: LayoutGrid, hint: 'Floor plan with early reflection paths' },
  { id: 'waves', label: 'Waves', icon: Waves, hint: 'Live wave-equation simulation' },
  { id: 'rays', label: 'Rays', icon: Radar, hint: 'Sound particles bouncing in real time' },
  { id: 'bass', label: 'Bass map', icon: MapIcon, hint: 'Standing-wave map at one frequency' },
  { id: '3d', label: '3D', icon: Box, hint: 'Orbit the room in 3D' },
];

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'analysis', label: 'Analysis', icon: Activity },
  { id: 'listen', label: 'Listen', icon: Headphones },
  { id: 'advice', label: 'Advisor', icon: Sparkles },
  { id: 'room', label: 'Room', icon: SlidersHorizontal },
];

export default function App() {
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const tab = useStore((s) => s.tab);
  const set = useStore((s) => s.set);
  const onboarded = useStore((s) => s.onboarded);
  const [help, setHelp] = useState(false);

  useShortcuts(setHelp);

  return (
    <div className="app">
      <Header onHelp={() => setHelp(true)} />
      <nav className="rail" aria-label="Tools">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`rail-btn ${tool === t.id ? 'on' : ''}`} onClick={() => set({ tool: t.id })} aria-label={t.label} aria-pressed={tool === t.id} data-tip={`${t.label}  ${t.key}`}>
              <Icon size={18} strokeWidth={1.75} />
            </button>
          );
        })}
        <span className="rail-sep" />
        <button className="rail-btn" onClick={() => window.dispatchEvent(new Event('roomtone:fit'))} aria-label="Fit room to view" data-tip="Fit to view  F">
          <Maximize size={17} strokeWidth={1.75} />
        </button>
      </nav>
      <main className="stage-wrap">
        <div className="views" role="tablist" aria-label="Visualisation">
          {VIEWS.map((v, i) => {
            const Icon = v.icon;
            return (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => set({ view: v.id })} data-tip={`${v.hint}  ${i + 1}`}>
                <Icon size={14} /> <span>{v.label}</span>
              </button>
            );
          })}
        </div>
        {view === '3d' ? (
          <Suspense fallback={<div className="stage center"><Loader2 className="spin muted" /></div>}>
            <Room3D />
          </Suspense>
        ) : (
          <Stage />
        )}
        <QuickReadout />
      </main>
      <aside className="inspector">
        <div className="tabs" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        <div className="tab-scroll" key={tab}>
          {tab === 'room' && <RoomPanel />}
          {tab === 'analysis' && <AnalysisPanel />}
          {tab === 'listen' && <ListenPanel />}
          {tab === 'advice' && <AdvicePanel />}
        </div>
      </aside>
      <StatusBar />
      <Toasts />
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      {!onboarded && <Onboarding />}
    </div>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="logo-mark">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <circle cx="8" cy="15.5" r="2" fill="#ffa94d" />
      <path d="M8 10.5a5 5 0 0 1 5 5" fill="none" stroke="#ffa94d" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 6.5a9 9 0 0 1 9 9" fill="none" stroke="#ffa94d" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Header({ onHelp }: { onHelp: () => void }) {
  const room = useStore((s) => s.room);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setRoom = useStore((s) => s.setRoom);
  const toast = useStore((s) => s.toast);
  const [sharing, setSharing] = useState(false);

  return (
    <header className="header">
      <div className="brand"><Logo /><span className="wordmark">Roomtone</span></div>
      <span className="crumb-sep">/</span>
      <input
        className="project-name"
        value={room.name}
        onChange={(e) => setRoom({ ...room, name: e.target.value.slice(0, 80) }, false)}
        aria-label="Project name"
        spellCheck={false}
      />
      <div className="header-actions">
        <button className="icon-btn" onClick={undo} disabled={!past} aria-label="Undo" data-tip="Undo  Ctrl+Z"><Undo2 size={16} /></button>
        <button className="icon-btn" onClick={redo} disabled={!future} aria-label="Redo" data-tip="Redo  Ctrl+Shift+Z"><Redo2 size={16} /></button>
        <span className="vsep" />
        <ProjectsMenu />
        <button className="btn btn-ghost btn-sm" disabled={sharing} onClick={async () => {
          setSharing(true);
          try {
            const url = await shareLink(room);
            history.replaceState(null, '', url);
            try { await navigator.clipboard.writeText(url); toast('Share link copied — the whole room lives in the URL'); }
            catch { toast('Share link is in the address bar'); }
          } finally { setSharing(false); }
        }}><Share2 size={14} /> Share</button>
        <button className="icon-btn" onClick={onHelp} aria-label="Keyboard shortcuts" data-tip="Shortcuts  ?"><Keyboard size={16} /></button>
      </div>
    </header>
  );
}

function ProjectsMenu() {
  const [open, setOpen] = useState(false);
  const saved = useStore((s) => s.saved);
  const projectId = useStore((s) => s.projectId);
  const saveProject = useStore((s) => s.saveProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const loadRoom = useStore((s) => s.loadRoom);
  const toast = useStore((s) => s.toast);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}><FolderOpen size={14} /> Projects</button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => { saveProject(); toast('Project saved in this browser'); setOpen(false); }}><Save size={14} /> Save project <kbd>Ctrl S</kbd></button>
          <button role="menuitem" onClick={() => {
            const r = structuredClone(PRESETS[0].room);
            loadRoom({ ...r, name: 'Untitled room', wallMaterials: r.wallMaterials.map(() => 'drywall') });
            setOpen(false);
          }}><FilePlus2 size={14} /> New room</button>
          <button role="menuitem" onClick={() => {
            const room = useStore.getState().room;
            download(new Blob([JSON.stringify({ app: 'roomtone', version: 1, room }, null, 2)], { type: 'application/json' }), `${room.name.replace(/[^\w-]+/g, '-') || 'room'}.roomtone.json`);
            setOpen(false);
          }}><Download size={14} /> Export .json</button>
          <button role="menuitem" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import .json</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              const room = sanitizeRoom(data.room ?? data);
              if (!room) throw new Error();
              loadRoom(room);
              toast(`Imported “${room.name}”`);
            } catch { toast('That file is not a valid Roomtone project', 'error'); }
            setOpen(false);
          }} />
          {saved.length > 0 && <div className="menu-label">Saved in this browser</div>}
          {saved.map((p) => (
            <div key={p.id} className={`menu-item-row ${p.id === projectId ? 'on' : ''}`}>
              <button role="menuitem" onClick={() => { loadRoom(structuredClone(p.room), p.id); setOpen(false); }}>
                <span>{p.room.name}</span>
                <small>{new Date(p.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
              </button>
              <button className="icon-btn" aria-label={`Delete ${p.room.name}`} onClick={() => deleteProject(p.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickReadout() {
  const r = useStore((s) => s.analysis.result);
  const status = useStore((s) => s.analysis.status);
  const set = useStore((s) => s.set);
  if (!r) return null;
  const m = r.metrics;
  return (
    <button className={`quick ${status === 'running' ? 'busy' : ''}`} onClick={() => set({ tab: 'analysis' })} aria-label="Open analysis">
      <span><small>RT60</small><b>{midT(m).toFixed(2)}<i>s</i></b></span>
      <span><small>C50</small><b>{((m.c50[2] + m.c50[3]) / 2).toFixed(1)}<i>dB</i></b></span>
      <span><small>Bass</small><b>{(m.t30[0] ?? m.sabine[0]).toFixed(2)}<i>s</i></b></span>
      {status === 'running' && <Loader2 size={12} className="spin" />}
    </button>
  );
}

function StatusBar() {
  const room = useStore((s) => s.room);
  const tool = useStore((s) => s.tool);
  const r = useStore((s) => s.analysis.result);
  const hints: Record<Tool, string> = {
    select: 'Drag corners, walls, panels, source or listener · double-click a wall to add a corner · scroll to zoom',
    draw: 'Click to add corners · Enter or click the first corner to close',
    source: 'Click inside the room to place the sound source',
    listener: 'Click inside the room to place the listener',
    panel: 'Click a wall to mount a treatment panel',
  };
  return (
    <footer className="status">
      <span>{area(room.vertices).toFixed(1)} m² · {roomVolume(room).toFixed(0)} m³ · h {room.height.toFixed(2)} m</span>
      <span className="status-hint">{hints[tool]}</span>
      <span>{r ? `${r.stats.rays.toLocaleString()} rays · ${r.stats.detections.toLocaleString()} hits` : 'Simulating…'} · autosaved</span>
    </footer>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V / D / S / L / T', 'Select · Draw · Source · Listener · Panel'],
    ['1 – 5', 'Plan · Waves · Rays · Bass map · 3D'],
    ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
    ['Delete', 'Remove selected panel or corner'],
    ['F', 'Fit room to view'],
    ['Space + drag / middle drag', 'Pan'],
    ['Scroll / pinch', 'Zoom'],
    ['Alt while dragging', 'Disable snapping'],
    ['Double-click wall', 'Insert a corner'],
    ['Ctrl S', 'Save project'],
  ];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="modal-head"><h2>Shortcuts</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <dl className="keys">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
    </div>
  );
}

function Onboarding() {
  const set = useStore((s) => s.set);
  const loadRoom = useStore((s) => s.loadRoom);
  const start = (id: string, tab: Tab = 'analysis') => {
    const p = PRESETS.find((x) => x.id === id)!;
    loadRoom(structuredClone(p.room));
    set({ onboarded: true, tab });
  };
  return (
    <div className="modal-back hero-back">
      <div className="hero" role="dialog" aria-label="Welcome to Roomtone">
        <div className="hero-art" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 0.5}s` }} />)}
        </div>
        <span className="eyebrow">Acoustic simulator for real rooms</span>
        <h1>Draw a room.<br /><em>Hear</em> it before you build it.</h1>
        <p>Roomtone traces tens of thousands of sound rays through your floor plan, solves the wave equation for bass, and lets you listen to any sound as if you were standing inside — then tells you exactly where to put treatment.</p>
        <div className="hero-steps">
          <div><b>01</b><span>Sketch walls and pick materials</span></div>
          <div><b>02</b><span>Watch waves, rays and room modes</span></div>
          <div><b>03</b><span>Listen, measure, fix with one click</span></div>
        </div>
        <div className="hero-cta">
          <button className="btn btn-primary" onClick={() => start('bedroom-studio', 'advice')}>Fix a bedroom studio</button>
          <button className="btn btn-ghost" onClick={() => start('chapel', 'listen')}>Step into a stone chapel</button>
          <button className="btn btn-link" onClick={() => set({ onboarded: true })}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function useShortcuts(setHelp: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); s.saveProject(); s.toast('Project saved in this browser'); return; }
      if (mod || e.altKey) return;
      const k = e.key.toLowerCase();
      const tools: Record<string, Tool> = { v: 'select', d: 'draw', s: 'source', l: 'listener', t: 'panel' };
      if (tools[k] && s.tool !== 'draw') { s.set({ tool: tools[k] }); return; }
      if (k === 'escape') { s.set({ selection: null, tool: s.tool === 'draw' ? s.tool : 'select' }); return; }
      const views: View[] = ['plan', 'waves', 'rays', 'bass', '3d'];
      if (/^[1-5]$/.test(k)) { s.set({ view: views[+k - 1] }); return; }
      if (k === 'f') { window.dispatchEvent(new Event('roomtone:fit')); return; }
      if (k === '?') { setHelp(true); return; }
      if (k === 'delete' || k === 'backspace') {
        const sel = s.selection;
        if (sel?.kind === 'panel') { s.setRoom({ ...s.room, panels: s.room.panels.filter((p) => p.id !== sel.id) }); s.set({ selection: null }); }
        else if (sel?.kind === 'vertex') {
          const next = removeVertex(s.room, sel.index);
          if (next) { s.setRoom(next); s.set({ selection: null }); } else s.toast('A room needs at least 3 corners', 'warn');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setHelp]);
}
