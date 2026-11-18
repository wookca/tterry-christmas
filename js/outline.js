import * as THREE from 'three';

// ─────────────────────────────────────────────
// 만화 외곽선 (화면 공간 방식)
//
// 1) 외곽선을 그릴 물체(OUTLINE_LAYER)만 따로 한 번 더 그리는데,
//    색 대신 "부위 번호(partId)"와 "깊이"를 그림으로 저장한다.
// 2) 화면 전체를 훑으면서 옆 픽셀과
//    - 물체가 있다/없다가 바뀌면 → 바깥 테두리
//    - 부위 번호가 다르면       → 팔과 몸통 사이 같은 경계선
//    - 깊이가 확 차이 나면      → 같은 부위가 겹친 곳 (감자튀김끼리 등)
//    검은 선을 그린다.
// 메시를 부풀리는 방식과 달리 선이 끊기거나 속이 비지 않는다.
// ─────────────────────────────────────────────

export const OUTLINE_LAYER = 1;
const DEPTH_RANGE = 80; // 깊이 저장 범위(월드 단위)

// 부위 번호 + 깊이를 기록하는 재질
const idMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */`
    attribute float partId;
    varying float vPart;
    varying float vDepth;
    void main() {
      vPart = partId;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vPart;
    varying float vDepth;
    void main() {
      float d = clamp(vDepth / ${DEPTH_RANGE.toFixed(1)}, 0.0, 0.9999);
      float hi = floor(d * 255.0) / 255.0;
      float lo = fract(d * 255.0);
      gl_FragColor = vec4(vPart / 255.0, hi, lo, 1.0);
    }`,
  toneMapped: false,
});

const edgeMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tId: { value: null },
    texel: { value: new THREE.Vector2() },
    thickness: { value: 2 },
    depthThreshold: { value: 0.06 },
    color: { value: new THREE.Color(0x111111) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tId;
    uniform vec2 texel;
    uniform float thickness;
    uniform float depthThreshold;
    uniform vec3 color;
    varying vec2 vUv;
    float depthOf(vec4 c) { return (c.g + c.b / 255.0) * ${DEPTH_RANGE.toFixed(1)}; }
    float edgeAt(vec4 c, vec2 offset) {
      vec4 n = texture2D(tId, vUv + offset);
      bool a = c.a > 0.5, b = n.a > 0.5;
      if (a != b) return 1.0;                                  // 바깥 테두리
      if (!a) return 0.0;
      if (abs(n.r - c.r) > 0.5 / 255.0) return 1.0;            // 부위 경계
      float da = depthOf(c), db = depthOf(n);
      if (abs(da - db) > depthThreshold * max(1.0, da * 0.15)) return 1.0; // 겹친 곳
      return 0.0;
    }
    void main() {
      vec4 c = texture2D(tId, vUv);
      float e = 0.0;
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.785398;
        vec2 dir = vec2(cos(ang), sin(ang));
        e += edgeAt(c, dir * texel * thickness);
        e += edgeAt(c, dir * texel * thickness * 0.5);
      }
      float alpha = clamp(e / 3.0, 0.0, 1.0);
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(color, alpha);
    }`,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});

export class OutlinePass {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    edgeMaterial.uniforms.tId.value = this.target.texture;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMaterial));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.thickness = 2;
    this.setSize();
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    edgeMaterial.uniforms.texel.value.set(1 / size.x, 1 / size.y);
    this.pixelRatio = this.renderer.getPixelRatio();
  }

  // 선 두께 (CSS 픽셀 기준)
  setThickness(px) { this.thickness = px; }

  render(scene, camera) {
    const r = this.renderer;
    const prev = {
      bg: scene.background, fog: scene.fog, override: scene.overrideMaterial,
      mask: camera.layers.mask, autoClear: r.autoClear, shadow: r.shadowMap.autoUpdate,
      clear: r.getClearColor(new THREE.Color()), clearAlpha: r.getClearAlpha(),
    };
    // 1) 부위 번호 + 깊이 그리기
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = idMaterial;
    camera.layers.set(OUTLINE_LAYER);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);

    scene.background = prev.bg;
    scene.fog = prev.fog;
    scene.overrideMaterial = prev.override;
    camera.layers.mask = prev.mask;
    r.shadowMap.autoUpdate = prev.shadow;
    r.setClearColor(prev.clear, prev.clearAlpha);

    // 2) 경계에 검은 선
    edgeMaterial.uniforms.thickness.value = this.thickness * this.pixelRatio;
    r.autoClear = false;
    r.render(this.quadScene, this.quadCam);
    r.autoClear = prev.autoClear;
  }
}

// 외곽선 대상으로 등록 (partId 속성이 없으면 전체를 한 부위로)
export function enableOutline(object, defaultPartId = 1) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.attributes.partId) {
      g.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(defaultPartId), 1));
    }
    o.layers.enable(OUTLINE_LAYER);
  });
}
