import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { enableOutline, SOFT_PART } from './outline.js';
import { rng, makePiles, regrowDue, regrowDelay } from './pilelogic.js';

// ─────────────────────────────────────────────
// 바닥 눈무더기: 눈이 소복이 모여 있는 더미 (크기는 제각각, 보통 쌀 한 포대 정도)
// 클릭하면 그 앞까지 걸어가서, 도착하면 모으는 시간 없이 바로 눈덩이를 집음
// 집으면 사라지고, 잠시 뒤 맵의 다른 곳에서 바닥부터 새로 자라남 (맵마다 최대 개수 제한)
// 온라인: 서버가 더미 목록을 정하고 알려줌 (모두에게 똑같이). 혼자 하기/옛 서버: 내 컴퓨터가 같은 규칙으로 돌림
// ─────────────────────────────────────────────
const PILE_W = 0.85;      // 크기 1일 때 지름 (떼리앙 키 1.3 기준)
const PILE_H = 0.34;      // 크기 1일 때 높이
const GROW_TIME = 1.6;    // 바닥에서 자라나는 시간 (초)
const VANISH_TIME = 0.25; // 집었을 때 사라지는 시간 (초)

// 서 있어야 하는 거리: 더미 크기에 맞춰
export function pickReach(pile) { return (PILE_W / 2) * pile.s + 0.3; }

// 울퉁불퉁한 더미 모양: 납작한 눈 덩어리 몇 개를 겹친 뒤 표면을 살짝 흔듦
function pileGeometry(rand) {
  const parts = [];
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.deleteAttribute('uv');
    const big = i === 0;
    const r = big ? 0.5 : 0.24 + rand() * 0.16;
    const a = rand() * Math.PI * 2, d = big ? 0 : 0.18 + rand() * 0.2;
    g.scale(r * (1 + rand() * 0.25), r * (big ? 0.62 : 0.55 + rand() * 0.25), r * (1 + rand() * 0.25));
    g.translate(Math.cos(a) * d, big ? 0 : rand() * 0.05, Math.sin(a) * d);
    parts.push(g.toNonIndexed());
  }
  let geo = mergeGeometries(parts);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 23.1 + v.z * 17.3) * Math.cos(v.y * 31.7 + v.x * 11.9));
    if (v.y < 0) v.y = 0; // 바닥 아래는 평평하게
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.scale(PILE_W / (bb.max.x - bb.min.x), PILE_H / Math.max(0.01, bb.max.y), PILE_W / (bb.max.z - bb.min.z));
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4); // 매끈하게 (각진 바위처럼 안 보이게)
  geo.computeVertexNormals();
  return geo;
}

const pileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const geoRand = rng(20261120);
const GEOS = [0, 1, 2].map(() => pileGeometry(geoRand)); // 모양 3가지 (모두 같은 모양 세트)

export class SnowPiles {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map(); // id → { data, mesh, t, state: 'grow' | 'up' | 'vanish' }
    this.local = null;      // 혼자 하기 모드일 때 { list, radius, rand }
    this.time = 0;
    this._ray = new THREE.Raycaster();
  }

  clear() {
    for (const it of this.items.values()) this.group.remove(it.mesh);
    this.items.clear();
  }

  // 혼자 하기(또는 서버가 더미를 모르는 옛 버전): 내 컴퓨터가 직접 놓고 다시 자라게 함
  startLocal(count, radius) {
    this.clear();
    const rand = rng(Date.now());
    const list = makePiles(count, radius, rand);
    this.local = { list, radius, rand };
    for (const p of list) this.add(p, false);
  }

  // 서버가 알려준 목록으로 바꿈
  setFromServer(list) {
    this.local = null;
    this.clear();
    for (const p of list) this.add(p, false);
  }

  // 서버 알림 하나 반영: up 1 = 새로 자라남, up 0 = 사라짐
  apply(m) {
    if (m.up) this.add(m, true);
    else this.vanish(m.id);
  }

  add(p, grow) {
    if (this.blocked?.(p)) return; // 모닥불 둘레 눈 녹은 곳에 놓인 더미(옛 서버 목록)는 안 보이게
    const old = this.items.get(p.id);
    if (old) this.group.remove(old.mesh);
    const mesh = new THREE.Mesh(GEOS[(p.v || 0) % GEOS.length], pileMat);
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.yaw || 0;
    mesh.scale.setScalar(grow ? 0.001 : p.s);
    mesh.castShadow = true;
    enableOutline(mesh, SOFT_PART); // 얇은 쿨톤 회색 선
    this.group.add(mesh);
    const data = { id: p.id, x: p.x, z: p.z, s: p.s, pos: mesh.position, up: true };
    this.items.set(p.id, { data, mesh, t: 0, state: grow ? 'grow' : 'up' });
  }

  vanish(id) {
    const it = this.items.get(id);
    if (!it || it.state === 'vanish') return false;
    it.data.up = false;
    it.state = 'vanish';
    it.t = 0;
    return true;
  }

  // 내가 집음: 바로 사라지게 하고 true. 이미 없으면 false
  take(id) {
    const it = this.items.get(id);
    if (!it || !it.data.up) return false;
    this.vanish(id);
    if (this.local) {
      const p = this.local.list.find((q) => q.id === id);
      if (p) { p.up = false; p.at = Date.now() + regrowDelay(this.local.rand); }
    }
    return true;
  }

  update(dt, avoid = []) {
    this.time += dt;
    for (const [id, it] of this.items) {
      if (it.state === 'grow') {
        it.t = Math.min(1, it.t + dt / GROW_TIME);
        const k = 1 - (1 - it.t) ** 3;                   // 처음엔 빠르게, 끝엔 천천히
        const wobble = 1 + Math.sin(it.t * Math.PI) * 0.08;
        it.mesh.scale.set(it.data.s * k * wobble, it.data.s * k, it.data.s * k * wobble);
        if (it.t >= 1) it.state = 'up';
      } else if (it.state === 'vanish') {
        it.t = Math.min(1, it.t + dt / VANISH_TIME);
        const k = 1 - it.t;
        it.mesh.scale.set(it.data.s * (1 + it.t * 0.2), it.data.s * k, it.data.s * (1 + it.t * 0.2)); // 납작해지며 사라짐
        if (it.t >= 1) { this.group.remove(it.mesh); this.items.delete(id); }
      }
    }
    if (this.local) {
      for (const p of regrowDue(this.local.list, this.local.radius, Date.now(), this.local.rand, avoid)) this.add(p, true);
    }
  }

  // 화면 좌표(ndc)가 가리키는 더미 (없으면 null)
  pick(ndc, camera) {
    this._ray.setFromCamera(ndc, camera);
    const meshes = [];
    for (const it of this.items.values()) if (it.data.up) meshes.push(it.mesh);
    const hits = this._ray.intersectObjects(meshes, false);
    if (!hits.length) return null;
    for (const it of this.items.values()) if (it.mesh === hits[0].object) return it.data;
    return null;
  }
}
