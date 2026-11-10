/// <reference lib="webworker" />
import type { Room } from '../engine/types';
import { traceRays } from '../engine/raytrace';
import { computeMetrics, edcCurves, suggestedMaxTime } from '../engine/metrics';
import { normaliseIR, synthesizeIR } from '../engine/ir';
import { earlyReflections } from '../engine/reflections';
import { bassMap, bassResponse } from '../engine/fdtd';
import { roomVolume } from '../engine/geometry';

export type Job =
  | { type: 'trace'; room: Room; rays: number; sampleRate: number }
  | { type: 'bass'; room: Room }
  | { type: 'bassmap'; room: Room; freq: number; settle: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<{ id: number; job: Job }>) => {
  const { id, job } = ev.data;
  try {
    if (job.type === 'trace') {
      const { room } = job;
      const res = traceRays(
        room,
        { rays: job.rays, receiverRadius: Math.min(0.5, Math.max(0.2, Math.cbrt(roomVolume(room)) * 0.05)), maxTime: suggestedMaxTime(room), seed: 1 },
        (p) => ctx.postMessage({ id, progress: p * 0.8 }),
      );
      const metrics = computeMetrics(room, res);
      const edc = edcCurves(res);
      ctx.postMessage({ id, progress: 0.85 });
      const raw = synthesizeIR(res, job.sampleRate, metrics.volume);
      const ir = normaliseIR(raw);
      const reflections = earlyReflections(room, 2);
      ctx.postMessage(
        { id, result: { metrics, edc, ir, reflections, stats: res.stats, directTime: res.directTime, directEnergy: res.directEnergy, sampleRate: job.sampleRate } },
        [ir.buffer],
      );
    } else if (job.type === 'bass') {
      ctx.postMessage({ id, result: bassResponse(job.room) });
    } else {
      const map = bassMap(job.room, job.freq, job.settle);
      ctx.postMessage({ id, result: map }, [map.db.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
