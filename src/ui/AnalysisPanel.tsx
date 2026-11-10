import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { useStore, type Quality } from '../state/store';
import { BANDS } from '../engine/types';
import { targetRT, midT, ROOM_USES } from '../engine/advisor';
import { RTChart, EDCChart, IRChart, BassChart, BAND_COLORS, bandLabel } from './charts';

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

export function AnalysisPanel() {
  const analysis = useStore((s) => s.analysis);
  const bass = useStore((s) => s.bass);
  const use = useStore((s) => s.use);
  const quality = useStore((s) => s.quality);
  const set = useStore((s) => s.set);
  const r = analysis.result;

  if (!r) {
    return (
      <div className="panel-body center">
        {analysis.status === 'error' ? (
          <div className="empty"><AlertTriangle size={20} /><p>Simulation failed: {analysis.error}</p></div>
        ) : (
          <div className="empty"><Loader2 className="spin" size={20} /><p>Tracing sound through your room…</p><Progress value={analysis.progress} /></div>
        )}
      </div>
    );
  }
  const m = r.metrics;
  const target = targetRT(use, m.volume);
  const T = midT(m);
  const delta = T - target.target;
  const status = Math.abs(delta) <= target.tol ? 'good' : delta > 0 ? 'warn' : 'info';
  const c50 = (m.c50[2] + m.c50[3]) / 2;
  const c80 = (m.c80[2] + m.c80[3] + m.c80[4]) / 3;
  const d50 = (m.d50[2] + m.d50[3]) / 2;
  const edt = ((m.edt[2] ?? 0) + (m.edt[3] ?? 0)) / 2;

  return (
    <div className="panel-body">
      <div className={`sim-status ${analysis.status === 'running' ? 'busy' : ''}`}>
        {analysis.status === 'running' ? <Loader2 size={13} className="spin" /> : <span className="live-dot" />}
        <span>{analysis.status === 'running' ? 'Re-simulating…' : `${r.stats.rays.toLocaleString()} rays · ${(r.stats.reflections / 1e6).toFixed(2)}M reflections · ${(r.stats.ms / 1000).toFixed(2)} s`}</span>
        <div className="seg seg-xs" role="tablist" aria-label="Simulation quality">
          {(['draft', 'standard', 'high'] as Quality[]).map((q) => (
            <button key={q} className={quality === q ? 'on' : ''} onClick={() => set({ quality: q })}>{q === 'draft' ? 'Draft' : q === 'standard' ? 'Std' : 'High'}</button>
          ))}
        </div>
        {analysis.status === 'running' && <Progress value={analysis.progress} />}
      </div>

      <section className="hero-metric">
        <div>
          <span className="eyebrow">Reverberation time · T30 mid</span>
          <div className="big"><span className="num-xl">{T.toFixed(2)}</span><span className="unit">s</span></div>
          <span className={`delta ${status}`}>
            {status === 'good' ? 'On target' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)} s vs`} {target.target.toFixed(2)} s for {ROOM_USES.find((u) => u.id === use)?.label.toLowerCase()}
          </span>
        </div>
        <div className="mini-kpis">
          <Kpi label="EDT" value={fmt(edt)} unit="s" hint="Early decay time — perceived reverberance" />
          <Kpi label="C50" value={`${c50 >= 0 ? '+' : ''}${fmt(c50, 1)}`} unit="dB" hint="Speech clarity: early (0–50 ms) vs late energy" />
          <Kpi label="C80" value={`${c80 >= 0 ? '+' : ''}${fmt(c80, 1)}`} unit="dB" hint="Music clarity: early (0–80 ms) vs late energy" />
          <Kpi label="D50" value={fmt(d50 * 100, 0)} unit="%" hint="Definition: share of energy in the first 50 ms" />
          <Kpi label="r꜀" value={fmt(m.criticalDistance)} unit="m" hint="Critical distance: where direct = reverberant level" />
          <Kpi label="f꜀" value={fmt(m.schroeder, 0)} unit="Hz" hint="Schroeder frequency: below it, room modes dominate" />
        </div>
      </section>

      <section>
        <div className="chart-head">
          <span className="chart-title">Reverberation by frequency</span>
          <span className="legend-row">
            <span><i className="lg bar" />Simulated</span>
            <span><i className="lg sab" />Sabine</span>
            <span><i className="lg eyr" />Eyring</span>
            <span><i className="lg tgt" />Target</span>
          </span>
        </div>
        <RTChart t30={m.t30.map((v, i) => v ?? m.t20[i])} sabine={m.sabine} eyring={m.eyring} target={target} />
        <p className="note">Simulation and the classic formulas disagree when absorption is unevenly spread — the ray tracer is the one to trust there.</p>
      </section>

      <section>
        <IRChart result={r} />
      </section>

      <section>
        <div className="chart-head">
          <span className="chart-title">Energy decay</span>
          <span className="legend-row">{BANDS.map((f, i) => <span key={f}><i className="lg" style={{ background: BAND_COLORS[i] }} />{bandLabel(f)}</span>)}</span>
        </div>
        <EDCChart edc={r.edc} />
      </section>

      <section>
        <div className="chart-head">
          <span className="chart-title">Bass response at listener</span>
          {bass.status === 'running' && <Loader2 size={13} className="spin muted" />}
        </div>
        {bass.result ? (
          <>
            <BassChart data={bass.result} />
            <p className="note"><Info size={12} /> 2D wave simulation of the floor plan. Click the curve to see where that frequency peaks and cancels in the room. Dotted lines mark floor–ceiling modes.</p>
          </>
        ) : bass.status === 'error' ? <p className="note">Bass simulation failed: {bass.error}</p> : <div className="skeleton" style={{ height: 160 }} />}
      </section>

      <section>
        <div className="chart-head"><span className="chart-title">Early reflections</span><span className="muted small">{r.reflections.length} paths ≤ 2nd order</span></div>
        <table className="refl">
          <thead><tr><th>Path</th><th>Delay</th><th>Level</th><th /></tr></thead>
          <tbody>
            {r.reflections.slice(0, 10).map((p, i) => (
              <tr key={i}>
                <td>{p.walls.map((w) => `W${w + 1}`).join(' → ')}</td>
                <td>{p.delayMs.toFixed(1)} ms</td>
                <td>{p.levelDb.toFixed(1)} dB</td>
                <td><span className="meter"><i style={{ width: `${Math.max(2, Math.min(100, (p.levelDb + 24) * 4))}%` }} /></span></td>
              </tr>
            ))}
            {r.reflections.length === 0 && <tr><td colSpan={4} className="muted">No specular wall reflections reach the listener.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) {
  return (
    <div className="kpi" title={hint}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-val">{value}<small>{unit}</small></span>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="progress"><i style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, value))})` }} /></div>;
}
