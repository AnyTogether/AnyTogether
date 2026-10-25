/** The launcher's animated backgrounds (Cosmic, Aurora, Sunset), drawn with WebGL behind the public
 *  pages: the same shader as tools/macos/launcher/Sources/AnyPS5/BackgroundRenderer.swift, ported
 *  from Metal. Loaded on its own, after the page, so it never holds up the first paint. */

export type Look = "cosmic" | "aurora" | "sunset" | "party";

type Rgb = [number, number, number];
/** deep, middle, bright: the launcher's palettes (Theme.swift); "party" is Cosmic in the seat colours. */
const palettes: Record<Look, [Rgb, Rgb, Rgb]> = {
  cosmic: [
    [0.012, 0.024, 0.09],
    [0.04, 0.15, 0.42],
    [0.42, 0.64, 1.0],
  ],
  aurora: [
    [0.006, 0.03, 0.045],
    [0.02, 0.3, 0.3],
    [0.56, 1.0, 0.78],
  ],
  sunset: [
    [0.06, 0.01, 0.04],
    [0.52, 0.11, 0.22],
    [1.0, 0.64, 0.33],
  ],
  party: [
    [0.03, 0.015, 0.08],
    [0.22, 0.08, 0.42],
    [0.78, 0.5, 1.0],
  ],
};
const shape: Record<Look, number> = { cosmic: 0, aurora: 1, sunset: 2, party: 0 };
/** Aurora's curtains hang where a page's text is; behind text they are kept quieter than in the launcher. */
const strength: Record<Look, number> = { cosmic: 1, aurora: 0.62, sunset: 0.9, party: 1 };

const vertex = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const fragment = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform vec2 size;
uniform float time;
uniform float gain;
uniform float base;
uniform float mixing;
uniform float shapeA;
uniform float shapeB;
uniform float strengthA;
uniform float strengthB;
uniform vec3 deepA; uniform vec3 middleA; uniform vec3 brightA;
uniform vec3 deepB; uniform vec3 middleB; uniform vec3 brightB;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.17)); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) { value += amplitude * noise(p); p = p * 2.03 + 11.7; amplitude *= 0.5; }
  return value;
}
float bokeh(vec2 p, float t, float cells, float rate, float seed) {
  vec2 grid = p * cells;
  grid.y -= t * rate;
  vec2 cell = floor(grid);
  float light = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 here = cell + vec2(float(x), float(y));
    vec2 r = hash2(here + seed);
    vec2 center = here + 0.5 + 0.38 * sin(r * 6.2831 + t * (0.15 + 0.2 * r.yx));
    float radius = mix(0.06, 0.24, r.x * r.x);
    float d = length(grid - center);
    float twinkle = 0.55 + 0.45 * sin(t * (0.4 + r.y) + r.x * 40.0);
    float present = step(0.55, hash(here + seed * 3.1));
    light += present * twinkle * smoothstep(radius, radius * 0.25, d) * (0.35 + 0.65 * r.y);
  }
  return light;
}
vec3 cosmic(float aspect, float t, vec3 deep, vec3 middle, vec3 bright) {
  vec3 color = base * mix(middle * 1.15, deep, smoothstep(0.0, 1.0, uv.y * 0.85 + 0.08));
  color += base * bright * 0.28 * exp(-2.8 * length(vec2((uv.x - 0.8) * aspect, uv.y - 0.08)));
  for (int band = 0; band < 6; band++) {
    float b = float(band);
    float center = 0.56 + 0.028 * b
      + 0.075 * sin(uv.x * (1.4 + 0.22 * b) + t * (0.10 + 0.021 * b) + b * 1.9)
      + 0.03 * sin(uv.x * 4.1 - t * 0.12 + b * 3.1);
    float d = abs(uv.y - center);
    float core = 0.0016 / (d + 0.0028);
    float haze = exp(-d * 14.0);
    float fade = smoothstep(-0.15, 0.4, uv.x) * smoothstep(1.2, 0.6, uv.x);
    float pulse = 0.75 + 0.25 * sin(t * 0.3 + b * 1.7 + uv.x * 2.0);
    vec3 tint = mix(bright, vec3(0.85, 0.92, 1.0), 0.25 + 0.1 * b);
    color += tint * (core * 0.16 + haze * 0.1) * fade * pulse;
  }
  vec2 p = vec2(uv.x * aspect, uv.y);
  color += bright * 0.22 * bokeh(p, t, 5.0, 0.012, 1.0);
  color += vec3(0.9, 0.95, 1.0) * 0.14 * bokeh(p, t * 1.3, 11.0, 0.02, 7.0);
  return color;
}
vec3 aurora(float aspect, float t, vec3 deep, vec3 middle, vec3 bright) {
  vec3 color = base * mix(deep * 1.8, deep * 0.7, uv.y);
  vec2 p = vec2(uv.x * aspect, uv.y);
  for (int layer = 0; layer < 3; layer++) {
    float l = float(layer);
    float sway = fbm(vec2(p.x * 0.7 + l * 3.7 + t * 0.02, t * 0.03 + l));
    float center = 0.30 + 0.09 * l + 0.36 * (sway - 0.5) + 0.05 * sin(p.x * 1.7 + t * 0.08 + l * 2.0);
    float thickness = 6.0 + 2.0 * l + 2.5 * sin(p.x * 1.3 + t * 0.05 + l);
    float below = uv.y - center;
    float curtain = exp(-below * below * thickness * thickness) * smoothstep(-0.35, 0.0, below + 0.12);
    float rays = smoothstep(0.15, 0.95, noise(vec2(p.x * 16.0 + l * 7.0, t * 0.18 + p.x * 0.5)));
    float glow = curtain * (0.45 + 0.55 * rays);
    vec3 tint = mix(bright, mix(vec3(0.35, 0.55, 1.0), vec3(0.75, 0.4, 1.0), l * 0.5), smoothstep(-0.05, 0.12, -below));
    color += tint * glow * (0.62 - 0.14 * l);
  }
  vec2 starCell = floor(p * 150.0);
  float star = step(0.9965, hash(starCell)) * (0.55 + 0.45 * sin(t * 1.6 + hash(starCell + 3.0) * 30.0));
  vec2 local = fract(p * 150.0) - 0.5;
  color += star * smoothstep(0.35, 0.0, length(local)) * smoothstep(0.8, 0.1, uv.y) * 0.9;
  color += middle * 0.45 * smoothstep(0.6, 1.0, uv.y) * (0.6 + 0.4 * fbm(vec2(p.x * 1.5, t * 0.03)));
  return color;
}
vec3 sunset(float aspect, float t, vec3 deep, vec3 middle, vec3 bright) {
  vec3 top = deep * 1.4;
  vec3 low = mix(bright, vec3(1.0, 0.42, 0.38), 0.45) * 0.85;
  vec3 color = mix(top, middle, smoothstep(0.0, 0.6, uv.y));
  color = base * mix(color, low, smoothstep(0.5, 1.1, uv.y));
  vec2 p = vec2(uv.x * aspect, uv.y);
  for (int blob = 0; blob < 6; blob++) {
    float b = float(blob);
    vec2 center = vec2((0.15 + 0.16 * b) * aspect + 0.14 * sin(t * (0.05 + 0.013 * b) + b * 2.0), 0.5 + 0.24 * sin(t * (0.04 + 0.01 * b) + b * 1.3));
    float radius = 0.2 + 0.07 * sin(b * 4.1);
    float light = exp(-dot(p - center, p - center) / (radius * radius));
    color += mix(bright, vec3(1.0, 0.35, 0.6), fract(b * 0.37)) * light * 0.2;
  }
  color += mix(bright, vec3(1.0, 0.8, 0.6), 0.4) * 0.22 * exp(-abs(uv.y - 0.76) * 5.0) * (0.85 + 0.15 * sin(uv.x * 2.4 + t * 0.15));
  color += vec3(1.0, 0.85, 0.7) * 0.1 * bokeh(p, t, 7.0, -0.01, 3.0);
  return color;
}
vec3 look(float which, float aspect, float t, vec3 deep, vec3 middle, vec3 bright) {
  if (which > 1.5) return sunset(aspect, t, deep, middle, bright);
  if (which > 0.5) return aurora(aspect, t, deep, middle, bright);
  return cosmic(aspect, t, deep, middle, bright);
}
void main() {
  float aspect = size.x / size.y;
  vec3 color = strengthA * look(shapeA, aspect, time, deepA, middleA, brightA);
  if (mixing > 0.001) color = mix(color, strengthB * look(shapeB, aspect, time, deepB, middleB, brightB), mixing);
  vec2 centered = (uv - 0.5) * vec2(aspect, 1.0);
  color *= 1.0 - 0.45 * smoothstep(0.35, 1.25, length(centered));
  color = color / (1.0 + color * 0.35);
  color *= gain;
  color += (hash(gl_FragCoord.xy + fract(time) * 91.0) - 0.5) / 255.0 * 2.0;
  gl_FragColor = vec4(color, 1.0);
}`;

export type Ribbons = {
  /** Moves to another look, blending the two for a moment. */
  setLook(look: Look): void;
  /** Runs or holds the animation (held: offscreen, a hidden tab, reduced motion). */
  play(running: boolean): void;
  destroy(): void;
};

/** Starts drawing into the canvas; null where WebGL is missing. `onFirstFrame` runs once the canvas
 *  holds a picture, so it can fade in over the CSS gradient it replaces. */
export function startRibbons(
  canvas: HTMLCanvasElement,
  options: {
    look: Look;
    /** Overall brightness. */
    gain?: number;
    /** Brightness of the sky behind the light alone: below 1 the ribbons stand out of a darker night. */
    base?: number;
    scale?: number;
    still?: boolean;
    onFirstFrame?: () => void;
  },
): Ribbons | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const at = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    size: at("size"),
    time: at("time"),
    gain: at("gain"),
    base: at("base"),
    mixing: at("mixing"),
    shapeA: at("shapeA"),
    shapeB: at("shapeB"),
    strengthA: at("strengthA"),
    strengthB: at("strengthB"),
    deepA: at("deepA"),
    middleA: at("middleA"),
    brightA: at("brightA"),
    deepB: at("deepB"),
    middleB: at("middleB"),
    brightB: at("brightB"),
  };
  gl.uniform1f(u.gain, options.gain ?? 1);
  gl.uniform1f(u.base, options.base ?? 1);

  let from: Look = options.look;
  let to: Look = options.look;
  let blendStart = 0;
  const blendFor = 1100;
  const setPalette = (look: Look, slot: "A" | "B") => {
    const [deep, middle, bright] = palettes[look];
    gl.uniform3fv(u[`deep${slot}`], deep);
    gl.uniform3fv(u[`middle${slot}`], middle);
    gl.uniform3fv(u[`bright${slot}`], bright);
    gl.uniform1f(u[`shape${slot}`], shape[look]);
    gl.uniform1f(u[`strength${slot}`], strength[look]);
  };
  setPalette(from, "A");
  setPalette(to, "B");

  // Like the launcher, the clock starts somewhere in the middle, not at the quiet first frame.
  const offset = 40 + Math.random() * 300;
  const begun = performance.now();
  const scale = options.scale ?? 0.5;
  let frame = 0;
  let running = false;
  let first = true;
  let last = 0;

  const resize = () => {
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.size, width, height);
    }
  };
  const draw = (now: number) => {
    resize();
    gl.uniform1f(u.time, options.still ? offset : offset + (now - begun) / 1000);
    let mixing = 0;
    if (from !== to) {
      const t = Math.min(1, (now - blendStart) / blendFor);
      mixing = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      if (t >= 1) {
        from = to;
        setPalette(from, "A");
        mixing = 0;
      }
    }
    gl.uniform1f(u.mixing, mixing);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (first) {
      first = false;
      options.onFirstFrame?.();
    }
  };
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    // Slow light needs no more than 30 pictures a second; the rest of the frame budget stays free.
    if (now - last < 32 && from === to) return;
    last = now;
    draw(now);
  };
  const resizeObserver = new ResizeObserver(() => {
    if (!running) draw(performance.now());
  });
  resizeObserver.observe(canvas);

  draw(performance.now());
  return {
    setLook(look) {
      if (look === to) return;
      if (from !== to) {
        from = to;
        setPalette(from, "A");
      }
      to = look;
      setPalette(to, "B");
      blendStart = performance.now();
      if (!running) {
        const blend = (now: number) => {
          draw(now);
          if (from !== to && !running) requestAnimationFrame(blend);
        };
        requestAnimationFrame(blend);
      }
    },
    play(wanted) {
      const next = wanted && !options.still;
      if (next === running) return;
      running = next;
      if (running) frame = requestAnimationFrame(tick);
      else cancelAnimationFrame(frame);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
