import { CheckCircle2, AlertTriangle, XCircle, Info, Wand2, Loader2 } from 'lucide-react';
import { useStore } from '../state/store';
import { advise, ROOM_USES, type Severity } from '../engine/advisor';

const ICON: Record<Severity, typeof Info> = { good: CheckCircle2, info: Info, warn: AlertTriangle, bad: XCircle };

export function AdvicePanel() {
  const room = useStore((s) => s.room);
  const result = useStore((s) => s.analysis.result);
  const status = useStore((s) => s.analysis.status);
  const use = useStore((s) => s.use);
  const set = useStore((s) => s.set);
  const addPanels = useStore((s) => s.addPanels);
  const toast = useStore((s) => s.toast);

  if (!result) return <div className="panel-body center"><div className="empty"><Loader2 className="spin" size={20} /><p>Waiting for the first simulation…</p></div></div>;
  const findings = advise(room, result.metrics, use);
  const penalty = findings.reduce((s, f) => s + (f.severity === 'bad' ? 28 : f.severity === 'warn' ? 14 : f.severity === 'info' ? 4 : 0), 0);
  const score = Math.max(0, 100 - penalty);
  const R = 34, C = 2 * Math.PI * R;
  const tone = score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad';

  return (
    <div className="panel-body">
      <section>
        <h3>What is this room for?</h3>
        <div className="uses">
          {ROOM_USES.map((u) => (
            <button key={u.id} className={`use ${use === u.id ? 'on' : ''}`} onClick={() => set({ use: u.id })} title={u.hint}>{u.label}</button>
          ))}
        </div>
      </section>

      <section className="score">
        <svg width={84} height={84} viewBox="0 0 84 84" aria-hidden>
          <circle cx={42} cy={42} r={R} className="ring-bg" />
          <circle cx={42} cy={42} r={R} className={`ring ${tone}`} strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} transform="rotate(-90 42 42)" />
        </svg>
        <div>
          <span className="eyebrow">Room score</span>
          <div className="big"><span className="num-xl">{score}</span><span className="unit">/100</span></div>
          <span className="muted small">{status === 'running' ? 'Updating…' : `${findings.filter((f) => f.severity !== 'good').length} issue${findings.filter((f) => f.severity !== 'good').length === 1 ? '' : 's'} found for ${ROOM_USES.find((u) => u.id === use)?.label.toLowerCase()}`}</span>
        </div>
      </section>

      <section className="findings">
        {findings.map((f) => {
          const Icon = ICON[f.severity];
          return (
            <article key={f.id} className={`finding ${f.severity}`}>
              <Icon size={16} className="finding-icon" />
              <div>
                <h4>{f.title}</h4>
                <p>{f.detail}</p>
                {f.action && (
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    const panels = f.action!.panels(room);
                    if (!panels.length) { toast('No free wall space left for that fix', 'warn'); return; }
                    addPanels(panels);
                    toast(`${panels.length} panel${panels.length > 1 ? 's' : ''} added${f.id === 'rt-long' && panels.length < parseInt(f.action!.label.replace(/\D/g, ''), 10) ? ' (walls are full)' : ''} — Ctrl+Z to undo`);
                  }}>
                    <Wand2 size={13} /> {f.action.label}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
      <p className="note">Targets: EBU Tech 3276 for control rooms, DIN 18041 for speech and music rooms. Suggestions use broadband 120 × 60 cm mineral-wool panels.</p>
    </div>
  );
}
