import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AcousticMetrics, Panel, ReflectionPath, Room } from '../engine/types';
import type { RoomUse } from '../engine/advisor';
import type { BassMap, BassResponse } from '../engine/fdtd';
import { defaultRoom } from '../engine/presets';
import { uid } from '../engine/edit';

export type Tool = 'select' | 'draw' | 'source' | 'listener' | 'panel';
export type View = 'plan' | 'waves' | 'rays' | 'bass' | '3d';
export type Tab = 'room' | 'analysis' | 'listen' | 'advice';
export type Quality = 'draft' | 'standard' | 'high';
export const RAYS: Record<Quality, number> = { draft: 4000, standard: 12000, high: 40000 };

export type Selection =
  | { kind: 'vertex'; index: number }
  | { kind: 'wall'; index: number }
  | { kind: 'panel'; id: string }
  | { kind: 'source' }
  | { kind: 'listener' }
  | null;

export interface AnalysisResult {
  metrics: AcousticMetrics;
  edc: { step: number; curves: number[][] };
  ir: Float32Array;
  reflections: ReflectionPath[];
  stats: { rays: number; reflections: number; detections: number; ms: number };
  directTime: number;
  directEnergy: number;
  sampleRate: number;
}

type Status = 'idle' | 'running' | 'done' | 'error';

export interface SavedProject {
  id: string;
  room: Room;
  updated: number;
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'ok' | 'warn' | 'error';
}

interface State {
  room: Room;
  past: Room[];
  future: Room[];
  selection: Selection;
  tool: Tool;
  view: View;
  tab: Tab;
  use: RoomUse;
  quality: Quality;
  panelMaterial: string;
  bassFreq: number;
  showPaths: boolean;
  onboarded: boolean;
  saved: SavedProject[];
  projectId: string;
  fitNonce: number;

  analysis: { status: Status; progress: number; result?: AnalysisResult; error?: string; roomKey?: string };
  bass: { status: Status; result?: BassResponse; error?: string };
  bassMap: { status: Status; result?: BassMap; error?: string };
  toasts: Toast[];

  setRoom: (room: Room, record?: boolean) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  loadRoom: (room: Room, projectId?: string) => void;
  addPanels: (panels: Omit<Panel, 'id'>[]) => void;
  set: (patch: Partial<State>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  saveProject: () => void;
  deleteProject: (id: string) => void;
}

const HISTORY = 80;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      room: defaultRoom(),
      past: [],
      future: [],
      selection: null,
      tool: 'select',
      view: 'plan',
      tab: 'analysis',
      use: 'studio',
      quality: 'standard',
      panelMaterial: 'absorber-100',
      bassFreq: 60,
      showPaths: true,
      onboarded: false,
      saved: [],
      projectId: uid("proj"),
      fitNonce: 0,
      analysis: { status: 'idle', progress: 0 },
      bass: { status: 'idle' },
      bassMap: { status: 'idle' },
      toasts: [],

      setRoom: (room, record = true) =>
        set((s) => (record ? { room, past: [...s.past, s.room].slice(-HISTORY), future: [] } : { room })),
      checkpoint: () => set((s) => ({ past: [...s.past, s.room].slice(-HISTORY), future: [] })),
      undo: () =>
        set((s) => {
          const prev = s.past[s.past.length - 1];
          if (!prev) return s;
          return { room: prev, past: s.past.slice(0, -1), future: [s.room, ...s.future], selection: null };
        }),
      redo: () =>
        set((s) => {
          const next = s.future[0];
          if (!next) return s;
          return { room: next, future: s.future.slice(1), past: [...s.past, s.room], selection: null };
        }),
      loadRoom: (room, projectId) =>
        set((s) => ({ room, past: [...s.past, s.room].slice(-HISTORY), future: [], selection: null, projectId: projectId ?? uid("proj"), fitNonce: s.fitNonce + 1 })),
      addPanels: (panels) => {
        if (!panels.length) return;
        const s = get();
        s.setRoom({ ...s.room, panels: [...s.room.panels, ...panels.map((p) => ({ ...p, id: uid() }))] });
      },
      set: (patch) => set(patch),
      toast: (text, tone = 'ok') => {
        const id = Date.now() + Math.random();
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-4) }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3600);
      },
      saveProject: () => {
        const s = get();
        const entry = { id: s.projectId, room: s.room, updated: Date.now() };
        set({ saved: [entry, ...s.saved.filter((p) => p.id !== s.projectId)].slice(0, 50) });
      },
      deleteProject: (id) => set((s) => ({ saved: s.saved.filter((p) => p.id !== id) })),
    }),
    {
      name: 'roomtone:v1',
      partialize: (s) => ({
        room: s.room,
        use: s.use,
        quality: s.quality,
        panelMaterial: s.panelMaterial,
        showPaths: s.showPaths,
        onboarded: s.onboarded,
        saved: s.saved,
        projectId: s.projectId,
        bassFreq: s.bassFreq,
        tab: s.tab,
      }),
    },
  ),
);

export const selectedPanel = (s: { room: Room; selection: Selection }) =>
  s.selection?.kind === 'panel' ? s.room.panels.find((p) => p.id === (s.selection as { id: string }).id) : undefined;
