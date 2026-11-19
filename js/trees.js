import * as THREE from 'three';
import { seeThrough, SEE_THROUGH_GLSL } from './outline.js';

// ─────────────────────────────────────────────
// 맵 밖 눈나무 (models/trees.glb 안의 Tree_A, Tree_B, Tree_C)
// 같은 나무는 InstancedMesh로 한 번에 그림 → 나무가 몇십 그루여도 그리기 호출은 몇 번뿐
// 자리는 정해진 씨앗(seed)으로 뽑아서 모든 사람 화면에 똑같은 숲이 보임
// 카메라와 내 떼리앙 사이를 가리는 나무는 그 부분만 뚫려 보임
// 나무에는 검은 외곽선을 넣지 않음 (2026-11-19 요청)
// ─────────────────────────────────────────────
const TREE_COUNT = 80;       // 지금 크기 맵(반지름 30) 기준 나무 개수. 큰 맵은 둘레가 넓은 만큼 더 심음
const RING_GAP = 3.5;        // 맵 경계 바로 밖부터
const RING_WIDTH = 28.5;     // 이 폭만큼 (더 멀면 안개에 묻힘)
const MIN_GAP = 4.2;         // 나무 사이 최소 간격
const SCALE_MIN = 2.25, SCALE_MAX = 3.9; // 떼리앙과 같은 비율(1) 기준 크기 배율 (2026-11-19 50% 키움)

function rng(seed) { // 항상 같은 순서로 나오는 난수
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

let gltfPromise = null;
export async function addTrees(scene, loader, unitScale, worldRadius = 30) {
  gltfPromise ||= loader.loadAsync('models/trees.glb');
  const gltf = await gltfPromise;
  const RING_IN = worldRadius + RING_GAP, RING_OUT = RING_IN + RING_WIDTH;
  const ringArea = (r) => (r + RING_GAP + RING_WIDTH) ** 2 - (r + RING_GAP) ** 2;
  const count = Math.round(TREE_COUNT * ringArea(worldRadius) / ringArea(30));
  const kinds = [];
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const parts = [];
    node.traverse((o) => { if (o.isMesh) parts.push(o); });
    if (parts.length) kinds.push(parts);
  }
  const group = new THREE.Group();
  if (!kinds.length) return group;

  // 자리 뽑기: 안쪽(경계 가까이)일수록 촘촘하게
  const rand = rng(20261119 + Math.round(worldRadius));
  const spots = [];
  for (let tries = 0; spots.length < count && tries < 5000; tries++) {
    const r = RING_IN + Math.pow(rand(), 1.6) * (RING_OUT - RING_IN);
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const gap = MIN_GAP * (0.8 + (r - RING_IN) / (RING_OUT - RING_IN) * 0.6);
    if (spots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap)) continue;
    spots.push({ x, z, kind: Math.floor(rand() * kinds.length), yaw: rand() * Math.PI * 2, s: SCALE_MIN + rand() * (SCALE_MAX - SCALE_MIN) });
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  kinds.forEach((parts, k) => {
    const mine = spots.filter((p) => p.kind === k);
    if (!mine.length) return;
    for (const src of parts) {
      const geo = src.geometry.clone();
      const mat = src.material.clone();
      mat.onBeforeCompile = (sh) => { // 시선을 가리는 부분은 뚫기
        Object.assign(sh.uniforms, seeThrough);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTreeWorld;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTreeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vTreeWorld;\n${SEE_THROUGH_GLSL}`)
          .replace('void main() {', 'void main() {\n  if (seeThroughCut(vTreeWorld, cameraPosition)) discard;');
      };
      const inst = new THREE.InstancedMesh(geo, mat, mine.length);
      mine.forEach((p, i) => {
        pos.set(p.x, 0, p.z);
        q.setFromAxisAngle(up, p.yaw);
        scl.setScalar(unitScale * p.s);
        inst.setMatrixAt(i, m.compose(pos, q, scl));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = false;   // 그림자는 떼리앙 주변만 계산하므로 맵 밖 나무는 끔 (가볍게)
      inst.receiveShadow = false;
      group.add(inst);
    }
  });
  scene.add(group);
  return group;
}

// 매 프레임: 뚫어 보일 기준(내 떼리앙 또는 카메라가 보는 곳)
const _v = new THREE.Vector3();
export function setTreeFocus(v, camera, renderer) {
  seeThrough.uFocus.value.copy(v);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  _v.copy(v).project(camera);
  seeThrough.uFocusPx.value.set((_v.x * 0.5 + 0.5) * size.x, (_v.y * 0.5 + 0.5) * size.y);
  // 떼리앙 주변 약 2.2m가 들어가는 크기 (가까우면 크게, 멀면 작게), 화면 높이의 12~45% 사이
  const dist = camera.position.distanceTo(v);
  const px = (2.2 / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * (size.y / 2);
  seeThrough.uCutR.value = THREE.MathUtils.clamp(px, size.y * 0.12, size.y * 0.45);
}
