import type { Material } from './types';

/**
 * Random-incidence absorption coefficients from commonly published tables
 * (e.g. Everest "Master Handbook of Acoustics", manufacturer data for porous panels).
 * Values are representative, not product-specific.
 */
export const MATERIALS: Material[] = [
  { id: 'concrete', name: 'Painted concrete', group: 'Structure', alpha: [0.01, 0.01, 0.02, 0.02, 0.02, 0.03], scatter: 0.05, color: '#8b8f98' },
  { id: 'brick', name: 'Bare brick', group: 'Structure', alpha: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07], scatter: 0.15, color: '#b06a4f' },
  { id: 'plaster', name: 'Plaster on masonry', group: 'Structure', alpha: [0.013, 0.015, 0.02, 0.03, 0.04, 0.05], scatter: 0.05, color: '#c9c3b6' },
  { id: 'drywall', name: 'Drywall on studs', group: 'Structure', alpha: [0.29, 0.1, 0.05, 0.04, 0.07, 0.09], scatter: 0.05, color: '#d8d6cf' },
  { id: 'stone', name: 'Marble / stone', group: 'Structure', alpha: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02], scatter: 0.1, color: '#a9adb3' },
  { id: 'glass', name: 'Window glass', group: 'Surface', alpha: [0.35, 0.25, 0.18, 0.12, 0.07, 0.04], scatter: 0.02, color: '#7fb6d9' },
  { id: 'tile', name: 'Ceramic tile', group: 'Surface', alpha: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02], scatter: 0.05, color: '#e3e8ea' },
  { id: 'wood-panel', name: 'Wood panelling', group: 'Surface', alpha: [0.28, 0.22, 0.17, 0.09, 0.1, 0.11], scatter: 0.1, color: '#a8784c' },
  { id: 'open', name: 'Opening (no wall)', group: 'Surface', alpha: [1, 1, 1, 1, 1, 1], scatter: 0, color: '#3a3d45' },
  { id: 'curtain', name: 'Heavy curtain', group: 'Furnishing', alpha: [0.07, 0.31, 0.49, 0.75, 0.7, 0.6], scatter: 0.3, color: '#7a4e7e' },
  { id: 'bookshelf', name: 'Filled bookshelf', group: 'Furnishing', alpha: [0.3, 0.35, 0.4, 0.45, 0.5, 0.5], scatter: 0.7, color: '#9c7a52' },
  { id: 'carpet', name: 'Carpet on concrete', group: 'Floor', alpha: [0.02, 0.06, 0.14, 0.37, 0.6, 0.65], scatter: 0.1, color: '#6b6f7c' },
  { id: 'wood-floor', name: 'Wooden floor', group: 'Floor', alpha: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07], scatter: 0.1, color: '#b58a5c' },
  { id: 'vinyl', name: 'Vinyl on concrete', group: 'Floor', alpha: [0.02, 0.03, 0.03, 0.03, 0.03, 0.02], scatter: 0.05, color: '#8d9a8f' },
  { id: 'seating', name: 'Occupied seating', group: 'Floor', alpha: [0.6, 0.74, 0.88, 0.96, 0.93, 0.85], scatter: 0.7, color: '#5d6b8a' },
  { id: 'ceiling-tile', name: 'Acoustic ceiling tile', group: 'Ceiling', alpha: [0.7, 0.66, 0.72, 0.92, 0.88, 0.75], scatter: 0.1, color: '#e9e4d8' },
  { id: 'absorber-50', name: 'Mineral wool panel 50 mm', group: 'Treatment', alpha: [0.17, 0.86, 0.99, 0.99, 0.99, 0.99], scatter: 0.1, color: '#e0a458' },
  { id: 'absorber-100', name: 'Mineral wool panel 100 mm', group: 'Treatment', alpha: [0.84, 0.99, 0.99, 0.99, 0.99, 0.97], scatter: 0.1, color: '#f08a4b' },
  { id: 'diffuser', name: 'QRD diffuser', group: 'Treatment', alpha: [0.15, 0.2, 0.2, 0.15, 0.15, 0.15], scatter: 0.9, color: '#6fc3a8' },
];

const byId = new Map(MATERIALS.map((m) => [m.id, m]));

export function material(id: string): Material {
  return byId.get(id) ?? MATERIALS[0];
}

/** Energy attenuation of air (1/m) per band at 20 °C / 50 % RH (ISO 9613-1, approx.). */
export const AIR_ABSORPTION = [0.0001, 0.0003, 0.00063, 0.00107, 0.00227, 0.00677];

export const SPEED_OF_SOUND = 343;
