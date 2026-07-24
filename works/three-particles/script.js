import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODELS = [
  { id: "duck", label: "Duck", url: "models/duck/Duck.glb" },
  { id: "damaged-helmet", label: "Damaged Helmet", url: "models/damaged-helmet/DamagedHelmet.glb" },
  { id: "suzanne", label: "Suzanne", url: "models/suzanne/Suzanne.gltf" },
];

const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
const loadingEl = document.getElementById("loading");
const toggleBtn = document.getElementById("toggle");
const settingsCard = document.getElementById("settings-card");
const applySettingsBtn = document.getElementById("apply-settings");
const modelSelect = document.getElementById("model-select");
const particleCountInput = document.getElementById("particle-count");

// 一覧ページのiframeプレビューに埋め込まれている場合は、操作UIを隠して
// 回転するモデルだけが見えるようにする(新規タブで開いた時のみ操作可能にする)
const isEmbedded = window.self !== window.top;

for (const m of MODELS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  modelSelect.appendChild(opt);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

// メタリックなPBRマテリアル(DamagedHelmet/Suzanne等)は環境光がないと
// ほぼ黒く映ってしまうため、簡易な環境マップを反射用に用意する
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const rig = new THREE.Group();
scene.add(rig);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.addEventListener("start", () => { controls.autoRotate = false; });
controls.addEventListener("end", () => { controls.autoRotate = true; });

// 粒子を丸く見せるための円形テクスチャ(alphaTestで四角の角を消す)
function createDotTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const dotTexture = createDotTexture();

let meshGroup = null;
let points = null;
let showingParticles = false;
let allPositions = [];   // 現在のモデルの全頂点座標(x,y,z の平坦配列)
let modelRadius = 1;

function setMode(particles) {
  showingParticles = particles;
  if (meshGroup) meshGroup.visible = !particles;
  if (points) points.visible = particles;
  toggleBtn.textContent = particles ? "→ 元モデル" : "→ 粒子化";
}

// evenly-spaced な間引きで指定個数の粒子を作る(ランダムより形状の見え方が安定する)
function buildParticleGeometry(count) {
  const total = allPositions.length / 3;
  const target = Math.max(1, Math.min(count, total));
  const positions = new Float32Array(target * 3);
  const stride = total / target;
  for (let i = 0; i < target; i++) {
    const srcIndex = Math.min(total - 1, Math.floor(i * stride));
    positions[i * 3] = allPositions[srcIndex * 3];
    positions[i * 3 + 1] = allPositions[srcIndex * 3 + 1];
    positions[i * 3 + 2] = allPositions[srcIndex * 3 + 2];
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function rebuildPoints(count) {
  if (points) {
    rig.remove(points);
    points.geometry.dispose();
    points.material.dispose();
  }
  const geometry = buildParticleGeometry(count);
  const material = new THREE.PointsMaterial({
    size: Math.max(modelRadius * 0.01, 0.005),
    sizeAttenuation: true,
    color: 0x7dd3fc,
    map: dotTexture,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  points = new THREE.Points(geometry, material);
  points.visible = showingParticles;
  rig.add(points);
}

function disposeMeshGroup(group) {
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((m) => m.dispose());
    } else {
      child.material.dispose();
    }
  });
}

function loadModel(modelDef) {
  loadingEl.hidden = false;
  loadingEl.textContent = "読み込み中...";

  new GLTFLoader().load(
    modelDef.url,
    (gltf) => {
      if (meshGroup) {
        rig.remove(meshGroup);
        disposeMeshGroup(meshGroup);
      }

      // rigの位置(前のモデルの中心合わせオフセット)が残っていると、
      // 頂点収集時の座標系とレンダリング時の座標系がずれるため、
      // 新しいモデルを追加する前に一旦リセットする。
      // rig.position.set()だけではmatrixWorldは再計算されず(次のrender時まで
      // 古い値が残る)、Box3.setFromObjectや手動のupdateMatrixWorld(true)は
      // 親の行列を遡って更新しないため、ここで明示的にrig自身のmatrixWorldを
      // 更新しておく。これを怠ると前のモデルのオフセットがcenter計算に混入し、
      // 切り替えるたびにズレが蓄積してしまう
      rig.position.set(0, 0, 0);
      rig.updateMatrixWorld(true);

      meshGroup = gltf.scene;
      rig.add(meshGroup);

      const box = new THREE.Box3().setFromObject(meshGroup);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // rigがまだ(0,0,0)の状態でmeshGroup基準のワールド座標を集める。
      // ここでrigのオフセットを適用してしまうと、後でpointsをrigの子として
      // 追加した際にオフセットが二重に効いてしまう
      allPositions = [];
      meshGroup.updateMatrixWorld(true);
      meshGroup.traverse((child) => {
        if (!child.isMesh) return;
        const posAttr = child.geometry.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < posAttr.count; i++) {
          v.fromBufferAttribute(posAttr, i);
          v.applyMatrix4(child.matrixWorld);
          allPositions.push(v.x, v.y, v.z);
        }
      });

      // モデルのスケールはファイルごとに異なるため、バウンディングボックスから
      // 中心を原点に揃え、カメラ距離をサイズに合わせて自動調整する
      rig.position.sub(center);

      modelRadius = size.length() * 0.5;

      // 縦長・横長どちらの形状でも欠けずに収まるよう、縦・横それぞれのFOVで
      // 必要なカメラ距離を計算し、大きい方を採用する(対角線ベースの概算だと
      // 横に広い/平たいモデルで上下が欠けることがあるため)
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const distForHeight = size.y / 2 / Math.tan(vFov / 2);
      const distForWidth = size.x / 2 / Math.tan(hFov / 2);
      const fitDistance = Math.max(distForHeight, distForWidth) + size.z / 2;
      const cameraDistance = fitDistance * 1.35; // 余白分のマージン

      camera.position.set(0, modelRadius * 0.3, cameraDistance);
      controls.target.set(0, 0, 0);
      controls.minDistance = modelRadius * 0.5;
      controls.maxDistance = modelRadius * 8;
      controls.update();

      const totalVertices = allPositions.length / 3;
      particleCountInput.max = totalVertices;
      particleCountInput.value = totalVertices;

      rebuildPoints(totalVertices);
      setMode(showingParticles);

      loadingEl.hidden = true;
      if (!isEmbedded) {
        toggleBtn.hidden = false;
        settingsCard.hidden = false;
      }
      modelSelect.value = currentModel.id;
    },
    undefined,
    (err) => {
      loadingEl.textContent = "モデルの読み込みに失敗しました";
      console.error(err);
    }
  );
}

let currentModel = MODELS[0];

toggleBtn.addEventListener("click", () => setMode(!showingParticles));

applySettingsBtn.addEventListener("click", () => {
  const selected = MODELS.find((m) => m.id === modelSelect.value) ?? MODELS[0];
  const countValue = parseInt(particleCountInput.value, 10);

  if (selected.id !== currentModel.id) {
    currentModel = selected;
    loadModel(currentModel);
  } else if (Number.isFinite(countValue)) {
    rebuildPoints(countValue);
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

loadModel(currentModel);
