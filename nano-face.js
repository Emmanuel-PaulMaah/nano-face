// nano-face.js
// tiny wrapper around mediapipe face landmarker using hosted assets only.
export async function createFaceTracker({
  video,               // css selector or <video>
  draw = null,         // optional css selector or <canvas> to auto-draw points
  // hosted model (mediapipe cdn). swap if you prefer a different variant.
  model = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  maxFaces = 1,
  // hosted wasm assets (mediapipe cdn via jsdelivr)
  wasmBaseUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  onResults = () => {}
} = {}) {
  const videoEl = typeof video === 'string' ? document.querySelector(video) : video;
  if (!videoEl) throw new Error('video element not found');

  const canvasEl = draw
    ? (typeof draw === 'string' ? document.querySelector(draw) : draw)
    : null;
  const ctx = canvasEl ? canvasEl.getContext('2d') : null;

  // load mediapipe from cdn — no bundler needed
  const mp = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest');
  const { FilesetResolver, FaceLandmarker } = mp;

  const fileset = await FilesetResolver.forVisionTasks(wasmBaseUrl);
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model },
    runningMode: 'VIDEO',
    numFaces: maxFaces
  });

  // camera
  if (!videoEl.srcObject) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });
    videoEl.srcObject = stream;
  }
  await videoEl.play();

  // keep canvas in sync with video size
  if (canvasEl) {
    const resize = () => {
      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
    };
    if (videoEl.readyState >= 2) resize();
    else videoEl.addEventListener('loadedmetadata', resize, { once: true });
  }

  let raf = 0;
  let last = performance.now();
  let fps = 0;

  const drawPoints = (pts) => {
    if (!ctx) return;
    const w = canvasEl.width, h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x * w, y * h, 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const bbox = (pts) => {
    if (!pts.length) return undefined;
    let xMin = 1, yMin = 1, xMax = 0, yMax = 0;
    for (const [x, y] of pts) {
      if (x < xMin) xMin = x;
      if (y < yMin) yMin = y;
      if (x > xMax) xMax = x;
      if (y > yMax) yMax = y;
    }
    return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
  };

  const loop = () => {
    const now = performance.now();
    const res = landmarker.detectForVideo(videoEl, now);
    const first = res.faceLandmarks?.[0] ?? null;
    const landmarks = first ? first.map(l => [l.x, l.y, l.z ?? 0]) : [];
    drawPoints(landmarks);

    const dt = now - last; if (dt > 0) fps = 1000 / dt; last = now;
    onResults({ landmarks, box: bbox(landmarks), fps });

    raf = requestAnimationFrame(loop);
  };

  return {
    start() { if (!raf) raf = requestAnimationFrame(loop); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    close() { landmarker.close?.(); },
    // escape hatch
    advanced: { landmarker }
  };
}
