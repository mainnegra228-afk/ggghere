import { useEffect, useRef, useState } from 'react';
import { useStore, type View } from '../state/store';
import type { Room, Vec2 } from '../engine/types';
import { material, SPEED_OF_SOUND } from '../engine/materials';
import { bounds, closestOnSegment, dist, edge, inwardNormal, lerp, materialAt, pointInPolygon, segmentIntersection } from '../engine/geometry';
import { WaveGrid } from '../engine/fdtd';
import { isValidRoom, splitWall, uid, ensureInside } from '../engine/edit';
import { isSimple } from '../engine/geometry';
import { WavesHud, RaysHud, BassHud } from './StageHud';

export interface WaveControls {
  mode: 'pulse' | 'tone';
  freq: number;
  speed: number;
  paused: boolean;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean; world: Vec2 }
  | { kind: 'vertex'; index: number; moved: boolean }
  | { kind: 'wall'; index: number; start: Vec2; orig: Room; moved: boolean }
  | { kind: 'source' | 'listener'; moved: boolean }
  | { kind: 'panel'; id: string; offset: number; moved: boolean };

const COLORS = {
  bg: '#0b0c0e',
  grid: 'rgba(255,255,255,0.035)',
  gridMajor: 'rgba(255,255,255,0.07)',
  room: '#121418',
  source: '#ffa94d',
  listener: '#5fd4e6',
  accent: '#ffb35c',
  text: 'rgba(236,237,238,0.86)',
  muted: 'rgba(160,166,175,0.75)',
};

const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const SANS = '"Geist Variable", system-ui, sans-serif';

interface Particle { x: number; y: number; dx: number; dy: number; e: number; t: number; alive: boolean }

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const [cursor, setCursor] = useState('default');
  const [waveCtl, setWaveCtl] = useState<WaveControls>({ mode: 'pulse', freq: 250, speed: 6, paused: false });
  const waveCtlRef = useRef(waveCtl);
  waveCtlRef.current = waveCtl;
  const [waveInfo, setWaveInfo] = useState({ timeMs: 0, slowmo: 1, level: -99, maxFreq: 1000 });
  const [raysInfo, setRaysInfo] = useState({ timeMs: 0, alive: 0, hits: 0 });

  const xf = useRef({ scale: 80, ox: 0, oy: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const drag = useRef<Drag | null>(null);
  const hover = useRef<{ kind: string; index?: number; id?: string } | null>(null);
  const draft = useRef<Vec2[]>([]);
  const mouse = useRef<Vec2 | null>(null);
  const guides = useRef<{ x?: number; y?: number }>({});
  const space = useRef(false);
  const fitted = useRef(-1);

  const sim = useRef<{ grid: WaveGrid; key: string } | null>(null);
  const waveImg = useRef<{ canvas: HTMLCanvasElement; data: ImageData } | null>(null);
  const peak = useRef(1);
  const particles = useRef<Particle[]>([]);
  const trail = useRef<HTMLCanvasElement | null>(null);
  const echo = useRef<Float32Array>(new Float32Array(200));
  const raysT = useRef(0);
  const bassImg = useRef<{ canvas: HTMLCanvasElement; key: unknown } | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ d: number; scale: number } | null>(null);

  const toWorld = (sx: number, sy: number): Vec2 => ({ x: (sx - xf.current.ox) / xf.current.scale, y: (sy - xf.current.oy) / xf.current.scale });
  const toScreen = (p: Vec2): Vec2 => ({ x: xf.current.ox + p.x * xf.current.scale, y: xf.current.oy + p.y * xf.current.scale });

  const fit = (room: Room) => {
    const { w, h } = size.current;
    if (!w || !h) return;
    const bb = bounds(room.vertices);
    const pad = Math.min(110, Math.max(48, Math.min(w, h) * 0.12));
    const scale = Math.min((w - pad * 2) / Math.max(bb.w, 0.5), (h - pad * 2) / Math.max(bb.h, 0.5));
    xf.current = { scale, ox: w / 2 - (bb.minX + bb.w / 2) * scale, oy: h / 2 - (bb.minY + bb.h / 2) * scale };
    clearTrail();
  };

  const clearTrail = () => {
    const t = trail.current;
    t?.getContext('2d')?.clearRect(0, 0, t.width, t.height);
  };

  // ── Wave simulation lifecycle ────────────────────────────────────────────
  const ensureSim = (room: Room) => {
    const key = JSON.stringify([room.vertices, room.wallMaterials, room.panels]);
    if (sim.current?.key === key) return sim.current.grid;
    const bb = bounds(room.vertices);
    const dx = Math.max(0.012, Math.max(bb.w, bb.h) / 340);
    const grid = new WaveGrid(room, { dx, band: 3 });
    sim.current = { grid, key };
    const c = document.createElement('canvas');
    c.width = grid.nx; c.height = grid.ny;
    waveImg.current = { canvas: c, data: new ImageData(grid.nx, grid.ny) };
    peak.current = 1;
    grid.pulse(room.source, 1, 1.6);
    return grid;
  };

  const pulseAt = (p: Vec2) => {
    const g = sim.current?.grid;
    if (!g) return;
    g.pulse(p, 1, 1.6);
    peak.current = Math.max(peak.current, 1);
  };

  const emitRays = (room: Room) => {
    const N = 900;
    const ps: Particle[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      ps.push({ x: room.source.x, y: room.source.y, dx: Math.cos(a), dy: Math.sin(a), e: 1, t: 0, alive: true });
    }
    particles.current = ps;
    echo.current = new Float32Array(200);
    raysT.current = 0;
    clearTrail();
  };

  // Expose actions to the HUD.
  const actions = useRef({
    pulse: () => pulseAt(useStore.getState().room.source),
    resetWaves: () => { sim.current?.grid.reset(); peak.current = 1; },
    emit: () => emitRays(useStore.getState().room),
  });

  useEffect(() => {
    const room = useStore.getState().room;
    if (view === 'rays') emitRays(room);
    if (view === 'waves') {
      const g = ensureSim(room);
      g.reset();
      g.pulse(room.source, 1, 1.6);
      peak.current = 1;
    }
  }, [view]);

  // ── Canvas sizing ────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const prev = size.current;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      if (!trail.current) trail.current = document.createElement('canvas');
      trail.current.width = canvas.width; trail.current.height = canvas.height;
      const s = useStore.getState();
      // Refit on first layout or when the viewport changes a lot (rotation, mobile breakpoint).
      const big = !prev.w || Math.abs(w - prev.w) / prev.w > 0.25 || Math.abs(h - prev.h) / Math.max(1, prev.h) > 0.25;
      if (fitted.current !== s.fitNonce || big) { fit(s.room); fitted.current = s.fitNonce; }
      else { xf.current.ox += (w - prev.w) / 2; xf.current.oy += (h - prev.h) / 2; }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── Render loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const s = useStore.getState();
      if (fitted.current !== s.fitNonce) { fit(s.room); fitted.current = s.fitNonce; }
      frame++;
      const { dpr, w, h } = size.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);
      drawGrid(ctx, w, h);

      const room = s.room;
      const path = roomPath(room);
      ctx.fillStyle = COLORS.room;
      ctx.fill(path);

      if (s.view === 'waves') stepAndDrawWaves(ctx, room, path, frame);
      if (s.view === 'rays') stepAndDrawRays(ctx, room, path);
      if (s.view === 'bass') drawBassMap(ctx, path);

      if (s.view === 'plan' && s.showPaths && s.analysis.result) drawReflections(ctx, s.analysis.result.reflections);
      if (s.view === 'plan' && s.analysis.result) drawCritical(ctx, room, s.analysis.result.metrics.criticalDistance);
      drawWalls(ctx, room, s.selection);
      drawSourceListener(ctx, room, frame, s.selection);
      if (s.tool === 'draw') drawDraft(ctx);
      drawGuides(ctx, w, h);
      if (s.view === 'rays') drawEchogram(ctx, w, h);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drawing helpers ──────────────────────────────────────────────────────
  function roomPath(room: Room) {
    const p = new Path2D();
    room.vertices.forEach((v, i) => {
      const s = toScreen(v);
      if (i === 0) p.moveTo(s.x, s.y); else p.lineTo(s.x, s.y);
    });
    p.closePath();
    return p;
  }

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { scale, ox, oy } = xf.current;
    const step = scale > 60 ? 0.5 : scale > 20 ? 1 : scale > 6 ? 5 : 10;
    const major = step * (step < 1 ? 2 : 5);
    const x0 = Math.floor(-ox / scale / step) * step, x1 = (w - ox) / scale;
    const y0 = Math.floor(-oy / scale / step) * step, y1 = (h - oy) / scale;
    for (let x = x0; x <= x1; x += step) {
      const sx = Math.round(ox + x * scale) + 0.5;
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      ctx.fillStyle = isMajor ? COLORS.gridMajor : COLORS.grid;
      for (let y = y0; y <= y1; y += step) {
        const sy = Math.round(oy + y * scale) + 0.5;
        const r = isMajor && Math.abs(y / major - Math.round(y / major)) < 1e-6 ? 1.6 : 1;
        ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
      }
    }
  }

  function stepAndDrawWaves(ctx: CanvasRenderingContext2D, room: Room, path: Path2D, frame: number) {
    const g = ensureSim(room);
    const ctl = waveCtlRef.current;
    const src = g.index(room.source);
    if (!ctl.paused) {
      for (let i = 0; i < ctl.speed; i++) {
        if (ctl.mode === 'tone' && src >= 0) g.p[src] += 0.25 * Math.sin(2 * Math.PI * ctl.freq * g.time) * Math.min(1, g.time / 0.004);
        g.step();
      }
    }
    const img = waveImg.current!;
    const d = img.data.data;
    let pk = 0, energy = 0;
    const p = g.p;
    for (const k of g.cells) { const v = Math.abs(p[k]); if (v > pk) pk = v; energy += p[k] * p[k]; }
    peak.current = Math.max(pk, peak.current * 0.985, 1e-6);
    const gain = Math.min(1 / peak.current, 400) * 1.6;
    d.fill(0);
    for (const k of g.cells) {
      const t = Math.tanh(p[k] * gain);
      const a = Math.abs(t);
      const o = k * 4;
      const hot = Math.max(0, a - 0.75) * 4;
      if (t > 0) { d[o] = 255; d[o + 1] = 160 + 95 * hot; d[o + 2] = 70 + 185 * hot; }
      else { d[o] = 80 + 175 * hot; d[o + 1] = 205 + 50 * hot; d[o + 2] = 232 + 23 * hot; }
      d[o + 3] = Math.min(255, a * 300);
    }
    img.canvas.getContext('2d')!.putImageData(img.data, 0, 0);
    ctx.save();
    ctx.clip(path);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const tl = toScreen({ x: g.ox, y: g.oy });
    ctx.drawImage(img.canvas, tl.x, tl.y, g.nx * g.dx * xf.current.scale, g.ny * g.dx * xf.current.scale);
    ctx.restore();
    if (frame % 6 === 0) {
      setWaveInfo({
        timeMs: g.time * 1000,
        slowmo: 1 / 60 / Math.max(1e-9, ctl.speed * g.dt),
        level: 10 * Math.log10(Math.max(energy, 1e-12)),
        maxFreq: SPEED_OF_SOUND / (8 * g.dx),
      });
    }
  }

  function stepAndDrawRays(ctx: CanvasRenderingContext2D, room: Room, path: Path2D) {
    const t = trail.current!;
    const tctx = t.getContext('2d')!;
    const { dpr } = size.current;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'destination-out';
    tctx.fillStyle = 'rgba(0,0,0,0.06)';
    tctx.fillRect(0, 0, t.width, t.height);
    tctx.globalCompositeOperation = 'lighter';
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.lineWidth = 1.2;
    const dtSim = 0.0006; // simulated seconds per frame
    const step = SPEED_OF_SOUND * dtSim;
    const v = room.vertices, n = v.length;
    const R = room.listener, rr = 0.28;
    let alive = 0;
    for (const p of particles.current) {
      if (!p.alive) continue;
      let remain = step;
      let guard = 0;
      while (remain > 1e-6 && guard++ < 4) {
        const nxp = { x: p.x + p.dx * remain, y: p.y + p.dy * remain };
        let best: { t: number; w: number; u: number } | null = null;
        for (let i = 0; i < n; i++) {
          const hit = segmentIntersection({ x: p.x, y: p.y }, nxp, v[i], v[(i + 1) % n]);
          if (hit && hit.t > 1e-7 && (!best || hit.t < best.t)) best = { t: hit.t, w: i, u: hit.u };
        }
        const travel = best ? remain * best.t : remain;
        const ex = p.x + p.dx * travel, ey = p.y + p.dy * travel;
        // Listener detection (closest approach on this segment).
        const sx = R.x - p.x, sy = R.y - p.y;
        const along = Math.max(0, Math.min(travel, sx * p.dx + sy * p.dy));
        const cx = p.x + p.dx * along - R.x, cy = p.y + p.dy * along - R.y;
        if (cx * cx + cy * cy < rr * rr && p.t > 0) {
          const bin = Math.floor(((p.t + along / SPEED_OF_SOUND) * 1000) / 2);
          if (bin < echo.current.length) echo.current[bin] += p.e;
        }
        const a = toScreen({ x: p.x, y: p.y }), b = toScreen({ x: ex, y: ey });
        const e = Math.sqrt(p.e);
        tctx.strokeStyle = `rgba(${255 - 120 * (1 - e)}, ${170 + 40 * (1 - e)}, ${90 + 140 * (1 - e)}, ${0.18 + 0.6 * e})`;
        tctx.beginPath(); tctx.moveTo(a.x, a.y); tctx.lineTo(b.x, b.y); tctx.stroke();
        p.x = ex; p.y = ey; p.t += travel / SPEED_OF_SOUND;
        remain -= travel;
        if (best) {
          const m = material(materialAt(room, best.w, best.u));
          p.e *= 1 - m.alpha[3];
          const nn = inwardNormal(v, best.w);
          if (Math.random() < m.scatter) {
            const ang = Math.asin(Math.random() * 2 - 1);
            const c = Math.cos(ang), s = Math.sin(ang);
            p.dx = nn.x * c - nn.y * s; p.dy = nn.x * s + nn.y * c;
          } else {
            const dn = p.dx * nn.x + p.dy * nn.y;
            p.dx -= 2 * dn * nn.x; p.dy -= 2 * dn * nn.y;
          }
          p.x += nn.x * 1e-5; p.y += nn.y * 1e-5;
        }
      }
      if (p.e < 0.001 || p.t > 1.2 || !pointInPolygon(p, v)) p.alive = false;
      else alive++;
    }
    raysT.current += dtSim;
    ctx.save();
    ctx.clip(path);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(t, 0, 0);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of particles.current) {
      if (!p.alive) continue;
      const s = toScreen(p);
      ctx.fillStyle = `rgba(255,214,170,${0.25 + 0.75 * Math.sqrt(p.e)})`;
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    if (Math.round(raysT.current / dtSim) % 6 === 0) {
      let hits = 0;
      echo.current.forEach((v) => (hits += v > 0 ? 1 : 0));
      setRaysInfo({ timeMs: raysT.current * 1000, alive, hits });
    }
  }

  function drawEchogram(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const e = echo.current;
    let max = 0;
    for (const v of e) max = Math.max(max, v);
    const W = Math.min(320, w - 40), H = 64;
    const x0 = 20, y0 = h - H - 20;
    ctx.fillStyle = 'rgba(14,16,19,0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.roundRect(x0 - 10, y0 - 26, W + 20, H + 40, 10); ctx.fill(); ctx.stroke();
    ctx.font = `500 10px ${SANS}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('ECHOGRAM AT LISTENER · 0–400 ms', x0, y0 - 10);
    if (max <= 0) return;
    const bw = W / e.length;
    for (let i = 0; i < e.length; i++) {
      if (e[i] <= 0) continue;
      const db = 10 * Math.log10(e[i] / max);
      const hh = Math.max(1, ((db + 40) / 40) * H);
      if (hh <= 0) continue;
      ctx.fillStyle = i * 2 < 50 ? COLORS.listener : 'rgba(255,179,92,0.85)';
      ctx.fillRect(x0 + i * bw, y0 + H - hh, Math.max(1, bw - 0.4), hh);
    }
  }

  function drawBassMap(ctx: CanvasRenderingContext2D, path: Path2D) {
    const bm = useStore.getState().bassMap.result;
    if (!bm) return;
    if (bassImg.current?.key !== bm) {
      const c = document.createElement('canvas');
      c.width = bm.nx; c.height = bm.ny;
      const c2 = c.getContext('2d')!;
      const img = c2.createImageData(bm.nx, bm.ny);
      for (let k = 0; k < bm.db.length; k++) {
        const v = bm.db[k];
        if (!Number.isFinite(v)) continue;
        const [r, g, b] = bassColor(v);
        img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 235;
      }
      c2.putImageData(img, 0, 0);
      bassImg.current = { canvas: c, key: bm };
    }
    ctx.save();
    ctx.clip(path);
    ctx.imageSmoothingEnabled = true;
    const tl = toScreen({ x: bm.ox, y: bm.oy });
    ctx.drawImage(bassImg.current.canvas, tl.x, tl.y, bm.nx * bm.dx * xf.current.scale, bm.ny * bm.dx * xf.current.scale);
    ctx.restore();
  }

  function drawReflections(ctx: CanvasRenderingContext2D, refl: { order: number; points: Vec2[]; levelDb: number }[]) {
    ctx.save();
    for (const r of refl) {
      const a = Math.max(0.06, Math.min(0.75, (r.levelDb + 20) / 20)) * (r.order === 1 ? 1 : 0.55);
      ctx.strokeStyle = `rgba(255,179,92,${a})`;
      ctx.lineWidth = r.order === 1 ? 1.4 : 1;
      ctx.setLineDash(r.order === 1 ? [] : [4, 4]);
      ctx.beginPath();
      r.points.forEach((p, i) => { const s = toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke();
      if (r.order === 1) {
        const q = toScreen(r.points[1]);
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,179,92,${Math.min(1, a + 0.2)})`;
        ctx.beginPath(); ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x + 5, q.y); ctx.lineTo(q.x, q.y + 5); ctx.lineTo(q.x - 5, q.y); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCritical(ctx: CanvasRenderingContext2D, room: Room, rc: number) {
    const s = toScreen(room.source);
    const r = rc * xf.current.scale;
    if (r < 12) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,169,77,0.28)';
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = 'rgba(255,169,77,0.6)';
    ctx.fillText(`r꜀ ${rc.toFixed(2)} m`, s.x + r * 0.71 + 4, s.y - r * 0.71 - 4);
    ctx.restore();
  }

  function drawWalls(ctx: CanvasRenderingContext2D, room: Room, sel: ReturnType<typeof useStore.getState>['selection']) {
    const v = room.vertices, n = v.length;
    const sc = xf.current.scale;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const [a, b] = edge(v, i);
      const A = toScreen(a), B = toScreen(b);
      const m = material(room.wallMaterials[i]);
      const selected = sel?.kind === 'wall' && sel.index === i;
      const hovered = hover.current?.kind === 'wall' && hover.current.index === i;
      if (selected || hovered) {
        ctx.strokeStyle = selected ? 'rgba(255,179,92,0.35)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      ctx.strokeStyle = m.id === 'open' ? 'rgba(255,255,255,0.25)' : m.color;
      ctx.lineWidth = m.id === 'open' ? 1.5 : 4;
      ctx.setLineDash(m.id === 'open' ? [6, 6] : []);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.setLineDash([]);

      // Panels sit just inside the wall.
      const nn = inwardNormal(v, i);
      for (const p of room.panels) {
        if (p.wall !== i) continue;
        const pm = material(p.material);
        const P0 = toScreen(lerp(a, b, p.t0)), P1 = toScreen(lerp(a, b, p.t1));
        const off = 7;
        const ox = nn.x * off, oy = nn.y * off;
        const psel = sel?.kind === 'panel' && sel.id === p.id;
        const phov = hover.current?.kind === 'panel' && hover.current.id === p.id;
        ctx.strokeStyle = pm.color;
        ctx.lineWidth = 7;
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(P0.x + ox, P0.y + oy); ctx.lineTo(P1.x + ox, P1.y + oy); ctx.stroke();
        if (pm.scatter > 0.5) {
          // Diffuser hatch.
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 1;
          const segs = Math.max(2, Math.floor(dist(P0, P1) / 6));
          for (let k = 1; k < segs; k++) {
            const q = lerp(P0, P1, k / segs);
            ctx.beginPath(); ctx.moveTo(q.x + nn.x * 3.5, q.y + nn.y * 3.5); ctx.lineTo(q.x + nn.x * (k % 2 ? 10.5 : 7), q.y + nn.y * (k % 2 ? 10.5 : 7)); ctx.stroke();
          }
        }
        if (psel || phov) {
          ctx.strokeStyle = psel ? COLORS.accent : 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(Math.min(P0.x, P1.x) + ox - 6, Math.min(P0.y, P1.y) + oy - 6, Math.abs(P1.x - P0.x) + 12, Math.abs(P1.y - P0.y) + 12);
        }
        ctx.lineCap = 'round';
      }

      // Dimension label, outside the room.
      const L = dist(a, b);
      if (L * sc > 46) {
        const mid = toScreen(lerp(a, b, 0.5));
        const lx = mid.x - nn.x * 18, ly = mid.y - nn.y * 18;
        ctx.font = `500 10.5px ${MONO}`;
        const txt = `${L.toFixed(2)} m`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(11,12,14,0.85)';
        ctx.fillRect(lx - tw / 2 - 4, ly - 8, tw + 8, 16);
        ctx.fillStyle = selected ? COLORS.accent : COLORS.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, lx, ly);
        ctx.font = `600 9px ${SANS}`;
        ctx.fillStyle = 'rgba(160,166,175,0.45)';
        ctx.fillText(`W${i + 1}`, mid.x + nn.x * 20, mid.y + nn.y * 20);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }
    // Vertex handles.
    for (let i = 0; i < n; i++) {
      const s = toScreen(v[i]);
      const selected = sel?.kind === 'vertex' && sel.index === i;
      const hovered = hover.current?.kind === 'vertex' && hover.current.index === i;
      ctx.fillStyle = selected ? COLORS.accent : '#0b0c0e';
      ctx.strokeStyle = selected || hovered ? COLORS.accent : 'rgba(236,237,238,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, hovered || selected ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawSourceListener(ctx: CanvasRenderingContext2D, room: Room, frame: number, sel: ReturnType<typeof useStore.getState>['selection']) {
    const S = toScreen(room.source), L = toScreen(room.listener);
    // Source: emitting rings.
    for (let k = 0; k < 3; k++) {
      const ph = ((frame / 90 + k / 3) % 1);
      ctx.strokeStyle = `rgba(255,169,77,${0.45 * (1 - ph)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(S.x, S.y, 9 + ph * 22, 0, Math.PI * 2); ctx.stroke();
    }
    const srcSel = sel?.kind === 'source' || hover.current?.kind === 'source';
    ctx.fillStyle = COLORS.source;
    ctx.shadowColor = 'rgba(255,169,77,0.7)';
    ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(S.x, S.y, srcSel ? 9 : 8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1206';
    ctx.beginPath(); ctx.arc(S.x, S.y, 3, 0, Math.PI * 2); ctx.fill();

    const lisSel = sel?.kind === 'listener' || hover.current?.kind === 'listener';
    ctx.strokeStyle = COLORS.listener;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(95,212,230,0.7)';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(L.x, L.y, lisSel ? 9 : 8, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.listener;
    ctx.beginPath(); ctx.arc(L.x, L.y, 3, 0, Math.PI * 2); ctx.fill();
    // Ears.
    ctx.beginPath(); ctx.arc(L.x - 11, L.y, 2.2, 0, Math.PI * 2); ctx.arc(L.x + 11, L.y, 2.2, 0, Math.PI * 2); ctx.fill();

    ctx.font = `600 9.5px ${SANS}`;
    ctx.fillStyle = 'rgba(255,169,77,0.9)';
    ctx.fillText('SOURCE', S.x + 14, S.y - 10);
    ctx.fillStyle = 'rgba(95,212,230,0.9)';
    ctx.fillText('LISTENER', L.x + 16, L.y - 10);
  }

  function drawDraft(ctx: CanvasRenderingContext2D) {
    const pts = draft.current;
    const m = mouse.current;
    if (!pts.length && !m) return;
    ctx.save();
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => { const s = toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    if (m && pts.length) { const s = toScreen(m); ctx.lineTo(s.x, s.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    pts.forEach((p, i) => {
      const s = toScreen(p);
      ctx.fillStyle = i === 0 ? COLORS.accent : '#0b0c0e';
      ctx.strokeStyle = COLORS.accent;
      ctx.beginPath(); ctx.arc(s.x, s.y, i === 0 ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    if (m) {
      const s = toScreen(m);
      ctx.strokeStyle = 'rgba(255,179,92,0.6)';
      ctx.beginPath(); ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8); ctx.stroke();
      if (pts.length) {
        const last = pts[pts.length - 1];
        ctx.font = `500 10.5px ${MONO}`;
        ctx.fillStyle = COLORS.accent;
        ctx.fillText(`${dist(last, m).toFixed(2)} m`, s.x + 12, s.y + 16);
      }
    }
    ctx.restore();
  }

  function drawGuides(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = guides.current;
    ctx.save();
    ctx.strokeStyle = 'rgba(95,212,230,0.35)';
    ctx.setLineDash([3, 4]);
    if (g.x !== undefined) { const sx = toScreen({ x: g.x, y: 0 }).x; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); }
    if (g.y !== undefined) { const sy = toScreen({ x: 0, y: g.y }).y; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
    ctx.restore();
  }

  // ── Hit testing & interaction ────────────────────────────────────────────
  function hitTest(sx: number, sy: number) {
    const room = useStore.getState().room;
    const P = { x: sx, y: sy };
    const S = toScreen(room.source), L = toScreen(room.listener);
    if (dist(P, S) < 13) return { kind: 'source' as const };
    if (dist(P, L) < 13) return { kind: 'listener' as const };
    for (let i = 0; i < room.vertices.length; i++) if (dist(P, toScreen(room.vertices[i])) < 9) return { kind: 'vertex' as const, index: i };
    for (let k = room.panels.length - 1; k >= 0; k--) {
      const p = room.panels[k];
      const [a, b] = edge(room.vertices, p.wall);
      const nn = inwardNormal(room.vertices, p.wall);
      const A = toScreen(lerp(a, b, p.t0)), B = toScreen(lerp(a, b, p.t1));
      const h = closestOnSegment(P, { x: A.x + nn.x * 7, y: A.y + nn.y * 7 }, { x: B.x + nn.x * 7, y: B.y + nn.y * 7 });
      if (h.d < 8) return { kind: 'panel' as const, id: p.id };
    }
    for (let i = 0; i < room.vertices.length; i++) {
      const [a, b] = edge(room.vertices, i);
      if (closestOnSegment(P, toScreen(a), toScreen(b)).d < 8) return { kind: 'wall' as const, index: i };
    }
    return null;
  }

  const snap = (p: Vec2, alt: boolean, exclude = -1): Vec2 => {
    guides.current = {};
    if (alt) return p;
    const q = { x: Math.round(p.x / 0.05) * 0.05, y: Math.round(p.y / 0.05) * 0.05 };
    const tol = 8 / xf.current.scale;
    const verts = useStore.getState().room.vertices;
    let bx = tol, by = tol;
    verts.forEach((v, i) => {
      if (i === exclude) return;
      if (Math.abs(v.x - p.x) < bx) { bx = Math.abs(v.x - p.x); q.x = v.x; guides.current.x = v.x; }
      if (Math.abs(v.y - p.y) < by) { by = Math.abs(v.y - p.y); q.y = v.y; guides.current.y = v.y; }
    });
    return q;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function finishDraft() {
    const pts = draft.current;
    const st = useStore.getState();
    if (pts.length < 3) { st.toast('A room needs at least 3 corners', 'warn'); return; }
    if (!isSimple(pts)) { st.toast('Walls cannot cross each other', 'warn'); return; }
    const prev = st.room;
    const room = ensureInside({
      ...prev,
      name: prev.name,
      vertices: pts,
      wallMaterials: pts.map(() => 'drywall'),
      panels: [],
      source: { x: Infinity, y: Infinity },
      listener: { x: Infinity, y: Infinity },
    });
    draft.current = [];
    st.setRoom(room);
    st.set({ tool: 'select', selection: null });
    st.toast(`Room drawn · ${pts.length} walls`);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) space.current = e.type === 'keydown';
      if (e.type !== 'keydown') return;
      const st = useStore.getState();
      if (st.tool === 'draw') {
        if (e.key === 'Escape') { draft.current = []; st.set({ tool: 'select' }); }
        if (e.key === 'Enter') finishDraft();
        if (e.key === 'Backspace') draft.current = draft.current.slice(0, -1);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, []);

  useEffect(() => { if (tool !== 'draw') draft.current = []; }, [tool]);

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const P = local(e);
    pointers.current.set(e.pointerId, P);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: dist(a, b), scale: xf.current.scale };
      drag.current = null;
      return;
    }
    const st = useStore.getState();
    const W = toWorld(P.x, P.y);
    const room = st.room;
    if (e.button === 1 || space.current) {
      drag.current = { kind: 'pan', sx: P.x, sy: P.y, ox: xf.current.ox, oy: xf.current.oy, moved: false, world: W };
      return;
    }
    if (st.tool === 'draw') {
      const q = snap(W, e.altKey);
      const pts = draft.current;
      if (pts.length >= 3 && dist(toScreen(pts[0]), P) < 12) { finishDraft(); return; }
      if (pts.length && dist(pts[pts.length - 1], q) < 0.05) return;
      draft.current = [...pts, q];
      return;
    }
    if (st.tool === 'source' || st.tool === 'listener') {
      if (!pointInPolygon(W, room.vertices)) { st.toast('Place it inside the room', 'warn'); return; }
      const q = snap(W, true);
      st.setRoom({ ...room, [st.tool]: q });
      st.set({ tool: 'select', selection: { kind: st.tool } });
      return;
    }
    if (st.tool === 'panel') {
      const hit = hitTest(P.x, P.y);
      if (hit?.kind === 'wall') {
        const [a, b] = edge(room.vertices, hit.index);
        const t = closestOnSegment(W, a, b).t;
        const L = dist(a, b);
        const half = Math.min(0.5, 0.6 / L);
        const c = Math.min(1 - half, Math.max(half, t));
        const id = uid();
        st.setRoom({ ...room, panels: [...room.panels, { id, wall: hit.index, t0: c - half, t1: c + half, material: st.panelMaterial }] });
        st.set({ selection: { kind: 'panel', id } });
      } else if (hit?.kind === 'panel') st.set({ selection: { kind: 'panel', id: hit.id } });
      else st.toast('Click on a wall to mount a panel', 'warn');
      return;
    }
    const hit = hitTest(P.x, P.y);
    if (!hit) {
      st.set({ selection: null });
      drag.current = { kind: 'pan', sx: P.x, sy: P.y, ox: xf.current.ox, oy: xf.current.oy, moved: false, world: W };
      return;
    }
    if (hit.kind === 'vertex') { st.set({ selection: { kind: 'vertex', index: hit.index } }); drag.current = { kind: 'vertex', index: hit.index, moved: false }; }
    else if (hit.kind === 'wall') { st.set({ selection: { kind: 'wall', index: hit.index }, tab: st.tab === 'room' ? 'room' : st.tab }); drag.current = { kind: 'wall', index: hit.index, start: W, orig: room, moved: false }; }
    else if (hit.kind === 'panel') {
      const p = room.panels.find((x) => x.id === hit.id)!;
      const [a, b] = edge(room.vertices, p.wall);
      const t = closestOnSegment(W, a, b).t;
      st.set({ selection: { kind: 'panel', id: hit.id } });
      drag.current = { kind: 'panel', id: hit.id, offset: t - (p.t0 + p.t1) / 2, moved: false };
    } else { st.set({ selection: { kind: hit.kind } }); drag.current = { kind: hit.kind, moved: false }; }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const P = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, P);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(mid.x, mid.y, (pinch.current.scale * dist(a, b)) / pinch.current.d / xf.current.scale);
      return;
    }
    const W = toWorld(P.x, P.y);
    mouse.current = useStore.getState().tool === 'draw' ? snap(W, e.altKey) : W;
    const d = drag.current;
    const st = useStore.getState();
    if (!d) {
      const hit = st.tool === 'select' || st.tool === 'panel' ? hitTest(P.x, P.y) : null;
      hover.current = hit;
      setCursor(
        st.tool === 'draw' || st.tool === 'source' || st.tool === 'listener' ? 'crosshair'
          : st.tool === 'panel' ? (hit?.kind === 'wall' ? 'copy' : 'default')
            : hit ? (hit.kind === 'wall' ? 'move' : 'grab') : space.current ? 'grab' : 'default',
      );
      return;
    }
    if (d.kind === 'pan') {
      if (Math.abs(P.x - d.sx) + Math.abs(P.y - d.sy) > 3) d.moved = true;
      xf.current.ox = d.ox + P.x - d.sx;
      xf.current.oy = d.oy + P.y - d.sy;
      clearTrail();
      setCursor('grabbing');
      return;
    }
    if (!d.moved) { st.checkpoint(); d.moved = true; }
    const room = st.room;
    let next: Room | null = null;
    if (d.kind === 'vertex') {
      const q = snap(W, e.altKey, d.index);
      next = { ...room, vertices: room.vertices.map((v, i) => (i === d.index ? q : v)) };
    } else if (d.kind === 'wall') {
      const nn = inwardNormal(d.orig.vertices, d.index);
      let delta = (W.x - d.start.x) * nn.x + (W.y - d.start.y) * nn.y;
      if (!e.altKey) delta = Math.round(delta / 0.05) * 0.05;
      const n = room.vertices.length;
      const i0 = d.index, i1 = (d.index + 1) % n;
      next = { ...room, vertices: d.orig.vertices.map((v, i) => (i === i0 || i === i1 ? { x: v.x + nn.x * delta, y: v.y + nn.y * delta } : v)) };
    } else if (d.kind === 'source' || d.kind === 'listener') {
      next = { ...room, [d.kind]: snap(W, true) };
    } else if (d.kind === 'panel') {
      const p = room.panels.find((x) => x.id === d.id);
      if (!p) return;
      const [a, b] = edge(room.vertices, p.wall);
      const t = closestOnSegment(W, a, b).t - d.offset;
      const half = (p.t1 - p.t0) / 2;
      const c = Math.min(1 - half, Math.max(half, t));
      next = { ...room, panels: room.panels.map((x) => (x.id === d.id ? { ...x, t0: c - half, t1: c + half } : x)) };
    }
    if (next && isValidRoom(next)) st.setRoom(next, false);
    setCursor('grabbing');
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    guides.current = {};
    const st = useStore.getState();
    if (d?.kind === 'pan' && !d.moved) {
      if (st.view === 'waves' && pointInPolygon(d.world, st.room.vertices)) pulseAt(d.world);
      if (st.view === 'rays') emitRays(st.room);
    }
    setCursor('default');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const st = useStore.getState();
    if (st.tool === 'draw') { finishDraft(); return; }
    const P = local(e);
    const hit = hitTest(P.x, P.y);
    if (hit?.kind === 'wall') {
      const [a, b] = edge(st.room.vertices, hit.index);
      const t = closestOnSegment(toWorld(P.x, P.y), a, b).t;
      if (t < 0.05 || t > 0.95) return;
      st.setRoom(splitWall(st.room, hit.index, t));
      st.set({ selection: { kind: 'vertex', index: hit.index + 1 } });
      st.toast('Corner added — drag it to reshape');
    }
  };

  function zoomAt(sx: number, sy: number, factor: number) {
    const s = Math.min(800, Math.max(4, xf.current.scale * factor));
    const k = s / xf.current.scale;
    xf.current = { scale: s, ox: sx - (sx - xf.current.ox) * k, oy: sy - (sy - xf.current.oy) * k };
    clearTrail();
  }

  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const P = local(e);
      zoomAt(P.x, P.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onFit = () => fit(useStore.getState().room);
    window.addEventListener('roomtone:fit', onFit);
    return () => window.removeEventListener('roomtone:fit', onFit);
  }, []);

  return (
    <div className="stage" ref={wrapRef} data-view={view}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { mouse.current = null; hover.current = null; }}
        onDoubleClick={onDoubleClick}
        aria-label="Room floor plan editor"
        role="application"
      />
      {tool === 'draw' && <div className="stage-hint">Click to place corners · click the first corner or press Enter to close · Esc to cancel · hold Alt to disable snapping</div>}
      {view === 'waves' && <WavesHud ctl={waveCtl} setCtl={setWaveCtl} info={waveInfo} onPulse={() => actions.current.pulse()} onReset={() => actions.current.resetWaves()} />}
      {view === 'rays' && <RaysHud info={raysInfo} onEmit={() => actions.current.emit()} />}
      {view === 'bass' && <BassHud />}
    </div>
  );
}

export function bassColor(db: number): [number, number, number] {
  // Diverging map: deep indigo nulls → neutral slate → hot amber peaks.
  const t = Math.max(-1, Math.min(1, db / 12));
  if (t < 0) {
    const a = -t;
    return [Math.round(40 + (30 - 40) * a), Math.round(46 + (60 - 46) * a + 0 * a), Math.round(56 + (190 - 56) * a)];
  }
  return [Math.round(40 + (255 - 40) * t), Math.round(46 + (170 - 46) * t), Math.round(56 + (70 - 56) * t)];
}

export type { View };
