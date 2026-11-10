import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../state/store';
import { material } from '../engine/materials';
import { bounds, dist, edge, inwardNormal, lerp, panelSpan } from '../engine/geometry';
import { samplePaths, EAR_HEIGHT } from '../engine/raytrace';
import type { Room } from '../engine/types';

export default function Room3D() {
  const ref = useRef<HTMLDivElement>(null);
  const room = useStore((s) => s.room);
  const roomRef = useRef(room);
  roomRef.current = room;
  const api = useRef<{ rebuild: (r: Room) => void } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setClearColor(0x0b0c0e);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0c0e, 30, 120);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 12, 4);
    scene.add(sun);
    const glow = new THREE.PointLight(0xffa94d, 6, 0, 1.6);
    scene.add(glow);

    const group = new THREE.Group();
    scene.add(group);
    let rays: { line: THREE.Line; total: number }[] = [];
    let start = performance.now();
    let firstFit = true;

    const disposeGroup = () => {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      group.clear();
    };

    const rebuild = (r: Room) => {
      disposeGroup();
      const bb = bounds(r.vertices);
      const cx = bb.minX + bb.w / 2, cz = bb.minY + bb.h / 2;
      const P = (x: number, y: number, h: number) => new THREE.Vector3(x - cx, h, y - cz);
      const H = r.height;

      const shape = new THREE.Shape(r.vertices.map((v) => new THREE.Vector2(v.x - cx, v.y - cz)));
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: material(r.floor).color, roughness: 0.9, side: THREE.DoubleSide }));
      floor.rotation.x = Math.PI / 2;
      group.add(floor);

      const ceilEdges = new THREE.EdgesGeometry(new THREE.ShapeGeometry(shape));
      const ceil = new THREE.LineSegments(ceilEdges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = H;
      group.add(ceil);

      r.vertices.forEach((_, i) => {
        const [a, b] = edge(r.vertices, i);
        const L = dist(a, b);
        const m = material(r.wallMaterials[i]);
        const mid = lerp(a, b, 0.5);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (m.id !== 'open') {
          const wall = new THREE.Mesh(
            new THREE.PlaneGeometry(L, H),
            new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.85, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }),
          );
          wall.position.copy(P(mid.x, mid.y, H / 2));
          wall.rotation.y = -ang;
          group.add(wall);
        }
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(L, H)),
          new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
        );
        outline.position.copy(P(mid.x, mid.y, H / 2));
        outline.rotation.y = -ang;
        group.add(outline);

        for (const p of r.panels.filter((x) => x.wall === i)) {
          const pm = material(p.material);
          const w = (p.t1 - p.t0) * L;
          const c = lerp(a, b, (p.t0 + p.t1) / 2);
          const [z0, z1] = panelSpan(r, p);
          const panel = new THREE.Mesh(new THREE.BoxGeometry(w, z1 - z0, 0.1), new THREE.MeshStandardMaterial({ color: pm.color, roughness: 1 }));
          // Nudge inward so the panel sits on the inner face of the wall.
          const nn = inwardNormal(r.vertices, i);
          panel.position.copy(P(c.x + nn.x * 0.06, c.y + nn.y * 0.06, (z0 + z1) / 2));
          panel.rotation.y = -ang;
          group.add(panel);
        }
      });

      const ear = Math.min(EAR_HEIGHT, H * 0.5);
      const src = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 16), new THREE.MeshStandardMaterial({ color: 0xffa94d, emissive: 0xff8a2a, emissiveIntensity: 1.4 }));
      src.position.copy(P(r.source.x, r.source.y, ear));
      group.add(src);
      glow.position.copy(src.position);
      const lis = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16), new THREE.MeshStandardMaterial({ color: 0x5fd4e6, emissive: 0x2bb3c9, emissiveIntensity: 1.2 }));
      lis.position.copy(P(r.listener.x, r.listener.y, ear));
      group.add(lis);

      rays = samplePaths(r, 140, 7).map((path) => {
        const pos: number[] = [], col: number[] = [];
        for (let k = 0; k < path.energy.length; k++) {
          const v = P(path.points[k * 3], path.points[k * 3 + 1], path.points[k * 3 + 2]);
          pos.push(v.x, v.y, v.z);
          const e = Math.sqrt(path.energy[k]);
          col.push(1 * e + 0.3 * (1 - e), 0.66 * e + 0.8 * (1 - e), 0.3 * e + 0.9 * (1 - e));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        group.add(line);
        return { line, total: path.energy.length };
      });
      start = performance.now();

      if (firstFit) {
        const span = Math.max(bb.w, bb.h, H);
        camera.position.set(span * 0.9, span * 1.1 + H, span * 1.2);
        controls.target.set(0, H * 0.35, 0);
        firstFit = false;
      }
    };
    api.current = { rebuild };
    rebuild(roomRef.current);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Reveal ray paths progressively, as if sound were travelling outwards.
      const t = ((performance.now() - start) / 3200) % 1.25;
      for (const r of rays) r.line.geometry.setDrawRange(0, Math.min(r.total, Math.floor(1 + t * 8)));
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { api.current?.rebuild(room); }, [room]);

  return (
    <div className="stage three" ref={ref}>
      <div className="hud hud-top-right"><span className="hud-tip">Drag to orbit · scroll to zoom · 140 specular/diffuse paths</span></div>
    </div>
  );
}
