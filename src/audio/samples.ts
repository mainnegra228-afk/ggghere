/** Procedurally generated test material, rendered once per sample rate. */

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function normalise(x: Float32Array, peak = 0.8) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

export function renderClap(fs: number): Float32Array {
  const out = new Float32Array(Math.round(fs * 2.4));
  const noise = rand(11);
  const clap = (start: number, gain: number) => {
    // A hand clap is a few rapid noise bursts followed by a short tail.
    for (const [offMs, g] of [[0, 1], [9, 0.8], [17, 0.65]] as const) {
      const s0 = start + Math.round((offMs / 1000) * fs);
      const L = Math.round(fs * (offMs === 17 ? 0.09 : 0.012));
      let lp = 0;
      for (let i = 0; i < L && s0 + i < out.length; i++) {
        const env = Math.exp(-i / (fs * (offMs === 17 ? 0.022 : 0.003)));
        lp += 0.55 * (noise() - lp);
        out[s0 + i] += (noise() - lp * 0.6) * env * g * gain;
      }
    }
  };
  clap(0, 1);
  clap(Math.round(fs * 1.2), 0.9);
  return normalise(out);
}

export function renderDrums(fs: number): Float32Array {
  const bpm = 96;
  const beat = 60 / bpm;
  const bars = 2;
  const out = new Float32Array(Math.round(fs * beat * 4 * bars));
  const noise = rand(5);
  const kick = (t: number) => {
    const s0 = Math.round(t * fs);
    let ph = 0;
    for (let i = 0; i < fs * 0.45 && s0 + i < out.length; i++) {
      const tt = i / fs;
      const f = 45 + 110 * Math.exp(-tt * 28);
      ph += (2 * Math.PI * f) / fs;
      out[s0 + i] += Math.sin(ph) * Math.exp(-tt * 7) * 0.95;
    }
  };
  const snare = (t: number, g = 0.7) => {
    const s0 = Math.round(t * fs);
    let hp = 0, prev = 0;
    for (let i = 0; i < fs * 0.3 && s0 + i < out.length; i++) {
      const tt = i / fs;
      const n = noise();
      hp = 0.85 * (hp + n - prev); prev = n;
      out[s0 + i] += (hp * Math.exp(-tt * 18) * 0.8 + Math.sin(2 * Math.PI * 185 * tt) * Math.exp(-tt * 30) * 0.5) * g;
    }
  };
  const hat = (t: number, g: number) => {
    const s0 = Math.round(t * fs);
    let hp = 0, prev = 0;
    for (let i = 0; i < fs * 0.06 && s0 + i < out.length; i++) {
      const n = noise();
      hp = 0.6 * (hp + n - prev); prev = n;
      out[s0 + i] += hp * Math.exp(-(i / fs) * 70) * g;
    }
  };
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4 * beat;
    kick(b0); kick(b0 + 2.5 * beat); if (bar === 1) kick(b0 + 1.75 * beat);
    snare(b0 + beat); snare(b0 + 3 * beat);
    for (let e = 0; e < 8; e++) hat(b0 + e * beat * 0.5, e % 2 ? 0.18 : 0.3);
  }
  return normalise(out);
}

/** Karplus–Strong plucked string arpeggios over Am – F – C – G. */
export function renderGuitar(fs: number): Float32Array {
  const bpm = 84;
  const eighth = 60 / bpm / 2;
  const chords = [
    [57, 64, 69, 72, 76], // Am
    [53, 60, 65, 69, 72], // F
    [48, 55, 60, 64, 67], // C
    [55, 59, 62, 67, 71], // G
  ];
  const pattern = [0, 2, 3, 4, 3, 2, 1, 2];
  const out = new Float32Array(Math.round(fs * eighth * 8 * chords.length));
  const noise = rand(23);
  const pluck = (t: number, midi: number, g: number) => {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const N = Math.max(2, Math.round(fs / f));
    const buf = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += 0.5 * (noise() - lp); buf[i] = lp; }
    const s0 = Math.round(t * fs);
    const L = Math.min(out.length - s0, Math.round(fs * 1.6));
    let idx = 0;
    for (let i = 0; i < L; i++) {
      const cur = buf[idx];
      const nxt = buf[(idx + 1) % N];
      buf[idx] = 0.996 * 0.5 * (cur + nxt);
      out[s0 + i] += cur * g;
      idx = (idx + 1) % N;
    }
  };
  chords.forEach((ch, ci) => {
    pattern.forEach((p, k) => pluck((ci * 8 + k) * eighth, ch[p], k === 0 ? 0.9 : 0.6));
  });
  return normalise(out, 0.75);
}

export function encodeWav(channels: Float32Array[], fs: number, bits: 16 | 24 = 16): Blob {
  const n = channels[0].length;
  const ch = channels.length;
  const bps = bits / 8;
  const buf = new ArrayBuffer(44 + n * ch * bps);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bps, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, fs, true); v.setUint32(28, fs * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, n * ch * bps, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) { v.setInt16(o, Math.round(s * 32767), true); o += 2; }
      else {
        const x = Math.round(s * 8388607);
        v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff); o += 3;
      }
    }
  return new Blob([buf], { type: 'audio/wav' });
}
