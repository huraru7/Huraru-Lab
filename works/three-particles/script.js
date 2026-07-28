import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

const MODELS = [
	{ id: "ancient-tree", label: "Ancient Tree", url: "models/ancient_tree.glb" },
	{ id: "orc", label: "Low-poly Orc", url: "models/low-poly_orc.glb" },
	{ id: "vtol-helicopter", label: "VTOL Helicopter", url: "models/vtol_helicopter_animated.glb" },
];

const MAX_PARTICLE_COUNT = 200000;
const DEFAULT_PARTICLE_COUNT = 20000;

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

// 簡易な環境マップ
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const rig = new THREE.Group();
scene.add(rig);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.addEventListener("start", () => {
	controls.autoRotate = false;
});
controls.addEventListener("end", () => {
	controls.autoRotate = true;
});

// 粒子を丸く見せるためのテクスチャ
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
let meshSamplers = []; // 現在のモデルの各メッシュ用
let modelRadius = 1;

// 三角形3点(ワールド座標)から面積を求めるための使い回し用バッファ
const _triA = new THREE.Vector3();
const _triB = new THREE.Vector3();
const _triC = new THREE.Vector3();
const _tri = new THREE.Triangle();

// ジオメトリのワールド座標での表面積(全三角形の面積の合計)を求める。
// 面積比でメッシュごとの粒子配分数を決めるために使う
function computeWorldSurfaceArea(geometry, matrixWorld) {
	const posAttr = geometry.attributes.position;
	const index = geometry.index;
	const triCount = index ? index.count / 3 : posAttr.count / 3;
	let area = 0;
	for (let i = 0; i < triCount; i++) {
		const i0 = index ? index.getX(i * 3) : i * 3;
		const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
		const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
		_triA.fromBufferAttribute(posAttr, i0).applyMatrix4(matrixWorld);
		_triB.fromBufferAttribute(posAttr, i1).applyMatrix4(matrixWorld);
		_triC.fromBufferAttribute(posAttr, i2).applyMatrix4(matrixWorld);
		area += _tri.set(_triA, _triB, _triC).getArea();
	}
	return area;
}

// SkinnedMeshは頂点座標がバインドポーズ(基本姿勢)のまま保持され、実際の見た目の
// ポーズはGPU側のボーン変形で決まる。MeshSurfaceSamplerは生のジオメトリ座標しか
// 見ないため、そのままだと粒子が基本姿勢の位置になり元モデルの見た目とズレる。
// そこで現在のポーズを頂点位置に焼き込んだジオメトリを別途作ってサンプリングに使う
function bakePosedGeometry(mesh) {
	const geometry = mesh.geometry.clone();
	const posAttr = geometry.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < posAttr.count; i++) {
		v.fromBufferAttribute(posAttr, i);
		mesh.applyBoneTransform(i, v);
		posAttr.setXYZ(i, v.x, v.y, v.z);
	}
	posAttr.needsUpdate = true;
	return geometry;
}

function setMode(particles) {
	showingParticles = particles;
	if (meshGroup) meshGroup.visible = !particles;
	if (points) points.visible = particles;
	toggleBtn.textContent = particles ? "→ 元モデル" : "→ 粒子化";
}

// 各メッシュの表面積比に応じて粒子数を配分し、MeshSurfaceSamplerで
// メッシュ表面上をランダムサンプリングして指定個数の粒子を作る
function buildParticleGeometry(count) {
	const target = Math.max(1, Math.min(count, MAX_PARTICLE_COUNT));
	const totalArea = meshSamplers.reduce((sum, s) => sum + s.area, 0);
	const positions = new Float32Array(target * 3);
	const v = new THREE.Vector3();

	let writeIndex = 0;
	let allocatedSoFar = 0;
	meshSamplers.forEach((entry, i) => {
		const isLast = i === meshSamplers.length - 1;
		// 端数の丸め誤差は最後のメッシュにまとめて吸収し、合計を target に一致させる
		const share = isLast
			? target - allocatedSoFar
			: Math.round((totalArea > 0 ? entry.area / totalArea : 1 / meshSamplers.length) * target);
		allocatedSoFar += share;

		for (let j = 0; j < share && writeIndex < target; j++) {
			entry.sampler.sample(v);
			v.applyMatrix4(entry.matrixWorld);
			positions[writeIndex * 3] = v.x;
			positions[writeIndex * 3 + 1] = v.y;
			positions[writeIndex * 3 + 2] = v.z;
			writeIndex++;
		}
	});

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.subarray(0, writeIndex * 3), 3));
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
			rig.position.set(0, 0, 0);
			rig.updateMatrixWorld(true);

			meshGroup = gltf.scene;
			rig.add(meshGroup);

			const box = new THREE.Box3().setFromObject(meshGroup);
			const size = box.getSize(new THREE.Vector3());
			const center = box.getCenter(new THREE.Vector3());

			// rigがまだ(0,0,0)の状態でmeshGroup基準のワールド行列を使ってサンプラーを構築する。
			// ここでrigのオフセットを適用してしまうと、後でpointsをrigの子として
			// 追加した際にオフセットが二重に効いてしまう
			meshSamplers = [];
			meshGroup.updateMatrixWorld(true);
			meshGroup.traverse((child) => {
				if (!child.isMesh) return;
				// SkinnedMeshは現在のポーズを焼き込んだジオメトリを別途作ってサンプリングする
				const geometry = child.isSkinnedMesh ? bakePosedGeometry(child) : child.geometry;
				const sampleSource = child.isSkinnedMesh ? new THREE.Mesh(geometry) : child;
				const sampler = new MeshSurfaceSampler(sampleSource).build();
				const area = computeWorldSurfaceArea(geometry, child.matrixWorld);
				// child.matrixWorld は参照のまま持つとレンダーループの再計算で書き換わって
				// しまう(rigの中心合わせオフセットが後から二重に効いてズレる原因になる)ため、
				// ここで固定値として複製しておく
				meshSamplers.push({ sampler, matrixWorld: child.matrixWorld.clone(), area });
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

			// near/farはモデルのスケールに合わせて毎回更新する。固定値のままだと
			// スケールの大きいモデルでカメラ距離がfarを超え、描画されなくなってしまう
			camera.near = Math.max(modelRadius * 0.01, 0.01);
			camera.far = cameraDistance + modelRadius * 8;
			camera.updateProjectionMatrix();
			controls.update();

			particleCountInput.max = MAX_PARTICLE_COUNT;
			particleCountInput.value = DEFAULT_PARTICLE_COUNT;

			rebuildPoints(DEFAULT_PARTICLE_COUNT);
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
		},
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
