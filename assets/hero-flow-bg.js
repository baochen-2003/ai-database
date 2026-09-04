/**
 * 头图方案一 / 方案二：底图 + 垂直位移扭曲。
 * 振幅 15、抵消 2、重复 2，方向垂直（沿 Y 置换，波沿 X 重复）。
 */
const VERT = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uImageSize;
uniform float uAmplitude;
uniform float uOffset;
uniform float uRepeat;

const float PI2 = 6.28318530718;

vec2 coverUv(vec2 uv) {
  float ca = uResolution.x / uResolution.y;
  float ia = uImageSize.x / uImageSize.y;
  vec2 scale = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  vec2 uv = coverUv(vUv);
  float wave = sin(uv.x * uRepeat * PI2 + uTime + uOffset);
  uv.y += wave * uAmplitude;
  gl_FragColor = texture2D(uTexture, clamp(uv, 0.0, 1.0));
}
`;

const AMPLITUDE_PX = 15;
const OFFSET = 2;
const REPEAT = 2;
const SPEED = 0.7;
const MAX_DPR = 3;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader compile failed");
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  }
  return program;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });
}

function makeTransparentSource() {
  const placeholder = document.createElement("canvas");
  placeholder.width = 1;
  placeholder.height = 1;
  return placeholder;
}

const noopCtl = { play() {}, pause() {} };

export async function mountHeroFlowBg(element, src, options = {}) {
  if (!element) return noopCtl;

  const amplitudePx = options.amplitudePx ?? AMPLITUDE_PX;
  const offset = options.offset ?? OFFSET;
  const repeat = options.repeat ?? REPEAT;
  const speed = options.speed ?? SPEED;

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (src) {
    element.style.backgroundImage = `url("${src}")`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.style.backgroundRepeat = "no-repeat";
  } else {
    element.style.backgroundImage = "none";
  }

  if (prefersReducedMotion) return noopCtl;

  let image;
  if (src) {
    try {
      image = await loadImage(src);
    } catch {
      return noopCtl;
    }
  } else {
    image = makeTransparentSource();
  }

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  element.appendChild(canvas);

  const glOptions = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  };

  let gl =
    canvas.getContext("webgl2", glOptions) ||
    canvas.getContext("webgl", glOptions);
  if (!gl) {
    canvas.remove();
    return noopCtl;
  }

  let program;
  let buffer;
  let texture;
  let aPosition;
  let uTime;
  let uResolution;
  let uImageSize;
  let uTexture;
  let uAmplitude;
  let uOffset;
  let uRepeat;
  let cssHeight = 1;

  function textureSize() {
    return {
      width: image.naturalWidth || image.width || 1,
      height: image.naturalHeight || image.height || 1,
    };
  }

  function uploadTexture() {
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 8192;
    const size = textureSize();
    let source = image;
    if (size.width > maxSize || size.height > maxSize) {
      const scale = maxSize / Math.max(size.width, size.height);
      const scratch = document.createElement("canvas");
      scratch.width = Math.max(1, Math.round(size.width * scale));
      scratch.height = Math.max(1, Math.round(size.height * scale));
      const ctx = scratch.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, scratch.width, scratch.height);
      source = scratch;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function initGl() {
    program = createProgram(gl);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    aPosition = gl.getAttribLocation(program, "aPosition");
    uTime = gl.getUniformLocation(program, "uTime");
    uResolution = gl.getUniformLocation(program, "uResolution");
    uImageSize = gl.getUniformLocation(program, "uImageSize");
    uTexture = gl.getUniformLocation(program, "uTexture");
    uAmplitude = gl.getUniformLocation(program, "uAmplitude");
    uOffset = gl.getUniformLocation(program, "uOffset");
    uRepeat = gl.getUniformLocation(program, "uRepeat");
    texture = gl.createTexture();
    uploadTexture();
    gl.clearColor(0, 0, 0, 0);
  }

  try {
    initGl();
  } catch {
    canvas.remove();
    return noopCtl;
  }

  let running = false;
  let visible = false;
  let enabled = true;
  let rafId = 0;
  let start = 0;
  let elapsedOffset = 0;
  const viewMargin = 120;

  function isInView() {
    const rect = element.getBoundingClientRect();
    return (
      rect.width >= 2 &&
      rect.height >= 2 &&
      rect.bottom > -viewMargin &&
      rect.top < window.innerHeight + viewMargin
    );
  }

  function syncVisible() {
    visible = isInView();
    if (visible && enabled && !document.hidden) startLoop();
    else stopLoop();
  }

  function render(now) {
    if (!gl || gl.isContextLost()) return;
    if (!start) start = now;
    const elapsed = elapsedOffset + (now - start) / 1000;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uTexture, 0);
    gl.uniform1f(uTime, elapsed * speed);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    const size = textureSize();
    gl.uniform2f(uImageSize, size.width, size.height);
    gl.uniform1f(uAmplitude, amplitudePx / Math.max(cssHeight, 1));
    gl.uniform1f(uOffset, offset);
    gl.uniform1f(uRepeat, repeat);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function resize(force = false) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    cssHeight = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (force || canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    render(performance.now());
    syncVisible();
  }

  function draw(now) {
    if (!running) return;
    render(now);
    rafId = requestAnimationFrame(draw);
  }

  function startLoop() {
    if (running || !visible || !enabled || document.hidden) return;
    running = true;
    start = 0;
    rafId = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (!running) return;
    if (start) elapsedOffset += (performance.now() - start) / 1000;
    running = false;
    start = 0;
    cancelAnimationFrame(rafId);
  }

  function play() {
    enabled = true;
    requestAnimationFrame(() => {
      resize(true);
      syncVisible();
    });
  }

  function pause() {
    enabled = false;
    stopLoop();
  }

  resize();
  play();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);

  const io = new IntersectionObserver(() => syncVisible(), {
    rootMargin: `${viewMargin}px`,
    threshold: 0,
  });
  io.observe(element);

  function onVisibility() {
    if (document.hidden) stopLoop();
    else syncVisible();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function showFallback() {
    element.classList.remove("is-flow-ready");
    if (src) element.style.backgroundImage = `url("${src}")`;
  }

  function markReady() {
    element.classList.add("is-flow-ready");
    element.style.backgroundImage = "none";
  }

  markReady();

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stopLoop();
    showFallback();
  });

  canvas.addEventListener("webglcontextrestored", () => {
    gl =
      canvas.getContext("webgl2", glOptions) ||
      canvas.getContext("webgl", glOptions);
    if (!gl) return;
    try {
      initGl();
      markReady();
      resize(true);
      syncVisible();
    } catch {
      showFallback();
      canvas.remove();
    }
  });

  function destroy() {
    pause();
    resizeObserver.disconnect();
    io.disconnect();
    window.removeEventListener("resize", resize);
    window.visualViewport?.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.remove();
  }

  return { play, pause, destroy };
}
