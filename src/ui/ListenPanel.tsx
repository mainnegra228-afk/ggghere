import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Hand, Drum, Guitar, Mic, FileAudio, Play, Square, Download, Headphones, Upload, Loader2 } from 'lucide-react';
import { audio, download, type SourceKind } from '../audio/engine';
import { useStore } from '../state/store';

const SOURCES: { id: SourceKind; label: string; desc: string; icon: typeof Hand }[] = [
  { id: 'clap', label: 'Hand clap', desc: 'The classic room test', icon: Hand },
  { id: 'drums', label: 'Drum loop', desc: 'Kick, snare & hats · 96 bpm', icon: Drum },
  { id: 'guitar', label: 'Plucked guitar', desc: 'Am – F – C – G arpeggio', icon: Guitar },
  { id: 'mic', label: 'Your voice', desc: 'Live microphone · use headphones', icon: Mic },
  { id: 'file', label: 'Your audio', desc: 'Drop any audio file', icon: FileAudio },
];

function useAudio() {
  return useSyncExternalStore(
    (fn) => audio.subscribe(fn),
    () => `${audio.playing}|${audio.roomOn}|${audio.volume}|${audio.fileName}`,
  );
}

export function ListenPanel() {
  useAudio();
  const toast = useStore((s) => s.toast);
  const result = useStore((s) => s.analysis.result);
  const roomName = useStore((s) => s.room.name);
  const [selected, setSelected] = useState<SourceKind>('clap');
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const play = async (kind: SourceKind) => {
    setSelected(kind);
    if (kind === 'file' && !audio.hasFile()) { fileInput.current?.click(); return; }
    try {
      if (audio.playing === kind) audio.stop();
      else await audio.play(kind);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Playback failed', 'error');
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('file');
    try {
      await audio.loadFile(file);
      setSelected('file');
      await audio.play('file');
      toast(`Playing “${file.name}” in the room`);
    } catch {
      toast('Could not decode that file — try WAV, MP3, OGG or M4A', 'error');
    } finally {
      setBusy(null);
    }
  };

  const slug = roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';

  return (
    <div
      className={`panel-body ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); }}
    >
      <section>
        <h3>Hear the room <span className="h-hint">what the listener hears</span></h3>
        <div className="sources">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            const on = audio.playing === s.id;
            return (
              <button key={s.id} className={`source ${on ? 'playing' : ''} ${selected === s.id ? 'sel' : ''}`} onClick={() => play(s.id)} disabled={!result} aria-pressed={on}>
                <span className="source-icon">{busy === s.id ? <Loader2 size={18} className="spin" /> : <Icon size={18} />}</span>
                <span className="source-text">
                  <b>{s.id === 'file' && audio.fileName ? audio.fileName : s.label}</b>
                  <small>{s.desc}</small>
                </span>
                <span className="source-state">{on ? <Square size={13} /> : <Play size={13} />}</span>
                {on && <span className="eq" aria-hidden><i /><i /><i /></span>}
              </button>
            );
          })}
        </div>
        <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
        {audio.fileName && <button className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}><Upload size={14} /> Replace file</button>}
      </section>

      <section className="ab">
        <div className="ab-toggle" role="group" aria-label="Compare">
          <button className={!audio.roomOn ? 'on' : ''} onClick={() => audio.setRoomOn(false)}>Dry</button>
          <button className={audio.roomOn ? 'on' : ''} onClick={() => audio.setRoomOn(true)}>In this room</button>
          <i className="ab-thumb" style={{ transform: `translateX(${audio.roomOn ? 100 : 0}%)` }} />
        </div>
        <label className="vol">
          <span>Volume</span>
          <input type="range" min={0} max={1} step={0.01} value={audio.volume} onChange={(e) => audio.setVolume(+e.target.value)} aria-label="Volume" />
        </label>
      </section>

      <Scope active={!!audio.playing} />
      <p className="note"><Headphones size={12} /> Edits re-simulate instantly — keep something playing while you drag walls or add panels and listen to the room change.</p>

      <section>
        <h3>Export</h3>
        <div className="export-grid">
          <button className="btn btn-ghost" disabled={!result} onClick={() => { const b = audio.irWav(); if (b) { download(b, `${slug}-impulse-response.wav`); toast('Impulse response saved — load it into any convolution reverb'); } }}>
            <Download size={14} /> Impulse response <small>.wav · 48 kHz · 24-bit</small>
          </button>
          <button className="btn btn-ghost" disabled={!result || selected === 'mic' || busy === 'render'} onClick={async () => {
            if (selected === 'mic') return;
            setBusy('render');
            try { download(await audio.render(selected), `${slug}-${selected}.wav`); toast('Rendered audio saved'); }
            catch (e) { toast(e instanceof Error ? e.message : 'Render failed', 'error'); }
            finally { setBusy(null); }
          }}>
            {busy === 'render' ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Render “{SOURCES.find((s) => s.id === selected)?.label}” <small>.wav</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function Scope({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c || !audio.analyser) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      audio.analyser.getByteFrequencyData(freq);
      audio.analyser.getByteTimeDomainData(wave);
      const bars = 64;
      for (let i = 0; i < bars; i++) {
        // Log-spaced bins.
        const a = Math.floor(2 * Math.pow(512 / 2, i / bars)), b = Math.max(a + 1, Math.floor(2 * Math.pow(512 / 2, (i + 1) / bars)));
        let m = 0;
        for (let k = a; k < b; k++) m = Math.max(m, freq[k]);
        const h = (m / 255) * (H - 6);
        ctx.fillStyle = `rgba(255,${150 + i},${80 + i * 2},0.75)`;
        ctx.fillRect((i * W) / bars + 1, H - h, W / bars - 2, h);
      }
      ctx.strokeStyle = 'rgba(95,212,230,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < wave.length; i += 4) {
        const x = (i / wave.length) * W, y = (wave[i] / 255) * H;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <div className={`scope ${active ? '' : 'idle'}`}>
      <canvas ref={ref} aria-label="Output spectrum and waveform" />
      {!active && <span>Press a sound to start listening</span>}
    </div>
  );
}
