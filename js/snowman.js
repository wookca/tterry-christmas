import * as THREE from 'three';
import { enableOutline, SOFT_PART } from './outline.js';

// ─────────────────────────────────────────────
// 포떼링 눈사람: 채널 1(숲) 맵 한가운데 (0, 0)
// 모델: models/snowman.glb (CH_model\lowpoly\env\포떼링_눈사람.glb)
// 눈덩이에 맞아도 겉모습은 그대로. 내가 맞힌 횟수만 몰래 셈 (js/eggs.js)
// 떼리앙은 눈사람을 뚫고 지나갈 수 없음 (모닥불처럼 둘레를 따라 돌아감)
// 눈더미는 맵 가운데 3m 안에는 생기지 않으므로 겹치지 않음
// 환경물이라 검은 선 대신 눈더미처럼 연한 회색 선
// ─────────────────────────────────────────────
export const SNOWMAN_CHANNELS = [1]; // 눈사람이 있는 채널
const SIZE = 1.25;                   // 떼리앙과 같은 비율(1) 기준 크기 배율 → 키 약 2.2m
const BODY_R = 0.57 * SIZE;          // 몸통 반지름 (모델 기준 약 0.57m)
export const SNOWMAN_BLOCK_R = BODY_R + 0.45; // 떼리앙 발 위치가 이 안으로는 못 들어옴 (몸통 + 떼리앙 두께)
const BALL_R = BODY_R + 0.08, BALL_H = 1.72 * SIZE; // 눈덩이가 맞는 범위 (원통)

const SNOW_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }); // 눈더미와 같은 재질
let gltfPromise = null;

export class Snowman {
  constructor(scene, loader, unitScale) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    gltfPromise ||= loader.loadAsync('models/snowman.glb');
    gltfPromise.then((gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(unitScale * SIZE);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        // 모델 재질(M_Snow)은 살짝 어두운 회색(0.86) + 푸른 발광이라 바닥 눈더미보다 회색으로 보였음
        // → 눈더미(js/snowpiles.js)와 똑같은 흰 눈 재질로 바꿈 (2026-11-20 요청)
        o.material = SNOW_MAT;
        o.receiveShadow = false;
      });
      enableOutline(model, SOFT_PART);
      this.group.add(model);
    }).catch((e) => console.warn('눈사람 불러오기 실패', e));
  }

  setVisible(v) { this.group.visible = v; }
  get active() { return this.group.visible; }

  // 떼리앙 발 위치를 눈사람 바깥으로 밀어냄
  pushOut(v) {
    if (!this.group.visible) return v;
    const d = Math.hypot(v.x, v.z);
    if (d >= SNOWMAN_BLOCK_R) return v;
    if (d < 1e-4) { v.z = SNOWMAN_BLOCK_R; return v; }
    v.x *= SNOWMAN_BLOCK_R / d; v.z *= SNOWMAN_BLOCK_R / d;
    return v;
  }

  // 눈덩이가 눈사람에 닿았는지
  hitsBall(pos) {
    return this.group.visible && pos.y < BALL_H && Math.hypot(pos.x, pos.z) < BALL_R;
  }
}
