import * as THREE from 'three';

// ─────────────────────────────────────────────
// 눈 위 발자국: 걸을 때 한 발씩 찍히고, 시간이 지나면 옅어지다 사라짐
// 발자국 전체를 메시 1개(InstancedMesh)로 그리고, 정해진 개수만 돌려 씀 → 사람이 많아도 메모리·부담이 늘지 않음
// ─────────────────────────────────────────────
const MAX_PRINTS = 600;   // 동시에 남는 발자국 최대 개수 (넘으면 가장 오래된 것부터 재사용)
const LIFE = 9;           // 발자국이 남아 있는 시간 (초)
const FADE = 4;           // 마지막 몇 초 동안 서서히 사라짐
const ALPHA = 0.42;       // 처음 진하기
const FOOT_GAP = 0.13;    // 왼발·오른발 사이 간격의 절반

export class Footprints {
  constructor(scene, color = 0x8fb0de) {
    const geo = new THREE.CircleGeometry(0.1, 12);
    geo.rotateX(-Math.PI / 2);
    geo.scale(0.8, 1, 1.25); // 앞뒤로 긴 타원
    this.alpha = new Float32Array(MAX_PRINTS);
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PRINTS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.born = new Float32Array(MAX_PRINTS).fill(-1e9);
    this.next = 0;
    this.time = 0;
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PRINTS; i++) this.mesh.setMatrixAt(i, m);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // pos: 몸 위치, yaw: 바라보는 방향, side: 1(왼발) / -1(오른발)
  // feet: 발이 여러 개인 떼리앙(치떼링)의 발 위치표 (abilities.js의 feet). 없으면 보통 두 발
  add(pos, yaw, side, feet = null) {
    if (feet) {
      for (const x of feet[side]) this._put(pos, yaw, x);
    } else {
      this._put(pos, yaw, FOOT_GAP * side);
    }
  }

  // 몸 가운데에서 옆으로 x(m) 떨어진 곳에 발자국 하나
  _put(pos, yaw, x) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PRINTS;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // 몸 기준 오른쪽
    this._p.set(pos.x + rx * x, 0.006, pos.z + rz * x);
    this._q.setFromAxisAngle(this._up, yaw);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.born[i] = this.time;
    this.alpha[i] = ALPHA;
  }

  update(dt) {
    this.time += dt;
    let changed = false;
    for (let i = 0; i < MAX_PRINTS; i++) {
      if (this.alpha[i] <= 0) continue;
      const left = LIFE - (this.time - this.born[i]);
      const a = left <= 0 ? 0 : ALPHA * Math.min(1, left / FADE);
      if (a !== this.alpha[i]) { this.alpha[i] = a; changed = true; }
    }
    if (changed) this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

// 걸음 박자(anim의 phase)가 반 바퀴 돌 때마다 한 발. 걸음이 바뀌면 true + 어느 발인지
export function stepCheck(st) {
  const n = Math.floor((st.phase || 0) / Math.PI);
  if (st._stepN === undefined) { st._stepN = n; return 0; }
  if (n === st._stepN) return 0;
  st._stepN = n;
  if ((st.walk || 0) < 0.45 || (st.fall || 0) > 0.1) return 0;
  return n % 2 ? 1 : -1;
}
