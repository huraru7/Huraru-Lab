// ヘッダー用の軽量な装飾ビジュアル: ゆっくり明滅する点の集まり
(function () {
  const canvas = document.getElementById("header-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width, height;
  function resize() {
    width = canvas.width = canvas.clientWidth;
    height = canvas.height = canvas.clientHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const DOT_COUNT = 28;
  const dots = [];
  for (let i = 0; i < DOT_COUNT; i++) {
    dots.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0004 + Math.random() * 0.0004
    });
  }

  function frame(t) {
    ctx.clearRect(0, 0, width, height);
    for (const d of dots) {
      const glow = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * d.speed + d.phase));
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(125, 211, 252, ${glow.toFixed(3)})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
