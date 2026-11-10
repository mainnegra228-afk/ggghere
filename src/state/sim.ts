import { useStore, type AnalysisResult } from './store';
import { JobRunner, Cancelled } from '../workers/client';
import { audio } from '../audio/engine';
import type { BassMap, BassResponse } from '../engine/fdtd';
import { RAYS } from './store';
import { sanitizeRoom } from '../engine/edit';
import type { Room } from '../engine/types';
import { absorptionArea, roomVolume } from '../engine/geometry';

const tracer = new JobRunner<AnalysisResult>();
const bassRunner = new JobRunner<BassResponse>();
const mapRunner = new JobRunner<BassMap>();

let timers: Record<string, ReturnType<typeof setTimeout>> = {};
const debounce = (key: string, ms: number, fn: () => void) => {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
};

const acousticKey = (r: Room) => JSON.stringify([r.vertices, r.wallMaterials, r.panels, r.floor, r.ceiling, r.height, r.source, r.listener]);
const bassKey = (r: Room) => JSON.stringify([r.vertices, r.wallMaterials, r.panels, r.height, r.source, r.listener]);

/** Wires store changes to the background simulations. Call once at startup. */
export function startSimulations() {
  let lastTrace = '', lastBass = '', lastMap = '';
  const run = () => {
    const s = useStore.getState();
    const key = acousticKey(s.room) + s.quality;
    if (key !== lastTrace) {
      lastTrace = key;
      debounce('trace', s.analysis.result ? 160 : 0, () => {
        const st = useStore.getState();
        useStore.setState({ analysis: { ...st.analysis, status: 'running', progress: 0 } });
        tracer
          .run({ type: 'trace', room: st.room, rays: RAYS[st.quality], sampleRate: audio.sampleRate }, (p) => {
            const a = useStore.getState().analysis;
            useStore.setState({ analysis: { ...a, progress: p } });
          })
          .then((result) => {
            useStore.setState({ analysis: { status: 'done', progress: 1, result } });
            audio.setIR(result.ir);
          })
          .catch((e) => {
            if (e instanceof Cancelled) return;
            useStore.setState({ analysis: { ...useStore.getState().analysis, status: 'error', error: e.message } });
          });
      });
    }
    const bk = bassKey(s.room);
    if (bk !== lastBass) {
      lastBass = bk;
      debounce('bass', 450, () => {
        useStore.setState({ bass: { ...useStore.getState().bass, status: 'running' } });
        bassRunner
          .run({ type: 'bass', room: useStore.getState().room })
          .then((result) => useStore.setState({ bass: { status: 'done', result } }))
          .catch((e) => { if (!(e instanceof Cancelled)) useStore.setState({ bass: { status: 'error', error: e.message } }); });
      });
    }
    if (s.view === 'bass') {
      const mk = bk + s.bassFreq;
      if (mk !== lastMap) {
        lastMap = mk;
        debounce('map', 120, () => {
          const st = useStore.getState();
          const V = roomVolume(st.room);
          const A = absorptionArea(st.room);
          const settle = (0.161 * V) / Math.max(0.5, A[0]);
          useStore.setState({ bassMap: { ...st.bassMap, status: 'running' } });
          mapRunner
            .run({ type: 'bassmap', room: st.room, freq: st.bassFreq, settle })
            .then((result) => useStore.setState({ bassMap: { status: 'done', result } }))
            .catch((e) => { if (!(e instanceof Cancelled)) useStore.setState({ bassMap: { status: 'error', error: e.message } }); });
        });
      }
    }
  };
  run();
  return useStore.subscribe(run);
}

// ── Share links ────────────────────────────────────────────────────────────
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function shareLink(room: Room): Promise<string> {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const compact = {
    ...room,
    vertices: room.vertices.map((v) => ({ x: round(v.x), y: round(v.y) })),
    source: { x: round(room.source.x), y: round(room.source.y) },
    listener: { x: round(room.listener.x), y: round(room.listener.y) },
    panels: room.panels.map((p) => ({ ...p, t0: round(p.t0), t1: round(p.t1) })),
  };
  const json = new TextEncoder().encode(JSON.stringify(compact));
  let payload: string;
  if (typeof CompressionStream !== 'undefined') payload = 'z' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
  else payload = 'j' + b64url(json);
  return `${location.origin}${location.pathname}#room=${payload}`;
}

export async function roomFromHash(): Promise<Room | null> {
  const m = location.hash.match(/room=([^&]+)/);
  if (!m) return null;
  try {
    const kind = m[1][0];
    const bytes = fromB64url(m[1].slice(1));
    const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return sanitizeRoom(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}
