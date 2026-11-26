import * as THREE from 'three';
import { animateBody, pokePress, pokeRelease } from './anim.js';
import { makeBallMesh } from './snowball.js';
import { enableOutline } from './outline.js';
import { ballSizeOf } from './abilities.js';
import { whiteCopy } from './whiteout.js';

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
    // 방금 나간 떼리앙: 바로 지우지 않고 잠깐 그 자리에 남겨 둠.
    // 떼리앙·닉네임을 바꾸면 서버에 다시 접속(나감 → 들어옴)하는데, 그 사이에 사라졌다가
    // 하늘에서 다시 떨어지지 않도록, 곧 같은 사람(re = 예전 닉네임)이 들어오면 이어받음
    this.ghosts = [];
  }

  get count() { return this.map.size; }

  add(p, re) {
    if (this.map.has(p.id)) { this.update(p); return; }
    const gi = re ? this.ghosts.findIndex((g) => g.name === re) : -1;
    const ghost = gi >= 0 ? this.ghosts.splice(gi, 1)[0] : null;
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
      target: new THREE.Vector3(p.x, 0, p.z), base: new THREE.Vector3(p.x, 0, p.z), vx: 0, vz: 0, baseT: performance.now(), yaw: p.yaw || 0, targetYaw: p.yaw || 0,
      m: !!p.m, g: !!p.g, b: p.b || 0, a: !!p.a, d: p.d || 0,
      anim: { walk: 0, phase: Math.random() * 6, crouch: 0, throwT: 1, dropT: 0 },
    };
    this.map.set(p.id, r);
    if (ghost) {
      // 같은 사람이 다시 들어옴 (떼리앙 변경 등): 등장 연출 없이 그 자리에서 이어서, 새 떼리앙을 받을 때까지 예전 모습 유지
      r.anim.dropT = 1;
      root.position.copy(ghost.root.position);
      r.yaw = ghost.yaw; root.rotation.y = r.yaw;
      if (ghost.model) { body.add(ghost.model); r.model = ghost.model; }
      this.dropGhost(ghost);
    }
    r.sel = !!p.s; // 떼리앙을 고르는 중 → 눈사람처럼 하얗게
    this.loadModel(r);
  }

  // 그 사람 떼리앙 모델을 불러와서 입힘 (떼리앙을 바꾸면 다시 부름)
  loadModel(r) {
    const seq = (r.loadSeq || 0) + 1;
    r.loadSeq = seq;
    const char = r.char;
    this.getModel(char).then((model) => {
      if (this.map.get(r.id) !== r || r.loadSeq !== seq) return;
      r.src = model;
      this.applyLook(r);
    }).catch((err) => console.error('다른 플레이어 떼리앙 표시 실패', char, err));
  }

  // 지금 모습으로 바꿔 끼움: 고르는 중이면 하얀 복사본, 아니면 원래 색
  applyLook(r) {
    if (!r.src) return;
    let next;
    if (r.sel) next = whiteCopy(r.src);
    else { next = r.src.clone(true); next.visible = true; } // 지오메트리/재질은 공유 → 메모리 절약. 원본이 잠깐 숨겨진 상태여도 항상 보이게
    if (r.model) r.body.remove(r.model); // 예전 모습을 새 것으로 바꿈
    r.body.add(next);
    r.model = next;
    const d = next.userData.dims; // 떼리앙마다 손 위치·키가 다름
    if (d) { r.ball.position.fromArray(d.hand); r.ball2.position.fromArray(d.hand2); }
  }

  // 떼리앙·닉네임이 바뀜 (다시 접속하지 않고 그 자리에서)
  setProfile(id, char, name) {
    const r = this.map.get(id);
    if (!r) return null;
    const oldName = r.name;
    if (name && name !== r.name) { r.name = name; r.label.textContent = name; }
    if (char && char !== r.char) {
      r.char = char;
      const size = ballSizeOf(char);
      r.ball.scale.setScalar(size); r.ball2.scale.setScalar(size);
      this.loadModel(r);
    }
    return oldName;
  }

  isSel(id) { return !!this.map.get(id)?.sel; }

  labelOf(id) { return this.map.get(id)?.label || null; }

  update(m) {
    const r = this.map.get(m.id);
    if (!r) return;
    // 받은 위치 + 걷는 속도: 다음 소식이 올 때까지 그 속도로 조금 앞을 그려서 끊김 없이 (새 서버만 속도를 보냄)
    r.base.set(m.x, 0, m.z);
    r.target.copy(r.base);
    r.baseT = performance.now();
    const moving = !!m.m && !m.d;
    r.vx = moving ? Number(m.vx) || 0 : 0;
    r.vz = moving ? Number(m.vz) || 0 : 0;
    r.targetYaw = m.yaw;
    const fell = !r.d && !!m.d; // 방금 눈에 맞아 쓰러짐
    r.m = !!m.m; r.g = !!m.g; r.a = !!m.a; r.d = m.d || 0;
    const b = m.b || 0; // 0: 없음, 1: 하나, 2: 양손에 하나씩 (치떼링)
    if (b !== r.b) { r.b = b; r.ball.visible = b > 0; r.ball2.visible = b === 2; }
    const sel = !!m.s;
    if (sel !== r.sel) { r.sel = sel; this.applyLook(r); }
    return fell ? r.root.position : null;
  }

  thrown(id) {
    const r = this.map.get(id);
    if (!r) return;
    r.anim.throwT = 0;
    r.anim.throwSide = r.b === 2 ? -1 : 1; // 치떼링 첫 번째(왼손)는 왼손 모션. 던지기는 상태보다 먼저 와서 r.b가 아직 2
    if (r.b === 2) { r.b = 1; r.ball2.visible = false; } // 왼손 것 먼저 던짐
    else { r.b = 0; r.ball.visible = false; }
  }

  remove(id, linger = false) {
    const r = this.map.get(id);
    if (!r) return;
    this.map.delete(id);
    if (linger && r.model) {
      // 4초 안에 같은 사람이 다시 들어오지 않으면 그때 지움
      r.ghostTimer = setTimeout(() => this.dropGhost(r), 4000);
      this.ghosts.push(r);
      return;
    }
    this.scene.remove(r.root);
    r.label.remove();
  }

  dropGhost(g) {
    clearTimeout(g.ghostTimer);
    const i = this.ghosts.indexOf(g);
    if (i >= 0) this.ghosts.splice(i, 1);
    this.scene.remove(g.root);
    g.label.remove();
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
    for (const g of [...this.ghosts]) this.dropGhost(g);
  }

  // 다른 떼리앙이 자기 떼리앙을 누름/뗌. 들리는 거리용으로 위치를 돌려줌
  poke(m) {
    const r = this.map.get(m.id);
    if (!r) return null;
    if (m.p) pokePress(r.anim);
    else {
      if (!r.anim.pokeHold) pokePress(r.anim); // 누름 신호를 놓쳤어도 떼는 모션은 보이게
      pokeRelease(r.anim, !!m.l, !!m.s);
    }
    return r.root.position;
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
    const now = performance.now();
    for (const g of this.ghosts) {
      const top = g.model?.userData.dims?.h || 1.3;
      v.copy(g.root.position).setY(top + 0.15).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      g.label.style.display = visible ? '' : 'none';
      if (visible) g.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
    for (const r of this.map.values()) {
      if (r.vx || r.vz) {
        const ahead = Math.min(now - r.baseT, 300) / 1000; // 소식이 늦어도 0.3초 넘게 앞서 가지는 않음
        r.target.set(r.base.x + r.vx * ahead, 0, r.base.z + r.vz * ahead);
      }
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
