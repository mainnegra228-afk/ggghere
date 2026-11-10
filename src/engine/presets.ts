import type { Room, Vec2 } from './types';

const rect = (w: number, d: number): Vec2[] => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d },
];

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  room: Room;
}

export const PRESETS: Preset[] = [
  {
    id: 'bedroom-studio',
    name: 'Bedroom studio',
    blurb: '3.6 × 4.2 m, drywall, untreated',
    room: {
      name: 'Bedroom studio',
      vertices: rect(3.6, 4.2),
      wallMaterials: ['drywall', 'drywall', 'glass', 'drywall'],
      panels: [],
      floor: 'wood-floor',
      ceiling: 'drywall',
      height: 2.6,
      source: { x: 1.8, y: 0.9 },
      listener: { x: 1.8, y: 2.3 },
    },
  },
  {
    id: 'living-l',
    name: 'L-shaped living room',
    blurb: 'Open plan with a window wall',
    room: {
      name: 'L-shaped living room',
      vertices: [
        { x: 0, y: 0 }, { x: 7.5, y: 0 }, { x: 7.5, y: 3.8 }, { x: 4.2, y: 3.8 }, { x: 4.2, y: 6.4 }, { x: 0, y: 6.4 },
      ],
      wallMaterials: ['plaster', 'glass', 'plaster', 'drywall', 'curtain', 'plaster'],
      panels: [{ id: 'p-shelf', wall: 5, t0: 0.25, t1: 0.7, material: 'bookshelf', height: 2.1 }],
      floor: 'wood-floor',
      ceiling: 'plaster',
      height: 2.7,
      source: { x: 1.2, y: 4.6 },
      listener: { x: 3.0, y: 1.6 },
    },
  },
  {
    id: 'bathroom',
    name: 'Tiled bathroom',
    blurb: 'Why you sound great in the shower',
    room: {
      name: 'Tiled bathroom',
      vertices: rect(2.4, 3.0),
      wallMaterials: ['tile', 'tile', 'tile', 'tile'],
      panels: [],
      floor: 'tile',
      ceiling: 'plaster',
      height: 2.5,
      source: { x: 0.8, y: 1.0 },
      listener: { x: 1.0, y: 1.3 },
    },
  },
  {
    id: 'meeting',
    name: 'Glass meeting room',
    blurb: 'Hard surfaces, poor speech clarity',
    room: {
      name: 'Glass meeting room',
      vertices: rect(6, 4.5),
      wallMaterials: ['glass', 'drywall', 'glass', 'drywall'],
      panels: [],
      floor: 'vinyl',
      ceiling: 'plaster',
      height: 2.8,
      source: { x: 1.5, y: 2.25 },
      listener: { x: 4.6, y: 2.0 },
    },
  },
  {
    id: 'chapel',
    name: 'Stone chapel',
    blurb: 'Timber roof, stone walls, ~6 s of reverb',
    room: {
      name: 'Stone chapel',
      vertices: [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 8.5, y: 23 }, { x: 5, y: 24.5 }, { x: 1.5, y: 23 }, { x: 0, y: 20 },
      ],
      wallMaterials: ['stone', 'stone', 'stone', 'stone', 'stone', 'stone', 'stone'],
      panels: [
        { id: 'p-door', wall: 0, t0: 0.4, t1: 0.6, material: 'wood-panel', height: 2.4 },
        { id: 'p-win1', wall: 1, t0: 0.2, t1: 0.3, material: 'glass', height: 4 },
        { id: 'p-win2', wall: 1, t0: 0.55, t1: 0.65, material: 'glass', height: 4 },
        { id: 'p-win3', wall: 6, t0: 0.35, t1: 0.45, material: 'glass', height: 4 },
        { id: 'p-win4', wall: 6, t0: 0.7, t1: 0.8, material: 'glass', height: 4 },
      ],
      floor: 'wood-floor',
      ceiling: 'wood-panel',
      height: 11,
      source: { x: 5, y: 20 },
      listener: { x: 4.2, y: 7 },
    },
  },
  {
    id: 'hall',
    name: 'Shoebox concert hall',
    blurb: 'Vienna-style proportions, audience on the floor',
    room: {
      name: 'Shoebox concert hall',
      vertices: rect(19, 40),
      wallMaterials: ['wood-panel', 'plaster', 'wood-panel', 'plaster'],
      panels: [
        { id: 'p-d1', wall: 1, t0: 0.2, t1: 0.45, material: 'diffuser', height: 6 },
        { id: 'p-d2', wall: 3, t0: 0.55, t1: 0.8, material: 'diffuser', height: 6 },
      ],
      floor: 'seating',
      ceiling: 'plaster',
      height: 17,
      source: { x: 9.5, y: 5 },
      listener: { x: 8, y: 24 },
    },
  },
];

export const defaultRoom = (): Room => structuredClone(PRESETS[0].room);
