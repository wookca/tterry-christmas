import * as THREE from 'three';

// ─────────────────────────────────────────────
// 넘어진 자국: 눈덩이에 맞아 쓰러지면 바닥에 그 떼리앙 모양 자국이 남고, 시간이 지나면 옅어지다 사라짐
// 떼리앙 모양은 떼리앙마다 한 번만 정면 실루엣으로 그려 두고(작은 그림 1장) 계속 재사용
// 자국은 최대 MAX개만 돌려 씀 → 많이 넘어져도 메모리·부담이 늘지 않음
// ─────────────────────────────────────────────
const MAX = 24;        // 동시에 남는 자국 최대 개수 (넘으면 가장 오래된 것부터 재사용)
const LIFE = 10;       // 남아 있는 시간 (초)
const FADE = 4;        // 마지막 몇 초 동안 서서히 사라짐
const ALPHA = 0.5;     // 처음 진하기
const TEX = 64;        // 실루엣 그림 크기 (작게 그려서 가장자리가 부드럽게 퍼짐)

export class Imprints {
  constructor(scene, renderer, color = 0x8fb0de) {
    this.scene = scene;
    this.renderer = renderer;
    this.color = color;
    this.shapes = new Map(); // 모델 uuid → { tex, geo }
    this.pool = [];
    this.next = 0;
    this.time = 0;
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this._scene = new THREE.Scene();
    this._scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this._scene.background = new THREE.Color(0x000000);
  }

  // 떼리앙 정면 실루엣 (서 있는 모습 기준, 발 = y 0)
  shape(model) {
    const key = model.uuid;
    let s = this.shapes.get(key);
    if (s) return s;
    const copy = model.clone(true);
    copy.visible = true;
    copy.traverse((o) => { o.visible = true; });
    this._scene.add(copy);
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const pad = 0.06;
    box.min.x -= pad; box.max.x += pad; box.max.y += pad;
    box.min.y = Math.min(box.min.y, 0);
    const cam = this._cam;
    cam.left = box.min.x; cam.right = box.max.x; cam.bottom = box.min.y; cam.top = box.max.y;
    cam.position.set(0, 0, box.max.z + 5);
    cam.lookAt(0, 0, 0);
    cam.near = 0.01; cam.far = box.max.z - box.min.z + 10;
    cam.updateProjectionMatrix();
    const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
    const rt = new THREE.WebGLRenderTarget(Math.max(8, Math.round(TEX * w / h)), TEX, { depthBuffer: true });
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this._scene, cam);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    this._scene.remove(copy);
    // 땅에 눕힌 판: 판의 x = 떼리앙 좌우, 판의 z = 발(0) → 머리 방향
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, 0);
    geo.rotateX(-Math.PI / 2);
    geo.scale(1, 1, -1);
    s = { tex: rt.texture, geo };
    this.shapes.set(key, s);
    return s;
  }

  // pos: 발 위치, yaw: 바라보는 방향, dir: 1(앞으로 쓰러짐) / -1(뒤로), model: 그 떼리앙 모델
  add(pos, yaw, dir, model) {
    if (!model) return;
    const s = this.shape(model);
    let p = this.pool[this.next];
    if (!p) {
      const mat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      p = { mesh: new THREE.Mesh(s.geo, mat), born: 0 };
      p.mesh.renderOrder = 1;
      p.mesh.frustumCulled = false;
      this.pool[this.next] = p;
      this.scene.add(p.mesh);
    }
    this.next = (this.next + 1) % MAX;
    p.mesh.geometry = s.geo;
    p.mesh.material.alphaMap = s.tex;
    p.mesh.material.needsUpdate = true;
    p.mesh.position.set(pos.x, 0.008, pos.z);
    p.mesh.rotation.set(0, yaw, 0);
    p.mesh.scale.set(1, 1, dir); // 앞으로 쓰러지면 머리가 앞쪽, 뒤로 쓰러지면 뒤쪽
    p.mesh.visible = true;
    p.born = this.time;
  }

  update(dt) {
    this.time += dt;
    for (const p of this.pool) {
      if (!p.mesh.visible) continue;
      const age = this.time - p.born;
      if (age >= LIFE) { p.mesh.visible = false; continue; }
      const appear = Math.min(1, age / 0.25);
      p.mesh.material.opacity = ALPHA * appear * Math.min(1, (LIFE - age) / FADE);
    }
  }
}

// 쓰러짐 상태(anim.fall)를 보고, 완전히 누웠을 때 한 번만 true
export function landedCheck(anim) {
  const f = anim.fall || 0;
  if (f > 0.85 && (anim.fallTarget || 0) > 0.5 && !anim.stamped) { anim.stamped = true; return true; }
  if (f < 0.3) anim.stamped = false;
  return false;
}
