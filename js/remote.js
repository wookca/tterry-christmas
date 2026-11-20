import * as THREE from 'three';
import { animateBody } from './anim.js';
import { makeBallMesh } from './snowball.js';
import { enableOutline } from './outline.js';
import { ballSizeOf } from './abilities.js';

// ─────────────────────────────────────────────
// 다른 플레이어들 (서버에서 받은 위치로 부드럽게 따라감)
// ─────────────────────────────────────────────
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class RemotePlayers {
  constructor(scene, camera, getModel, labelLayer) {
    this.scene = scene;
    this.camera = camera;
    this.getModel = getModel;     // (charId) => Promise<Object3D>
    this.labels = labelLayer;     // 이름표를 붙일 DOM 요소
    this.map = new Map();
  }

  get count() { return this.map.size; }

  add(p) {
    if (this.map.has(p.id)) { this.update(p); return; }
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    root.position.set(p.x, 0, p.z);
    root.rotation.y = p.yaw || 0;
    const size = ballSizeOf(p.char); // 지떼링은 눈덩이가 큼
    const ball = makeBallMesh();
    ball.position.set(-0.47, 0.34, 0.1);
    ball.scale.setScalar(size);
    ball.visible = !!p.b;
    body.add(ball);
    enableOutline(ball, 200);
    const ball2 = makeBallMesh(); // 왼손 (치떼링: 눈덩이 2개일 때)
    ball2.position.set(0.47, 0.34, 0.1);
    ball2.scale.setScalar(size);
    ball2.visible = p.b === 2;
    body.add(ball2);
    enableOutline(ball2, 200);
    this.scene.add(root);

    const label = document.createElement('div');
    label.className = 'name-tag';
    label.textContent = p.name || '';
    this.labels.appendChild(label);

    const r = {
      id: p.id, name: p.name || '', char: p.char, root, body, ball, ball2, label,
      target: new THREE.Vector3(p.x, 0, p.z), yaw: p.yaw || 0, targetYaw: p.yaw || 0,
      m: !!p.m, g: !!p.g, b: p.b || 0, a: !!p.a, d: p.d || 0,
      anim: { walk: 0, phase: Math.random() * 6, crouch: 0, throwT: 1, dropT: 0 },
    };
    this.map.set(p.id, r);
    this.getModel(p.char).then((model) => {
      if (!this.map.has(p.id)) return;
      const copy = model.clone(true); // 지오메트리/재질은 공유 → 메모리 절약
      copy.visible = true; // 원본이 잠깐 숨겨진 상태여도 항상 보이게
      body.add(copy);
      r.model = copy;
      const d = copy.userData.dims; // 떼리앙마다 손 위치·키가 다름
      if (d) { ball.position.fromArray(d.hand); ball2.position.fromArray(d.hand2); }
    }).catch((err) => console.error('다른 플레이어 떼리앙 표시 실패', p.char, err));
  }

  update(m) {
    const r = this.map.get(m.id);
    if (!r) return;
    r.target.set(m.x, 0, m.z);
    r.targetYaw = m.yaw;
    r.m = !!m.m; r.g = !!m.g; r.a = !!m.a; r.d = m.d || 0;
    const b = m.b || 0; // 0: 없음, 1: 하나, 2: 양손에 하나씩 (치떼링)
    if (b !== r.b) { r.b = b; r.ball.visible = b > 0; r.ball2.visible = b === 2; }
  }

  thrown(id) {
    const r = this.map.get(id);
    if (!r) return;
    r.anim.throwT = 0;
    r.anim.throwSide = r.b === 2 ? -1 : 1; // 치떼링 첫 번째(왼손)는 좌우 반대 모션. 던지기는 상태보다 먼저 와서 r.b가 아직 2
    if (r.b === 2) { r.b = 1; r.ball2.visible = false; } // 왼손 것 먼저 던짐
    else { r.b = 0; r.ball.visible = false; }
  }

  remove(id) {
    const r = this.map.get(id);
    if (!r) return;
    this.scene.remove(r.root);
    r.label.remove();
    this.map.delete(id);
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  charOf(id) { return this.map.get(id)?.char; }
  nameOf(id) { return this.map.get(id)?.name; }
  hasName(name) { for (const r of this.map.values()) if (r.name === name) return true; return false; }

  // 던진 위치를 그 사람 손 위치에 맞추고 싶을 때
  handPosition(id, out) {
    const r = this.map.get(id);
    if (!r) return null;
    r.root.updateMatrixWorld(true);
    return r.ball.getWorldPosition(out);
  }

  update_frame(dt) {
    const v = new THREE.Vector3();
    const w = window.innerWidth, h = window.innerHeight;
    for (const r of this.map.values()) {
      const dist = r.root.position.distanceTo(r.target);
      // 멀리 순간이동했으면 바로 이동, 아니면 부드럽게
      if (dist > 6) r.root.position.copy(r.target);
      else r.root.position.lerp(r.target, Math.min(1, dt * 10));
      r.yaw = angleLerp(r.yaw, r.targetYaw, Math.min(1, dt * 12));
      r.root.rotation.y = r.yaw;
      r.anim.fallTarget = r.d ? 1 : 0;
      if (r.d) r.anim.fallDir = r.d === 1 ? 1 : -1;
      animateBody(r.body, r.anim, dt, !r.d && (r.m || dist > 0.05), r.g && !r.d);

      // 이름표 (머리 위)
      const top = r.model?.userData.dims?.h || 1.3; // 이름표는 그 떼리앙 머리 위
      v.copy(r.root.position).setY(top + 0.15 - (top - 0.55) * (r.anim.fall || 0)).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      r.label.style.display = visible ? '' : 'none';
      if (visible) r.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
  }
}
