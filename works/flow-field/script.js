// フローフィールド生成: 少ないパラメータ(格子ノイズ + パーティクル追従)から複雑な流れを作る実験
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

let width, height;
function resize() {
  width = canvas.width = canvas.clientWidth;
  height = canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resize);
resize();

// --- 値ノイズ(擬似パーリン) ---
const GRID = 12;
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function noise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const a = hash(x0, y0), b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const PARTICLE_COUNT = 400;
const particles = [];
function spawn(p) {
  p.x = Math.random() * width;
  p.y = Math.random() * height;
  p.life = 60 + Math.random() * 120;
}
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const p = {};
  spawn(p);
  particles.push(p);
}

ctx.fillStyle = "#000";
ctx.fillRect(0, 0, width, height);

function step() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(125, 211, 252, 0.6)";
  ctx.lineWidth = 1;

  const t = performance.now() * 0.00005;
  for (const p of particles) {
    const angle = noise(p.x / (width / GRID), p.y / (height / GRID) + t * 20) * Math.PI * 4;
    const nx = p.x + Math.cos(angle) * 2;
    const ny = p.y + Math.sin(angle) * 2;

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    p.x = nx;
    p.y = ny;
    p.life -= 1;

    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height || p.life <= 0) {
      spawn(p);
    }
  }

  requestAnimationFrame(step);
}
requestAnimationFrame(step);
