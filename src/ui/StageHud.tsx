import { Pause, Play, RotateCcw, Zap, Radio, Loader2 } from 'lucide-react';
import { useStore } from '../state/store';
import type { WaveControls } from './Stage';
import { bassColor } from './Stage';

export function WavesHud({ ctl, setCtl, info, onPulse, onReset }: {
  ctl: WaveControls;
  setCtl: (c: WaveControls) => void;
  info: { timeMs: number; slowmo: number; level: number; maxFreq: number };
  onPulse: () => void;
  onReset: () => void;
}) {
  const maxF = Math.max(100, Math.min(2000, Math.floor(info.maxFreq / 10) * 10));
  return (
    <div className="hud hud-bottom">
      <div className="hud-group">
        <div className="seg seg-sm" role="tablist" aria-label="Excitation">
          <button className={ctl.mode === 'pulse' ? 'on' : ''} onClick={() => setCtl({ ...ctl, mode: 'pulse' })}><Zap size={13} /> Impulse</button>
          <button className={ctl.mode === 'tone' ? 'on' : ''} onClick={() => setCtl({ ...ctl, mode: 'tone' })}><Radio size={13} /> Tone</button>
        </div>
        {ctl.mode === 'pulse' ? (
          <button className="btn btn-primary btn-sm" onClick={onPulse}><Zap size={13} /> Fire from source</button>
        ) : (
          <label className="hud-slider">
            <span>{Math.min(ctl.freq, maxF)} Hz</span>
            <input type="range" min={40} max={maxF} step={5} value={Math.min(ctl.freq, maxF)} onChange={(e) => setCtl({ ...ctl, freq: +e.target.value })} aria-label="Tone frequency" />
          </label>
        )}
      </div>
      <div className="hud-group">
        <label className="hud-slider">
          <span>Speed</span>
          <input type="range" min={1} max={16} value={ctl.speed} onChange={(e) => setCtl({ ...ctl, speed: +e.target.value })} aria-label="Simulation speed" />
        </label>
        <button className="icon-btn" onClick={() => setCtl({ ...ctl, paused: !ctl.paused })} aria-label={ctl.paused ? 'Resume' : 'Pause'} title={ctl.paused ? 'Resume' : 'Pause'}>
          {ctl.paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button className="icon-btn" onClick={onReset} aria-label="Clear field" title="Clear field"><RotateCcw size={15} /></button>
      </div>
      <div className="hud-readout">
        <span><b>{info.timeMs.toFixed(1)}</b> ms</span>
        <span><b>1/{Math.round(info.slowmo)}</b>× speed</span>
        <span className="hud-tip">Click anywhere in the room to drop a pulse</span>
      </div>
    </div>
  );
}

export function RaysHud({ info, onEmit }: { info: { timeMs: number; alive: number; hits: number }; onEmit: () => void }) {
  return (
    <div className="hud hud-top-right">
      <button className="btn btn-primary btn-sm" onClick={onEmit}><Zap size={13} /> Emit 900 rays</button>
      <div className="hud-readout">
        <span><b>{info.timeMs.toFixed(0)}</b> ms</span>
        <span><b>{info.alive}</b> alive</span>
      </div>
    </div>
  );
}

export function BassHud() {
  const freq = useStore((s) => s.bassFreq);
  const set = useStore((s) => s.set);
  const status = useStore((s) => s.bassMap.status);
  const bass = useStore((s) => s.bass.result);
  const map = useStore((s) => s.bassMap.result);
  const room = useStore((s) => s.room);
  let listenerDb: number | null = null;
  if (map) {
    const i = Math.floor((room.listener.x - map.ox) / map.dx), j = Math.floor((room.listener.y - map.oy) / map.dx);
    const v = map.db[j * map.nx + i];
    if (Number.isFinite(v)) listenerDb = v;
  }
  return (
    <div className="hud hud-bottom">
      <div className="hud-group grow">
        <label className="hud-slider wide">
          <span>{freq} Hz</span>
          <input type="range" min={20} max={300} value={freq} onChange={(e) => set({ bassFreq: +e.target.value })} aria-label="Bass map frequency" />
        </label>
        {status === 'running' && <Loader2 size={15} className="spin muted" />}
      </div>
      {bass && bass.peaks.length > 0 && (
        <div className="hud-group chips">
          <span className="hud-label">Modes</span>
          {bass.peaks.slice(0, 6).map((p) => (
            <button key={p.f} className={`chip ${Math.abs(p.f - freq) < 1 ? 'on' : ''}`} onClick={() => set({ bassFreq: Math.round(p.f) })}>{p.f.toFixed(0)}</button>
          ))}
        </div>
      )}
      <div className="hud-readout">
        <span className="legend">
          <i style={{ background: `linear-gradient(90deg, rgb(${bassColor(-12)}), rgb(${bassColor(0)}), rgb(${bassColor(12)}))` }} />
          −12 … +12 dB
        </span>
        {listenerDb !== null && (
          <span>Listener <b className={listenerDb < -6 ? 'bad' : listenerDb > 6 ? 'warn' : ''}>{listenerDb > 0 ? '+' : ''}{listenerDb.toFixed(1)} dB</b>{listenerDb < -6 ? ' · null' : listenerDb > 6 ? ' · peak' : ''}</span>
        )}
      </div>
    </div>
  );
}
