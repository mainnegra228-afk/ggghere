import { encodeWav, renderClap, renderDrums, renderGuitar } from './samples';

export type SourceKind = 'clap' | 'drums' | 'guitar' | 'mic' | 'file';
type Listener = () => void;

/**
 * Web Audio graph:  source ─┬─ dry ───────────────┐
 *                           └─ convolver ─ wet ───┴─ master ─ analyser ─ out
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private convolver: { node: ConvolverNode; gain: GainNode } | null = null;
  private convIn!: GainNode;
  analyser!: AnalyserNode;
  private node: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private ir: Float32Array | null = null;
  fileName: string | null = null;
  playing: SourceKind | null = null;
  roomOn = true;
  volume = 0.8;
  private listeners = new Set<Listener>();

  /** Fixed so IRs can be computed before the (gesture-gated) AudioContext exists. */
  readonly sampleRate = 48000;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit() { this.listeners.forEach((l) => l()); }

  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: this.sampleRate });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convIn = ctx.createGain();
    this.dry.gain.value = this.roomOn ? 0 : 1;
    this.wet.gain.value = this.roomOn ? 1 : 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;
    this.dry.connect(this.master);
    this.wet.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    if (this.ir) this.applyIR(this.ir);
    return ctx;
  }

  /** Swap in a new impulse response with a short crossfade so playback never clicks. */
  setIR(ir: Float32Array) {
    this.ir = ir;
    if (this.ctx) this.applyIR(ir);
  }

  private applyIR(ir: Float32Array) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    buf.copyToChannel(ir as Float32Array<ArrayBuffer>, 0);
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.convIn.connect(conv);
    conv.connect(gain);
    gain.connect(this.wet);
    const now = ctx.currentTime;
    gain.gain.setTargetAtTime(1, now, 0.04);
    const old = this.convolver;
    if (old) {
      old.gain.gain.setTargetAtTime(0, now, 0.04);
      setTimeout(() => { try { this.convIn.disconnect(old.node); old.node.disconnect(); old.gain.disconnect(); } catch { /* already gone */ } }, 400);
    }
    this.convolver = { node: conv, gain };
  }

  setRoomOn(on: boolean) {
    this.roomOn = on;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.wet.gain.setTargetAtTime(on ? 1 : 0, t, 0.03);
      this.dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
    }
    this.emit();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    this.emit();
  }

  private builtIn(kind: 'clap' | 'drums' | 'guitar'): AudioBuffer {
    const ctx = this.context();
    const key = `${kind}@${ctx.sampleRate}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      const data = kind === 'clap' ? renderClap(ctx.sampleRate) : kind === 'drums' ? renderDrums(ctx.sampleRate) : renderGuitar(ctx.sampleRate);
      buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  async loadFile(file: File) {
    const ctx = this.context();
    const data = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(data);
    // Mix down to mono: the room model has a single omnidirectional receiver.
    const mono = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
    const out = mono.getChannelData(0);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const d = decoded.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / decoded.numberOfChannels;
    }
    this.buffers.set('file', mono);
    this.fileName = file.name;
    this.emit();
  }

  hasFile() { return this.buffers.has('file'); }

  private connectSource(node: AudioNode) {
    node.connect(this.dry);
    node.connect(this.convIn);
  }

  async play(kind: SourceKind) {
    this.stop(false);
    const ctx = this.context();
    if (ctx.state !== 'running') await ctx.resume();
    if (kind === 'mic') {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        this.emit();
        throw new Error(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'No microphone is available.');
      }
      const src = ctx.createMediaStreamSource(this.stream);
      this.connectSource(src);
      this.node = src;
    } else {
      const buf = kind === 'file' ? this.buffers.get('file') : this.builtIn(kind);
      if (!buf) throw new Error('Load an audio file first.');
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.connectSource(src);
      src.start();
      this.node = src;
    }
    this.playing = kind;
    this.emit();
  }

  stop(emit = true) {
    if (this.node) {
      try {
        if (this.node instanceof AudioBufferSourceNode) this.node.stop();
        this.node.disconnect();
      } catch { /* already stopped */ }
      this.node = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.playing = null;
    if (emit) this.emit();
  }

  /** Offline-render the chosen material through the room into a WAV file. */
  async render(kind: Exclude<SourceKind, 'mic'>): Promise<Blob> {
    const ctx = this.context();
    const src = kind === 'file' ? this.buffers.get('file') : this.builtIn(kind);
    if (!src) throw new Error('Load an audio file first.');
    if (!this.ir) throw new Error('The room is still being simulated.');
    const fs = ctx.sampleRate;
    const length = src.length + this.ir.length;
    const off = new OfflineAudioContext(1, length, fs);
    const s = off.createBufferSource();
    s.buffer = src.sampleRate === fs ? src : await resample(src, fs);
    const conv = off.createConvolver();
    conv.normalize = false;
    const irBuf = off.createBuffer(1, this.ir.length, fs);
    irBuf.copyToChannel(this.ir as Float32Array<ArrayBuffer>, 0);
    conv.buffer = irBuf;
    s.connect(conv);
    conv.connect(off.destination);
    s.start();
    const out = await off.startRendering();
    const data = out.getChannelData(0);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.95) for (let i = 0; i < data.length; i++) data[i] *= 0.95 / peak;
    return encodeWav([data], fs, 16);
  }

  irWav(): Blob | null {
    if (!this.ir) return null;
    return encodeWav([this.ir], this.sampleRate, 24);
  }
}

async function resample(buf: AudioBuffer, fs: number): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, Math.ceil((buf.length * fs) / buf.sampleRate), fs);
  const s = off.createBufferSource();
  s.buffer = buf;
  s.connect(off.destination);
  s.start();
  return off.startRendering();
}

export const audio = new AudioEngine();

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
