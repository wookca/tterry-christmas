import * as THREE from 'three';
import { SOFT_PART } from './outline.js';

// ─────────────────────────────────────────────
// 떼리앙을 고르는 중인 사람: 다른 사람 화면에서는 눈사람처럼 하얗게 (2026-11-26 요청)
// 눈사람(js/snowman.js)과 같은 흰 눈 재질 + 연한 회색 선(SOFT_PART). 눈·입도 하얗게 묻힘
// 원래 모델을 복사해서 재질만 바꾸고, 부위 번호는 연한 선 범위(SOFT_PART ~ +7)로 옮김
// (지오메트리는 떼리앙마다 한 번만 복사해서 같이 씀)
// ─────────────────────────────────────────────
export const SNOW_WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.35 });

const geoCache = new WeakMap(); // 원래 지오메트리 → 연한 선 번호로 바꾼 복사본

function softGeometry(g) {
  let w = geoCache.get(g);
  if (w) return w;
  w = g.clone();
  const a = w.attributes.partId;
  if (a) {
    const ids = new Float32Array(a.count);
    for (let i = 0; i < a.count; i++) ids[i] = SOFT_PART + (Math.round(a.getX(i)) % 8);
    w.setAttribute('partId', new THREE.BufferAttribute(ids, 1));
  } else {
    w.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(w.attributes.position.count).fill(SOFT_PART), 1));
  }
  geoCache.set(g, w);
  return w;
}

// 하얀 복사본 (원래 모델은 그대로). 크기·위치·userData(키, 손 위치)는 그대로 따라옴
export function whiteCopy(model) {
  const copy = model.clone(true);
  copy.visible = true;
  copy.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = softGeometry(o.geometry);
    o.material = Array.isArray(o.material) ? o.material.map(() => SNOW_WHITE_MAT) : SNOW_WHITE_MAT;
  });
  return copy;
}
