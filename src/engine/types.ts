export interface Vec2 {
  x: number;
  y: number;
}

/** Octave band centre frequencies used throughout the engine. */
export const BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export const NB = BANDS.length;
export type BandValues = [number, number, number, number, number, number];

export interface Material {
  id: string;
  name: string;
  group: 'Structure' | 'Surface' | 'Floor' | 'Ceiling' | 'Treatment' | 'Furnishing';
  /** Absorption coefficient per octave band (0..1). */
  alpha: BandValues;
  /** Scattering coefficient (0 = mirror, 1 = fully diffuse). */
  scatter: number;
  color: string;
}

/** A treatment patch applied to part of a wall, parameterised along the wall (0..1). */
export interface Panel {
  id: string;
  wall: number;
  t0: number;
  t1: number;
  material: string;
  /** Vertical size in metres (default 0.6, centred at ear height). ≥ room height = floor to ceiling. */
  height?: number;
}

export interface Room {
  name: string;
  /** Floor plan polygon in metres. Edge i runs from vertices[i] to vertices[i+1]. */
  vertices: Vec2[];
  wallMaterials: string[];
  panels: Panel[];
  floor: string;
  ceiling: string;
  height: number;
  source: Vec2;
  listener: Vec2;
}

export interface RayTraceSettings {
  rays: number;
  receiverRadius: number;
  /** Max simulated time in seconds. */
  maxTime: number;
  seed: number;
}

export interface AcousticMetrics {
  /** Simulated T30 per band (s), null when the decay range is insufficient. */
  t30: (number | null)[];
  t20: (number | null)[];
  edt: (number | null)[];
  sabine: number[];
  eyring: number[];
  c50: number[];
  c80: number[];
  d50: number[];
  /** Direct-to-reverberant ratio (dB, broadband). */
  drr: number;
  /** Critical distance (m) at 1 kHz. */
  criticalDistance: number;
  /** Equivalent absorption area per band (m² Sabine). */
  absorptionArea: number[];
  volume: number;
  surface: number;
  floorArea: number;
  /** Schroeder frequency (Hz). */
  schroeder: number;
}

export interface ReflectionPath {
  order: number;
  /** Plan-view points from source to listener (reflection points in between). */
  points: Vec2[];
  /** Wall index of each reflection. */
  walls: number[];
  delayMs: number;
  levelDb: number;
}
