import * as THREE from 'three';

// ─────────────────────────────────────────────
// 모델 색칠하기
// FBX에 텍스처/UV가 없어서, 메시를 조각(떨어진 덩어리)별로 나눈 뒤
// 위치를 보고 삼각형마다 색을 칠한다. (CH_guide 턴어라운드 시트 기준)
// ─────────────────────────────────────────────

export const PALETTE = {
  white: 0xffffff,
  yellow: 0xffc536, // 가이드: R255 G197 B54
  red: 0xe80028,    // 가이드: R232 G0 B40
  black: 0x1a1a1a,
};

// 삼각형(비인덱스 지오메트리)을 서로 붙어 있는 조각끼리 묶는다
function findComponents(geo) {
  const pos = geo.attributes.position;
  const triCount = pos.count / 3;
  // 같은 위치의 정점을 하나로 취급 (FBXLoader는 정점을 삼각형마다 복제함)
  const key = (i) => `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`;
  const vid = new Map();
  const welded = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let id = vid.get(k);
    if (id === undefined) { id = vid.size; vid.set(k, id); }
    welded[i] = id;
  }
  const parent = new Int32Array(vid.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < triCount; t++) {
    const a = find(welded[t * 3]);
    parent[find(welded[t * 3 + 1])] = a;
    parent[find(welded[t * 3 + 2])] = a;
  }
  // 조각별 삼각형 목록 + 범위
  const comps = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(welded[t * 3]);
    let c = comps.get(r);
    if (!c) { c = { tris: [], box: new THREE.Box3() }; comps.set(r, c); }
    c.tris.push(t);
    for (let j = 0; j < 3; j++) c.box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, t * 3 + j));
  }
  return [...comps.values()];
}

// 조각마다 부위 번호(partId)를 매긴다 → 화면 외곽선이 부위 경계에 선을 그림
// 작은 자투리 조각은 가장 가까운 큰 조각과 같은 번호로 합친다
function assignPartIds(geo, comps) {
  // 큰 조각 기준: 전체 삼각형의 0.3% 이상 (경량 모델도 팔·발이 따로 잡히도록)
  const MIN_PART_TRIS = Math.max(20, (geo.attributes.position.count / 3) * 0.003);
  const ids = new Float32Array(geo.attributes.position.count);
  const big = comps.filter((c) => c.tris.length >= MIN_PART_TRIS);
  big.forEach((c, i) => { c.partId = i + 1; c.center = c.box.getCenter(new THREE.Vector3()); });
  for (const c of comps) {
    if (c.partId) continue;
    const ctr = c.box.getCenter(new THREE.Vector3());
    let best = big[0], bd = Infinity;
    for (const b of big) {
      // 상자 사이 거리로 비교 (가까이 붙어 있는 큰 조각)
      const d = b.box.distanceToPoint(ctr);
      if (d < bd) { bd = d; best = b; }
    }
    c.partId = best ? best.partId : 1;
  }
  for (const c of comps) for (const t of c.tris) ids[t * 3] = ids[t * 3 + 1] = ids[t * 3 + 2] = c.partId;
  geo.setAttribute('partId', new THREE.BufferAttribute(ids, 1));
}

// 포떼링 (포테이토)
// 원본 좌표: Z가 위, -Y가 얼굴 쪽, X는 좌우(화면 기준 +X가 캐릭터의 왼손 쪽)
function paintPotteling(geo) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const H = bb.max.z - bb.min.z;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  // 정규화 좌표: x(좌우, 키 대비), u(높이 0~1), f(얼굴 방향 +)
  const norm = (v) => ({ x: (v.x - cx) / H, u: (v.z - bb.min.z) / H, f: -(v.y - cy) / H });

  const C = {};
  for (const k in PALETTE) C[k] = new THREE.Color(PALETTE[k]);
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const centroid = (t) => {
    const s = new THREE.Vector3();
    for (let j = 0; j < 3; j++) s.add(v.fromBufferAttribute(pos, t * 3 + j));
    return norm(s.divideScalar(3));
  };

  const setTri = (t, col) => {
    for (let j = 0; j < 3; j++) {
      colors[(t * 3 + j) * 3] = col.r;
      colors[(t * 3 + j) * 3 + 1] = col.g;
      colors[(t * 3 + j) * 3 + 2] = col.b;
    }
  };

  // 감자튀김 머리: 노랑, 캐릭터 오른쪽 두 가닥 윗부분은 케첩(빨강)
  const hairColor = (p) => {
    const ketchupTop = 0.74 + (p.x + 0.33) * 0.7; // 바깥쪽일수록 더 아래까지 묻음
    if (p.x < -0.17 && p.u > ketchupTop) return C.red;
    return C.yellow;
  };

  // 아랫도리(감자 봉투): 흰 바탕에 노란 짧은 줄무늬
  const bagColor = (p) => {
    const ang = Math.atan2(p.x, p.f);           // 몸통 둘레 각도
    const a = ang * 2.4;                        // 둘레 방향 칸
    const h = p.u * 18;                         // 높이 방향 칸
    const ci = Math.floor(a), hi = Math.floor(h);
    const hash = Math.abs(Math.sin(ci * 12.9898 + hi * 78.233) * 43758.5453) % 1;
    if (hash > 0.6 || p.u > 0.29) return C.white;
    // 칸 안에서 비스듬한 짧은 막대
    const lx = a - ci - 0.5, ly = h - hi - 0.5;
    const tilt = hash > 0.27 ? 1.1 : -1.1;
    const d = Math.abs(lx * tilt - ly) / Math.hypot(tilt, 1);
    const along = Math.abs(lx + ly * tilt) / Math.hypot(tilt, 1);
    return d < 0.17 && along < 0.36 ? C.yellow : C.white;
  };

  const comps = findComponents(geo);
  assignPartIds(geo, comps);
  // 부위 이름 기록 (가이드 시트 등에 사용): 삼각형마다 REGIONS 번호
  const regions = new Uint8Array(pos.count / 3);
  for (const c of comps) {
    const n = c.tris.length;
    const lo = norm(c.box.min), hi = norm(c.box.max);
    const mid = norm(c.box.getCenter(new THREE.Vector3()));
    // 조각 분류
    let kind;
    if (lo.u > 0.58 && mid.f < 0.05 && hi.u - lo.u > 0.2) kind = 'hair';
    else if (mid.u > 0.6 && mid.f < 0.05) kind = 'hair';        // 머리 위 자잘한 조각
    else if (hi.u < 0.1) kind = 'yellow';                          // 발
    else if (Math.abs(mid.x) > 0.2 && mid.u < 0.3 && mid.u > 0.13) kind = 'yellow'; // 팔
    else if (mid.f > 0.18 && mid.u > 0.42 && mid.u < 0.5 && Math.abs(mid.x) > 0.12) kind = 'black'; // 눈
    else if (mid.f > 0.23 && mid.u > 0.31 && mid.u < 0.36 && Math.abs(mid.x) < 0.03) kind = 'black'; // 입
    else if (hi.u < 0.33 && lo.u < 0.07) kind = 'bag';             // 아랫도리
    else kind = 'white';                                           // 얼굴, 코, 기타

    let region;
    if (kind === 'hair') region = 'fries';
    else if (kind === 'bag') region = 'bag';
    else if (kind === 'black') region = mid.u > 0.4 ? 'eyes' : 'mouth';
    else if (kind === 'yellow') region = hi.u < 0.1 ? 'feet' : 'arms';
    else if (Math.abs(mid.x) < 0.07 && mid.f > 0.1 && mid.u > 0.4) region = 'nose';
    else region = 'head';

    for (const t of c.tris) {
      let col;
      if (kind === 'hair') col = hairColor(centroid(t));
      else if (kind === 'bag') col = bagColor(centroid(t));
      else col = C[kind];
      setTri(t, col);
      let r = region;
      if (region === 'fries' && col === C.red) r = 'ketchup';
      if (region === 'bag' && col === C.yellow) r = 'bagStripe';
      regions[t] = REGIONS[r].id;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.userData.regions = regions;
}

// 부위 목록 (가이드 시트의 재질 이름/색 기준)
export const REGIONS = {
  fries:     { id: 1, name: '감자튀김 머리', material: 'M_Fries', color: PALETTE.yellow },
  ketchup:   { id: 2, name: '케첩 (엠보)', material: 'M_Ketchup', color: PALETTE.red },
  head:      { id: 3, name: '얼굴/머리', material: 'M_Body', color: PALETTE.white },
  nose:      { id: 4, name: '코', material: 'M_Body', color: PALETTE.white },
  eyes:      { id: 5, name: '눈', material: 'M_Face', color: PALETTE.black },
  mouth:     { id: 6, name: '입', material: 'M_Face', color: PALETTE.black },
  arms:      { id: 7, name: '팔', material: 'M_Limb', color: PALETTE.yellow },
  feet:      { id: 8, name: '발', material: 'M_Limb', color: PALETTE.yellow },
  bag:       { id: 9, name: '감자 봉투', material: 'M_Bag', color: PALETTE.white },
  bagStripe: { id: 10, name: '봉투 줄무늬', material: 'M_Bag (텍스처)', color: PALETTE.yellow },
};

const PAINTERS = { potteling: paintPotteling };

// 텍스처가 있는 모델: 색칠은 건너뛰고 부위 번호만 매김 (외곽선 경계용)
export function labelParts(mesh, idOffset = 0) {
  let geo = mesh.geometry;
  if (geo.index) { geo = geo.toNonIndexed(); mesh.geometry = geo; }
  assignPartIds(geo, findComponents(geo));
  if (idOffset) { const a = geo.attributes.partId.array; for (let i = 0; i < a.length; i++) a[i] += idOffset; }
}

export function paintModel(characterId, mesh) {
  const fn = PAINTERS[characterId];
  if (!fn) return false;
  let geo = mesh.geometry;
  if (geo.index) { geo = geo.toNonIndexed(); mesh.geometry = geo; }
  fn(geo);
  return true;
}
