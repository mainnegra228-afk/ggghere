import { useEffect, useMemo, useRef, useState } from 'react';
import { BANDS } from '../engine/types';
import type { AnalysisResult } from '../state/store';
import { useStore } from '../state/store';
import type { BassResponse } from '../engine/fdtd';

export const BAND_COLORS = ['#7b84ff', '#5fb0ff', '#5fd4e6', '#9be38f', '#ffd166', '#ffa94d'];
export const bandLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

function niceMax(v: number) {
  const steps = [0.2, 0.25, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];
  return steps.find((s) => s >= v) ?? Math.ceil(v);
}

export function RTChart({ t30, sabine, eyring, target }: { t30: (number | null)[]; sabine: number[]; eyring: number[]; target: { target: number; tol: number } }) {
  const W = 360, H = 170, pl = 34, pr = 8, pt = 10, pb = 22;
  const vals = [...t30.filter((v): v is number => v !== null), ...sabine, ...eyring, target.target + target.tol];
  const max = niceMax(Math.max(...vals) * 1.08);
  const x = (i: number) => pl + ((W - pl - pr) / 6) * (i + 0.5);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / max);
  const bw = ((W - pl - pr) / 6) * 0.46;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Reverberation time per octave band">
      <defs>
        <linearGradient id="bar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffb35c" />
          <stop offset="1" stopColor="#ff7a45" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pl - 6} y={y(t) + 3} className="tick" textAnchor="end">{t.toFixed(max < 2 ? 2 : 1)}</text>
        </g>
      ))}
      <rect x={pl} width={W - pl - pr} y={y(target.target + target.tol)} height={Math.max(1, y(target.target - target.tol) - y(target.target + target.tol))} className="target-zone" />
      <line x1={pl} x2={W - pr} y1={y(target.target)} y2={y(target.target)} className="target-line" />
      {t30.map((v, i) => v !== null && (
        <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, H - pb - y(v))} rx={3} fill="url(#bar)" className="bar">
          <title>{`${BANDS[i]} Hz · simulated T30 ${v.toFixed(2)} s`}</title>
        </rect>
      ))}
      <path d={line(eyring)} className="eyring" />
      <path d={line(sabine)} className="sabine" />
      {sabine.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.6} className="sabine-dot"><title>{`Sabine ${v.toFixed(2)} s`}</title></circle>)}
      {BANDS.map((f, i) => <text key={f} x={x(i)} y={H - 6} className="tick" textAnchor="middle">{bandLabel(f)}</text>)}
    </svg>
  );
}

export function EDCChart({ edc }: { edc: AnalysisResult['edc'] }) {
  const W = 360, H = 150, pl = 34, pr = 8, pt = 8, pb = 20;
  const longest = Math.max(...edc.curves.map((c) => c.length)) * edc.step;
  const tmax = niceMax(longest);
  const x = (t: number) => pl + (W - pl - pr) * (t / tmax);
  const y = (db: number) => pt + (H - pt - pb) * (-db / 60);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Energy decay curves">
      {[0, -10, -20, -30, -40, -50, -60].map((d) => (
        <g key={d}>
          <line x1={pl} x2={W - pr} y1={y(d)} y2={y(d)} className="grid" />
          <text x={pl - 6} y={y(d) + 3} className="tick" textAnchor="end">{d}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={x(f * tmax)} y={H - 5} className="tick" textAnchor="middle">{(f * tmax).toFixed(tmax < 1 ? 2 : 1)}s</text>)}
      {edc.curves.map((c, b) => (
        <path key={b} d={c.map((v, i) => `${i ? 'L' : 'M'}${x(i * edc.step)},${y(Math.max(-60, v))}`).join('')} stroke={BAND_COLORS[b]} className="curve" />
      ))}
    </svg>
  );
}

export function IRChart({ result }: { result: AnalysisResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [span, setSpan] = useState<'early' | 'full'>('early');
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ir = result.ir;
    const fs = result.sampleRate;
    const start = Math.max(0, Math.floor((result.directTime - 0.003) * fs));
    const end = span === 'early' ? Math.min(ir.length, start + Math.round(0.15 * fs)) : ir.length;
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(ir[i]));
    const mid = H / 2;
    const per = (end - start) / W;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#5fd4e6');
    grad.addColorStop(0.3, '#ffb35c');
    grad.addColorStop(1, 'rgba(255,122,69,0.6)');
    ctx.fillStyle = grad;
    for (let x = 0; x < W; x++) {
      let mn = 0, mx = 0;
      const a = start + Math.floor(x * per), b = Math.min(end, start + Math.floor((x + 1) * per) + 1);
      for (let i = a; i < b; i++) { const v = ir[i] / (peak || 1); if (v < mn) mn = v; if (v > mx) mx = v; }
      // Gentle compression keeps the reverberant tail visible next to the direct sound.
      const comp = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
      const y0 = mid - comp(mx) * (mid - 4), y1 = mid - comp(mn) * (mid - 4);
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    if (span === 'early') {
      ctx.font = '500 9px "JetBrains Mono Variable", monospace';
      for (const r of result.reflections.filter((r) => r.order === 1)) {
        const t = r.delayMs / 1000 + 0.003;
        const px = (t * fs) / per;
        if (px > W) continue;
        ctx.strokeStyle = 'rgba(95,212,230,0.4)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(px, 10); ctx.lineTo(px, H); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(95,212,230,0.8)';
        ctx.fillText(`W${r.walls[0] + 1}`, px + 2, 9);
      }
    }
  }, [result, span]);
  return (
    <div className="ir-chart">
      <div className="chart-head">
        <span className="chart-title">Impulse response</span>
        <div className="seg seg-xs">
          <button className={span === 'early' ? 'on' : ''} onClick={() => setSpan('early')}>150 ms</button>
          <button className={span === 'full' ? 'on' : ''} onClick={() => setSpan('full')}>Full {(result.ir.length / result.sampleRate).toFixed(1)} s</button>
        </div>
      </div>
      <canvas ref={ref} className="ir-canvas" aria-label="Impulse response waveform" />
    </div>
  );
}

export function BassChart({ data }: { data: BassResponse }) {
  const freq = useStore((s) => s.bassFreq);
  const set = useStore((s) => s.set);
  const W = 360, H = 160, pl = 30, pr = 8, pt = 10, pb = 20;
  const fmin = 20, fmax = 300;
  const x = (f: number) => pl + (W - pl - pr) * (Math.log(f / fmin) / Math.log(fmax / fmin));
  const lo = -18, hi = 15;
  const y = (d: number) => pt + (H - pt - pb) * (1 - (Math.max(lo, Math.min(hi, d)) - lo) / (hi - lo));
  const path = useMemo(() => data.freqs.map((f, i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(data.db[i]).toFixed(1)}`).join(''), [data]);
  const area = `${path}L${x(data.freqs[data.freqs.length - 1])},${y(lo)}L${x(data.freqs[0])},${y(lo)}Z`;
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const f = fmin * Math.exp(((px - pl) / (W - pl - pr)) * Math.log(fmax / fmin));
    if (f >= fmin && f <= fmax) set({ bassFreq: Math.round(f), view: 'bass' });
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart clickable" onClick={onClick} role="img" aria-label="Low-frequency response at the listener. Click to map a frequency.">
      <defs>
        <linearGradient id="bassfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5fd4e6" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5fd4e6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[-15, -10, -5, 0, 5, 10, 15].map((d) => (
        <g key={d}>
          <line x1={pl} x2={W - pr} y1={y(d)} y2={y(d)} className={d === 0 ? 'grid strong' : 'grid'} />
          <text x={pl - 5} y={y(d) + 3} className="tick" textAnchor="end">{d}</text>
        </g>
      ))}
      {[20, 30, 50, 80, 100, 150, 200, 300].map((f) => <text key={f} x={x(f)} y={H - 5} className="tick" textAnchor="middle">{f}</text>)}
      {data.verticalModes.map((f) => <line key={f} x1={x(f)} x2={x(f)} y1={pt} y2={H - pb} className="vmode"><title>{`Floor–ceiling mode ${f.toFixed(0)} Hz (not in 2D sim)`}</title></line>)}
      <path d={area} fill="url(#bassfill)" />
      <path d={path} className="bass-line" />
      <line x1={x(freq)} x2={x(freq)} y1={pt} y2={H - pb} className="cursor-line" />
    </svg>
  );
}
