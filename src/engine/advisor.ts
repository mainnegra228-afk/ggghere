import type { AcousticMetrics, Panel, Room } from './types';
import { material } from './materials';
import { dot, edge, inwardNormal, len, sub, wallLength, dist } from './geometry';
import { earlyReflections } from './reflections';

export type RoomUse = 'studio' | 'living' | 'speech' | 'music' | 'hall';

export const ROOM_USES: { id: RoomUse; label: string; hint: string }[] = [
  { id: 'studio', label: 'Mixing / home studio', hint: 'EBU Tech 3276, floored at 0.3 s for small rooms' },
  { id: 'living', label: 'Living room / cinema', hint: 'Comfortable domestic listening' },
  { id: 'speech', label: 'Meeting / classroom', hint: 'DIN 18041 group A3 (communication)' },
  { id: 'music', label: 'Music rehearsal', hint: 'DIN 18041 group A1 (music)' },
  { id: 'hall', label: 'Concert / choir hall', hint: 'Classical concert hall range' },
];

/** Target mid-frequency reverberation time with acceptable tolerance. */
export function targetRT(use: RoomUse, volume: number): { target: number; tol: number } {
  const lg = Math.log10(Math.max(volume, 10));
  switch (use) {
    case 'studio': return { target: Math.max(0.3, 0.25 * Math.cbrt(volume / 100)), tol: 0.08 };
    case 'living': return { target: 0.45, tol: 0.1 };
    case 'speech': return { target: Math.max(0.3, 0.32 * lg - 0.17), tol: 0.1 };
    case 'music': return { target: 0.45 * lg + 0.07, tol: 0.15 };
    case 'hall': return { target: 1.9, tol: 0.25 };
  }
}

export type Severity = 'good' | 'info' | 'warn' | 'bad';

export interface AdvisorAction {
  label: string;
  /** Returns a new set of panels to add. */
  panels: (room: Room) => Omit<Panel, 'id'>[];
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action?: AdvisorAction;
}

export const midT = (m: AcousticMetrics) => {
  const t = (b: number) => m.t30[b] ?? m.t20[b] ?? m.sabine[b];
  return (t(2) + t(3)) / 2;
};

const PANEL_W = 1.2;
const PANEL_AREA = 1.2 * 0.6; // a typical 120 × 60 cm panel
const MAX_PER_STEP = 12;

function free(room: Room, wall: number, t0: number, t1: number) {
  return !room.panels.some((p) => p.wall === wall && p.t1 > t0 && p.t0 < t1);
}

function centred(room: Room, wall: number, t: number, width: number, mat: string): Omit<Panel, 'id'> | null {
  const L = wallLength(room, wall);
  const half = Math.min(0.5, width / L / 2);
  const c = Math.min(1 - half, Math.max(half, t));
  if (!free(room, wall, c - half, c + half)) return null;
  return { wall, t0: c - half, t1: c + half, material: mat };
}

/** Pairs of facing, parallel, untreated hard walls that produce flutter echo. */
export function flutterPairs(room: Room): [number, number][] {
  const n = room.vertices.length;
  const pairs: [number, number][] = [];
  const hard = (w: number) => material(room.wallMaterials[w]).alpha[3] < 0.2 && !room.panels.some((p) => p.wall === w && material(p.material).alpha[3] > 0.5 || (p.wall === w && material(p.material).scatter > 0.5));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const ni = inwardNormal(room.vertices, i), nj = inwardNormal(room.vertices, j);
      if (dot(ni, nj) > -0.985) continue;
      const [a, b] = edge(room.vertices, i);
      const [c, d] = edge(room.vertices, j);
      // Overlap of the two walls when projected onto wall i.
      const dir = sub(b, a);
      const L = len(dir);
      const proj = (p: typeof a) => dot(sub(p, a), dir) / L;
      const lo = Math.max(0, Math.min(proj(c), proj(d))), hi = Math.min(L, Math.max(proj(c), proj(d)));
      if (hi - lo < 1.0) continue;
      const gap = Math.abs(dot(sub(c, a), ni));
      if (gap < 1.5) continue;
      if (hard(i) && hard(j)) pairs.push([i, j]);
    }
  return pairs;
}

export function advise(room: Room, m: AcousticMetrics, use: RoomUse): Finding[] {
  const out: Finding[] = [];
  const { target, tol } = targetRT(use, m.volume);
  const T = midT(m);
  const t = (b: number) => m.t30[b] ?? m.t20[b] ?? m.sabine[b];

  if (T > target + tol) {
    // Size the fix with Sabine's absorption balance: the ray-traced T of a bare room is
    // often long because the field is not diffuse, and treatment itself diffuses it, so
    // inverting the simulated T would massively overshoot.
    const Amid = (m.absorptionArea[2] + m.absorptionArea[3]) / 2;
    const dA = Math.max(PANEL_AREA, (0.161 * m.volume) / target - Amid);
    const total = Math.max(1, Math.ceil(dA / (PANEL_AREA * 0.98)));
    const count = Math.min(MAX_PER_STEP, total);
    out.push({
      id: 'rt-long',
      severity: T > target * 1.6 ? 'bad' : 'warn',
      title: `Too reverberant: ${T.toFixed(2)} s vs ${target.toFixed(2)} s target`,
      detail: `About ${dA.toFixed(1)} m² of extra absorption is needed — roughly ${total} × 120×60 cm broadband panels (100 mm mineral wool). Sofas, beds and rugs count too.${total > count ? ` Add ${count} now, then re-check: the simulation will tell you what is left.` : ''}`,
      action: {
        label: `Add ${count} panel${count > 1 ? 's' : ''}`,
        panels: (r) => distributePanels(r, count),
      },
    });
  } else if (T < target - tol) {
    out.push({
      id: 'rt-short',
      severity: 'warn',
      title: `Too dead: ${T.toFixed(2)} s vs ${target.toFixed(2)} s target`,
      detail: 'The room will feel unnaturally dry. Replace some absorbers with diffusers or remove soft furnishings.',
    });
  } else {
    out.push({
      id: 'rt-ok',
      severity: 'good',
      title: `Reverberation on target (${T.toFixed(2)} s)`,
      detail: `Mid-frequency decay sits within ±${tol.toFixed(2)} s of the ${target.toFixed(2)} s goal for this use.`,
    });
  }

  const bassRatio = t(0) / Math.max(T, 1e-3);
  if (bassRatio > 1.5 && use !== 'hall') {
    out.push({
      id: 'bass',
      severity: bassRatio > 2.2 ? 'bad' : 'warn',
      title: `Bass rings ${bassRatio.toFixed(1)}× longer than mids`,
      detail: 'Low frequencies decay much slower than the rest of the spectrum, which sounds boomy. Thick absorbers in the corners are the most effective fix.',
      action: { label: 'Add corner bass traps', panels: (r) => cornerTraps(r) },
    });
  }

  const hiRatio = t(5) / Math.max(T, 1e-3);
  if (hiRatio < 0.5) {
    out.push({
      id: 'dull',
      severity: 'info',
      title: 'Highs are over-damped',
      detail: 'Treble decays far faster than mids. Thin absorbers soak up highs only — use thicker panels or diffusion to keep the room balanced.',
    });
  }

  const flutter = flutterPairs(room);
  if (flutter.length) {
    out.push({
      id: 'flutter',
      severity: 'warn',
      title: `Flutter echo risk between ${flutter.length} wall pair${flutter.length > 1 ? 's' : ''}`,
      detail: `Parallel bare walls (${flutter.map(([a, b]) => `W${a + 1}↔W${b + 1}`).join(', ')}) bounce sound back and forth, creating a metallic ringing. Treat one side of each pair.`,
      action: {
        label: 'Add diffusers',
        panels: (r) => flutterPairs(r).map(([a]) => centred(r, a, 0.5, Math.min(2, wallLength(r, a) * 0.5), 'diffuser')).filter(Boolean) as Omit<Panel, 'id'>[],
      },
    });
  }

  const strong = earlyReflections(room, 1).filter((p) => p.delayMs < 20 && p.levelDb > -8);
  if (strong.length && (use === 'studio' || use === 'living')) {
    out.push({
      id: 'early',
      severity: 'warn',
      title: `${strong.length} strong first reflection${strong.length > 1 ? 's' : ''}`,
      detail: `Reflections arriving within 20 ms at less than 8 dB below the direct sound blur stereo imaging (${strong.map((p) => `W${p.walls[0] + 1}: ${p.levelDb.toFixed(1)} dB @ ${p.delayMs.toFixed(1)} ms`).join(', ')}).`,
      action: { label: 'Treat reflection points', panels: (r) => reflectionPanels(r) },
    });
  }

  const c50 = (m.c50[2] + m.c50[3]) / 2;
  if (use === 'speech' || use === 'studio') {
    out.push({
      id: 'clarity',
      severity: c50 >= 2 ? 'good' : c50 >= -2 ? 'info' : 'warn',
      title: `Speech clarity C50 ${c50 >= 0 ? '+' : ''}${c50.toFixed(1)} dB`,
      detail: c50 >= 2 ? 'Speech will be easy to understand at the listening position.' : 'Words will smear together at this position; more absorption or a closer source will help.',
    });
  }

  if (dist(room.source, room.listener) > m.criticalDistance * 2.5 && use !== 'hall') {
    out.push({
      id: 'distance',
      severity: 'info',
      title: 'Listener far beyond critical distance',
      detail: `Reverberant sound dominates beyond ${m.criticalDistance.toFixed(2)} m from the source. Moving closer improves directness.`,
    });
  }
  return out;
}

export function reflectionPanels(room: Room): Omit<Panel, 'id'>[] {
  const out: Omit<Panel, 'id'>[] = [];
  for (const p of earlyReflections(room, 1)) {
    if (p.levelDb < -10) continue;
    const w = p.walls[0];
    const [a, b] = edge(room.vertices, w);
    const t = dist(a, p.points[1]) / dist(a, b);
    const panel = centred(room, w, t, PANEL_W, 'absorber-50');
    if (panel) out.push(panel);
  }
  return out;
}

export function cornerTraps(room: Room): Omit<Panel, 'id'>[] {
  const out: Omit<Panel, 'id'>[] = [];
  const n = room.vertices.length;
  const w = 0.6;
  for (let i = 0; i < n; i++) {
    const L = wallLength(room, i);
    const f = Math.min(0.45, w / L);
    if (free(room, i, 0, f)) out.push({ wall: i, t0: 0, t1: f, material: 'absorber-100', height: room.height });
    if (free(room, i, 1 - f, 1)) out.push({ wall: i, t0: 1 - f, t1: 1, material: 'absorber-100', height: room.height });
  }
  return out;
}

/** Spread `count` panels along the longest untreated stretches of wall. */
export function distributePanels(room: Room, count: number): Omit<Panel, 'id'>[] {
  const out: Omit<Panel, 'id'>[] = [];
  const virtual: Room = { ...room, panels: [...room.panels] };
  const prefer = reflectionPanels(room);
  for (const p of prefer) {
    if (out.length >= count) break;
    out.push({ ...p, material: 'absorber-100' });
    virtual.panels.push({ ...p, id: 'v' });
  }
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    // Find the largest free gap on any wall.
    let best: { wall: number; t0: number; t1: number; len: number } | null = null;
    for (let w = 0; w < room.vertices.length; w++) {
      if (material(room.wallMaterials[w]).alpha[3] > 0.9) continue;
      const L = wallLength(room, w);
      const occ = virtual.panels.filter((p) => p.wall === w).map((p) => [p.t0, p.t1]).sort((a, b) => a[0] - b[0]);
      let cur = 0;
      for (const [a, b] of [...occ, [1, 1]]) {
        if ((a - cur) * L > (best?.len ?? 0)) best = { wall: w, t0: cur, t1: a, len: (a - cur) * L };
        cur = Math.max(cur, b);
      }
    }
    if (!best || best.len < PANEL_W * 0.8) break;
    const panel = centred(virtual, best.wall, (best.t0 + best.t1) / 2, PANEL_W, 'absorber-100');
    if (!panel) break;
    out.push(panel);
    virtual.panels.push({ ...panel, id: 'v' });
  }
  return out;
}
