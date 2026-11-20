import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { enableOutline } from './outline.js';

// ─────────────────────────────────────────────
// 바닥 눈무더기: 눈이 소복이 모여 있는 더미 (쌀 한 포대 정도 크기)
// 클릭하면 그 앞까지 걸어가서, 도착하면 모으는 시간 없이 바로 눈덩이를 집음
// 자리는 정해진 씨앗으로 뽑아서 모든 사람 화면에 같은 곳에 있음. 줄어들지 않으니 서버와 주고받을 것도 없음
// ─────────────────────────────────────────────
const PILE_W = 0.85;      // 지름 (떼리앙 키 1.3 기준)
const PILE_H = 0.34;      // 높이
const MIN_GAP = 4.5;      // 더미 사이 최소 간격
export const PICK_REACH = 0.62; // 이만큼 떨어진 곳에 서서 집음

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// 울퉁불퉁한 더미 모양: 납작한 눈 덩어리 몇 개를 겹친 뒤 표면을 살짝 흔듦
function pileGeometry(rand) {
  const parts = [];
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const big = i === 0;
    const r = big ? 0.5 : 0.24 + rand() * 0.16;
    const a = rand() * Math.PI * 2, d = big ? 0 : 0.18 + rand() * 0.2;
    g.scale(r * (1 + rand() * 0.25), r * (big ? 0.62 : 0.55 + rand() * 0.25), r * (1 + rand() * 0.25));
    g.translate(Math.cos(a) * d, big ? 0 : rand() * 0.05, Math.sin(a) * d);
    parts.push(g.deleteAttribute('uv') && g);
  }
  let geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  // 표면 흔들기 (같은 자리 꼭짓점은 같은 만큼 → 틈이 안 생김)
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.08 * Math.sin(v.x * 23.1 + v.z * 17.3) * Math.cos(v.y * 31.7 + v.x * 11.9);
    v.multiplyScalar(k);
    if (v.y < 0) v.y = 0; // 바닥 아래는 평평하게
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // 크기 맞추기: 지름 PILE_W, 높이 PILE_H
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.scale(PILE_W / (bb.max.x - bb.min.x), PILE_H / Math.max(0.01, bb.max.y), PILE_W / (bb.max.z - bb.min.z));
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4); // 매끈하게 (각진 바위처럼 안 보이게)
  geo.computeVertexNormals();
  return geo;
}

const pileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });

export class SnowPiles {
  constructor(scene) {
    this.scene = scene;
    this.sets = {};      // 맵마다 한 벌
    this.current = null; // 지금 보이는 한 벌 { group, piles: [{ mesh, pos }] }
    this._ray = new THREE.Raycaster();
  }

  // key: 맵 이름, radius: 맵 반지름, count: 더미 개수
  show(key, radius, count) {
    if (!this.sets[key]) this.sets[key] = this.build(radius, count, key.length * 7919 + Math.round(radius));
    for (const [k, s] of Object.entries(this.sets)) s.group.visible = k === key;
    this.current = this.sets[key];
  }

  build(radius, count, seed) {
    const rand = rng(20261120 + seed);
    const group = new THREE.Group();
    const geos = [0, 1, 2].map(() => pileGeometry(rand)); // 모양 3가지를 돌려 씀
    const piles = [];
    for (let tries = 0; piles.length < count && tries < 3000; tries++) {
      const r = 3 + Math.sqrt(rand()) * (radius - 6); // 넓이에 고르게
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (piles.some((p) => (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2 < MIN_GAP * MIN_GAP)) continue;
      const mesh = new THREE.Mesh(geos[piles.length % geos.length], pileMat);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rand() * Math.PI * 2;
      mesh.scale.setScalar(0.9 + rand() * 0.25);
      mesh.castShadow = true;
      enableOutline(mesh, 202);
      group.add(mesh);
      piles.push({ mesh, pos: mesh.position });
    }
    this.scene.add(group);
    return { group, piles };
  }

  // 화면 좌표(ndc)를 가리키는 더미 (없으면 null)
  pick(ndc, camera) {
    if (!this.current) return null;
    this._ray.setFromCamera(ndc, camera);
    const hits = this._ray.intersectObjects(this.current.group.children, false);
    if (!hits.length) return null;
    return this.current.piles.find((p) => p.mesh === hits[0].object) || null;
  }

  // 이 위치 가까이에 있는 더미 (집을 수 있는 거리)
  near(pos, reach = PICK_REACH + 0.35) {
    if (!this.current) return null;
    for (const p of this.current.piles) {
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < reach) return p;
    }
    return null;
  }
}
