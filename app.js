// Adapted from freqPhaseMod by Paloma Kop, CC BY-NC-SA 4.0. See README.md.
// presets: add entries here to grow the preset menu
const PRESETS = [
  { name: 'default PM', mode:1, wave:0, freq:5, depth:8,  phase:0, scroll:0.3,  blur:1.5, contrast:1 },
  { name: 'default FM', mode:0, wave:0, freq:5, depth:8,  phase:0, scroll:0.3,  blur:1.5, contrast:1 },
  { name: 'topographic', mode:1, wave:3, freq:0, depth:24,  phase:0, scroll:0.3,  blur:2, contrast:1 },
  { name: 'pointilist', mode:0, wave:3, freq:3, depth:90,  phase:0, scroll:1.5,  blur:0, contrast:1 },
  { name: 'one-bit', mode:1, wave:2, freq:5, depth:5,  phase:0, scroll:0.2,  blur:1, contrast:4 },
  { name: 'dazzle', mode:0, wave:4, freq:7, depth:65,  phase:0, scroll:0,  blur:1, contrast:4 },
  { name: 'metal', mode:1, wave:1, freq:0, depth:3,  phase:0, scroll:0,  blur:0, contrast:4 },
];

(() => {
  const canvas = document.getElementById('gl');
  const msg = document.getElementById('msg');
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer:true });
  if (!gl) { msg.textContent = 'webgl2 not supported'; return; }

  // half-float render targets keep the blurred gradient smooth (8-bit bands under phase mod)
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');

  const TARGET_W = 1600;   // output canvas max dimension (applied to the longer side)
  const PROC_W = 512;      // width of blur pyramid level 0
  const LEVELS = 6;        // pyramid depth (max blur)

  // fullscreen triangle
  const vsrc = `#version 300 es
  out vec2 uv;
  void main(){
    vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
    uv = p;
    gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
  }`;

  // copy camera into the pyramid base (flip y once here; apply contrast)
  const fsrcCopy = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  uniform float uContrast;
  uniform float uInvert;
  void main(){
    vec4 c = texture(src, vec2(uv.x, 1.0 - uv.y));
    c.rgb = clamp((c.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
    c.rgb = mix(c.rgb, 1.0 - c.rgb, uInvert);
    frag = c;
  }`;

  // dual kawase downsample (samples the larger source into a half-size target)
  const fsrcDown = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  uniform vec2 texel;   // 1.0 / source size
  void main(){
    vec4 sum = texture(src, uv) * 4.0;
    sum += texture(src, uv + vec2(-texel.x, -texel.y));
    sum += texture(src, uv + vec2( texel.x, -texel.y));
    sum += texture(src, uv + vec2(-texel.x,  texel.y));
    sum += texture(src, uv + vec2( texel.x,  texel.y));
    frag = sum / 8.0;
  }`;

  // dual kawase upsample (samples the smaller source into a larger target)
  const fsrcUp = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  uniform vec2 texel;   // 1.0 / source size
  void main(){
    vec4 sum = texture(src, uv + vec2(-texel.x*2.0, 0.0));
    sum += texture(src, uv + vec2(-texel.x, texel.y)) * 2.0;
    sum += texture(src, uv + vec2(0.0, texel.y*2.0));
    sum += texture(src, uv + vec2(texel.x, texel.y)) * 2.0;
    sum += texture(src, uv + vec2(texel.x*2.0, 0.0));
    sum += texture(src, uv + vec2(texel.x, -texel.y)) * 2.0;
    sum += texture(src, uv + vec2(0.0, -texel.y*2.0));
    sum += texture(src, uv + vec2(-texel.x, -texel.y)) * 2.0;
    frag = sum / 12.0;
  }`;

  // blend two textures (for fractional blur level -> smooth slider)
  const fsrcMix = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D a; uniform sampler2D b; uniform float t;
  void main(){ frag = mix(texture(a, uv), texture(b, uv), t); }`;

  // luma of the blurred source into R (start of the prefix sum)
  const fsrcLuma = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  void main(){
    vec3 c = texture(src, uv).rgb;
    float l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    frag = vec4(l, 0.0, 0.0, 1.0);
  }`;

  // one Hillis-Steele prefix-sum pass along x: add the pixel `offset` texels to the left
  const fsrcScan = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  uniform int offset;
  void main(){
    ivec2 c = ivec2(gl_FragCoord.xy);
    float here = texelFetch(src, c, 0).r;
    ivec2 nc = ivec2(c.x - offset, c.y);
    float there = (nc.x >= 0) ? texelFetch(src, nc, 0).r : 0.0;
    frag = vec4(here + there, 0.0, 0.0, 1.0);
  }`;

  // oscillator reads the blurred texture. modulation term (m)
  // is isolated so the FM/prefix-sum path drops in here later.
  const fsrcMain = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;      // PM: blurred source. FM: prefix-sum (integral) texture
  uniform float uFreq, uDepth, uPhase, uDuty, uWidth;
  uniform int uWave, uMode;
  uniform vec3 uColorLow, uColorHigh;
  #define TAU 6.28318530718
  float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main(){
    float m;
    if (uMode == 0){
      // FM: normalized running integral (prefix sum / width), same as the TD tool.
      // real images are dark so this term is small; FM depth is scaled up to suit.
      ivec2 res = textureSize(src, 0);
      // sample the integral with manual linear interp along x (smooths the 512->1600
      // upscale without needing OES_texture_float_linear, which 32F filtering requires)
      float fx = uv.x * float(res.x) - 0.5;
      int x0 = clamp(int(floor(fx)), 0, res.x - 1);
      int x1 = clamp(x0 + 1, 0, res.x - 1);
      float fr = fx - float(x0);
      int yy = clamp(int(uv.y * float(res.y)), 0, res.y - 1);
      float a = texelFetch(src, ivec2(x0, yy), 0).r;
      float b = texelFetch(src, ivec2(x1, yy), 0).r;
      m = mix(a, b, fr) / float(res.x);
    } else {
      // PM: local blurred brightness
      m = clamp(luma(texture(src, uv).rgb), 0.0, 1.0);
    }

    float s = uv.x;
    float fmScale = (uMode == 0) ? 2.4 : 1.0;   // FM integral term is small; scale it up
    float cyc = uFreq*s + uDepth*fmScale*m - fract(uPhase);
    float phase = TAU * cyc;
    float tph = fract(cyc);

    float carrier;
    if (uWave == 0)      carrier = 0.5 + 0.5*cos(phase + TAU*0.5);
    else if (uWave == 1) carrier = 1.0 - abs(tph - 0.5) * 2.0;
    else if (uWave == 2) carrier = step(uDuty, tph);
    else if (uWave == 3){
      float tphP = fract(cyc + 0.5);
      float lw = max(uWidth, 2.0);
      float d = min(tphP, 1.0 - tphP);
      float w = abs(dFdx(cyc));
      float linePx = d / max(w, 1e-6);
      carrier = 1.0 - smoothstep(lw*0.5 - 0.5, lw*0.5 + 0.5, linePx);
    }
    else if (uWave == 4) carrier = tph;
    else                 carrier = 1.0 - tph;

    frag = vec4(mix(uColorLow, uColorHigh, clamp(carrier, 0.0, 1.0)), 1.0);
  }`;

  // grayscale blit for the PiP source preview
  const fsrcGray = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 frag;
  uniform sampler2D src;
  void main(){
    vec3 c = texture(src, uv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    frag = vec4(vec3(l), 1.0);
  }`;

  function sh(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs){
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return p;
  }
  const progCopy = program(fsrcCopy);
  const progDown = program(fsrcDown);
  const progUp   = program(fsrcUp);
  const progMix  = program(fsrcMix);
  const progLuma = program(fsrcLuma);
  const progScan = program(fsrcScan);
  const progMain = program(fsrcMain);
  const progGray = program(fsrcGray);

  const uGraySrc      = gl.getUniformLocation(progGray, 'src');
  const uLumaSrc      = gl.getUniformLocation(progLuma, 'src');
  const uScanSrc      = gl.getUniformLocation(progScan, 'src');
  const uMainSrc      = gl.getUniformLocation(progMain, 'src');
  const uScanOffset   = gl.getUniformLocation(progScan, 'offset');
  const uCopyContrast = gl.getUniformLocation(progCopy, 'uContrast');
  const uCopyInvert   = gl.getUniformLocation(progCopy, 'uInvert');

  const uDownTexel = gl.getUniformLocation(progDown, 'texel');
  const uUpTexel   = gl.getUniformLocation(progUp, 'texel');
  const uMix = { a:gl.getUniformLocation(progMix,'a'), b:gl.getUniformLocation(progMix,'b'), t:gl.getUniformLocation(progMix,'t') };
  const M = {
    colorLow:gl.getUniformLocation(progMain,'uColorLow'),
    colorHigh:gl.getUniformLocation(progMain,'uColorHigh'),
    freq:gl.getUniformLocation(progMain,'uFreq'),
    depth:gl.getUniformLocation(progMain,'uDepth'),
    phase:gl.getUniformLocation(progMain,'uPhase'),
    duty:gl.getUniformLocation(progMain,'uDuty'),
    width:gl.getUniformLocation(progMain,'uWidth'),
    wave:gl.getUniformLocation(progMain,'uWave'),
    mode:gl.getUniformLocation(progMain,'uMode')
  };

  // camera texture
  const camTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, camTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function makeTarget(){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, fbo:gl.createFramebuffer(), w:1, h:1 };
  }
  function sizeTarget(t, w, h){
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (floatOK)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // pyramid: level 0 is base (PROC_W), each subsequent level half size.
  // one extra scratch target per level for the upsample chain result.
  const down = [], up = [];
  for (let i = 0; i < LEVELS + 1; i++){ down.push(makeTarget()); up.push(makeTarget()); }
  const holdA = makeTarget(), holdB = makeTarget(), holdMix = makeTarget();  // base-size scratch
  // prefix-sum needs full 32-bit float precision (the integral reaches into the hundreds).
  // two targets to ping-pong the scan passes. requires EXT_color_buffer_float (floatOK).
  const scanA = makeTarget(), scanB = makeTarget();
  function sizeScan(w, h){
    for (const s of [scanA, scanB]){
      s.w = w; s.h = h;
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      // nearest filtering: prefix sum must read exact texels, not blended ones
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      if (floatOK)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      else
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  let baseW = PROC_W, baseH = PROC_W;

  function sizePyramid(){
    for (let i = 0; i <= LEVELS; i++){
      const w = Math.max(1, baseW >> i), h = Math.max(1, baseH >> i);
      sizeTarget(down[i], w, h);
      sizeTarget(up[i], w, h);
    }
    sizeTarget(holdA, baseW, baseH);
    sizeTarget(holdB, baseW, baseH);
    sizeTarget(holdMix, baseW, baseH);
    sizeScan(baseW, baseH);
  }

  const video = document.createElement('video');
  video.playsInline = true; video.muted = true;
  let camW = 1, camH = 1, ready = false;

  // camera state for switching between devices
  let currentDeviceId = null;   // deviceId of the active camera (null = default)
  let activeStream = null;      // so we can stop tracks before switching

  // resize everything that depends on the camera's dimensions. called on first
  // camera and again on every switch (a new camera may have a different aspect).
  function onCameraReady(){
    camW = video.videoWidth; camH = video.videoHeight;
    // cap the longer dimension to TARGET_W so portrait cameras don't blow up in height
    const scale = TARGET_W / Math.max(camW, camH);
    canvas.width  = Math.round(camW * scale);
    canvas.height = Math.round(camH * scale);
    baseW = PROC_W;
    baseH = Math.max(1, Math.round(PROC_W * camH / camW));
    sizePyramid();
    ready = true; msg.style.display = 'none';
  }

  // start (or restart) the camera. deviceId null = let the browser pick the default.
  // explicit width/height forces a resolution negotiation, which also works around
  // the macbook facetimehd driver's half-frame default.
  function startCamera(deviceId){
    const video_c = { width:{ideal:1280}, height:{ideal:720} };
    if (deviceId) video_c.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ video: video_c })
      .then(stream => {
        activeStream = stream;
        currentDeviceId = stream.getVideoTracks()[0].getSettings().deviceId || deviceId || null;
        video.srcObject = stream;
        return video.play();
      })
      .then(onCameraReady);
  }

  // initial camera request
  if (!window.isSecureContext || !navigator.mediaDevices){
    msg.textContent = 'camera needs https (or localhost)';
  }
  (navigator.mediaDevices ? startCamera(null) : Promise.reject())
    .catch(() => {
      msg.textContent = window.isSecureContext ? 'Camera unavailable. Allow camera access, then try switch camera again.' : 'camera needs https (or localhost)';
    });

  const el = id => document.getElementById(id);
  // Use the exact rainbow tokens from the supplied palette for both swatches and output.
  const palette = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple'];
  const tokens = getComputedStyle(document.documentElement);
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  let colorLow, colorHigh;
  // Piecewise RGB interpolation: black -> exact base color -> white.
  function shadedColor(endpoint){
    const base = rgb(el('color-' + endpoint).value);
    const t = +el('shade-' + endpoint).value / 100;
    return base.map(c => t <= 0.5 ? c * t * 2 : c + (1 - c) * (t - 0.5) * 2);
  }
  function syncColors(){
    colorLow = shadedColor('low'); colorHigh = shadedColor('high');
    const cssColor = color => `rgb(${color.map(c => c * 255).join(', ')})`;
    const low = cssColor(colorLow), high = cssColor(colorHigh);
    el('gradient-preview').style.background = `linear-gradient(to right, ${low}, ${high})`;
    el('gradient-preview').setAttribute('aria-label', `Gradient from ${low} to ${high}`);
    for (const endpoint of ['low', 'high']){
      const base = el('color-' + endpoint).value;
      const slider = el('shade-' + endpoint);
      const shade = +slider.value;
      slider.style.setProperty('--range-track', `linear-gradient(to right, #000 22px, ${base} 50%, #fff calc(100% - 22px))`);
      slider.setAttribute('aria-valuetext', shade === 0 ? 'Black' : shade === 100 ? 'White' : shade === 50 ? 'Original color, 50%' : `${shade}%, ${shade < 50 ? 'darker' : 'lighter'}`);
      el('shade-' + endpoint + '-value').value = `${shade}%`;
      for (const button of el('swatches-' + endpoint).children){
        button.setAttribute('aria-pressed', String(button.dataset.color === base));
      }
    }
  }
  for (const endpoint of ['low', 'high']){
    for (const name of palette){
      const hex = tokens.getPropertyValue('--color-' + name).trim();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = hex;
      button.style.backgroundColor = hex;
      button.title = `${name} (${hex})`;
      button.setAttribute('aria-label', `${name} ${hex}`);
      button.addEventListener('click', () => { el('color-' + endpoint).value = hex; syncColors(); });
      el('swatches-' + endpoint).appendChild(button);
    }
    el('color-' + endpoint).addEventListener('input', syncColors);
    el('shade-' + endpoint).addEventListener('input', syncColors);
  }
  el('swap-colors').addEventListener('click', () => {
    const low = el('color-low').value;
    el('color-low').value = el('color-high').value;
    el('color-high').value = low;
    const shade = el('shade-low').value;
    el('shade-low').value = el('shade-high').value;
    el('shade-high').value = shade;
    syncColors();
  });
  syncColors();
  // FM's prefix sum requires floating-point render targets.
  if (!floatOK){
    el('mode').querySelector('[value="0"]').disabled = true;
  }
  const t0 = performance.now();

  function pass(target){
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(){
    if (ready && video.readyState >= 2){
      // upload camera -> pyramid base (down[0])
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.useProgram(progCopy);
      gl.bindTexture(gl.TEXTURE_2D, camTex);
      gl.uniform1f(uCopyContrast, +el('contrast').value);
      gl.uniform1f(uCopyInvert, el('invert-check').checked ? 1.0 : 0.0);
      pass(down[0]);

      // blur amount: integer levels + fractional blend for smooth slider
      const blur = +el('blur').value;
      const n = Math.min(LEVELS, Math.floor(blur));
      const frac = blur - Math.floor(blur);

      // downsample chain. go one level deeper when we'll blend toward n+1,
      // otherwise down[n+1] holds a stale (frozen) frame.
      const deepest = (frac > 0.001) ? Math.min(LEVELS, n + 1) : n;
      gl.useProgram(progDown);
      for (let i = 1; i <= deepest; i++){
        gl.uniform2f(uDownTexel, 1.0 / down[i-1].w, 1.0 / down[i-1].h);
        gl.bindTexture(gl.TEXTURE_2D, down[i-1].tex);
        pass(down[i]);
      }

      // upsample down-level `level` back to base size, then copy the result into
      // `holdOut` so it's safe from the next upsample overwriting the shared up[] chain.
      function upsampleInto(level, holdOut){
        let srcTarget;
        if (level === 0){
          srcTarget = down[0];
        } else {
          gl.useProgram(progUp);
          let cur = down[level];
          for (let i = level; i >= 1; i--){
            gl.uniform2f(uUpTexel, 1.0 / cur.w, 1.0 / cur.h);
            gl.bindTexture(gl.TEXTURE_2D, cur.tex);
            pass(up[i-1]);
            cur = up[i-1];
          }
          srcTarget = up[0];
        }
        // copy srcTarget -> holdOut (mix with itself at t=0 is a plain copy)
        gl.useProgram(progMix);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTarget.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTarget.tex);
        gl.uniform1i(uMix.a, 0); gl.uniform1i(uMix.b, 1); gl.uniform1f(uMix.t, 0.0);
        pass(holdOut);
        gl.activeTexture(gl.TEXTURE0);
      }

      let result;
      if (n === 0 && frac < 0.001){
        result = down[0];                    // no blur
      } else if (frac < 0.001){
        upsampleInto(n, holdA);              // exact integer level
        result = holdA;
      } else {
        // blend level n and n+1 for smooth slider motion, each safely stashed first
        upsampleInto(n, holdA);
        upsampleInto(Math.min(LEVELS, n + 1), holdB);
        gl.useProgram(progMix);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, holdA.tex);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, holdB.tex);
        gl.uniform1i(uMix.a, 0); gl.uniform1i(uMix.b, 1); gl.uniform1f(uMix.t, frac);
        pass(holdMix);
        gl.activeTexture(gl.TEXTURE0);
        result = holdMix;
      }

      // choose the source the oscillator reads, based on mode
      const mode = +el('mode').value;
      let modSrc = result;   // PM: blurred source directly

      if (mode === 0){
        // ensure exact-texel (NEAREST) sampling during the scan passes
        for (const s of [scanA, scanB]){
          gl.bindTexture(gl.TEXTURE_2D, s.tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        // FM: luma(result) -> scanA, then Hillis-Steele prefix sum along x
        gl.activeTexture(gl.TEXTURE0);
        gl.useProgram(progLuma);
        gl.uniform1i(uLumaSrc, 0);
        gl.bindTexture(gl.TEXTURE_2D, result.tex);
        pass(scanA);

        gl.useProgram(progScan);
        gl.uniform1i(uScanSrc, 0);
        let read = scanA, write = scanB;
        const passes = Math.ceil(Math.log2(Math.max(2, baseW)));
        for (let i = 0; i < passes; i++){
          gl.uniform1i(uScanOffset, 1 << i);
          gl.bindTexture(gl.TEXTURE_2D, read.tex);
          pass(write);
          const tmp = read; read = write; write = tmp;
        }
        modSrc = read;   // final prefix-sum texture
      }

      // oscillator: read the chosen source -> canvas
      gl.useProgram(progMain);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uMainSrc, 0);
      gl.bindTexture(gl.TEXTURE_2D, modSrc.tex);
      gl.uniform3fv(M.colorLow, colorLow);
      gl.uniform3fv(M.colorHigh, colorHigh);
      gl.uniform1i(M.mode, mode);
      gl.uniform1f(M.freq, +el('freq').value);
      gl.uniform1f(M.depth, +el('depth').value);
      const elapsed = (performance.now() - t0) / 1000.0;
      const scrolled = (+el('phase').value) + (+el('scroll').value) * elapsed;
      gl.uniform1f(M.phase, scrolled - Math.floor(scrolled));  // static offset + scroll, wrapped 0..1
      gl.uniform1f(M.duty, +el('duty').value);
      gl.uniform1f(M.width, +el('width').value);
      gl.uniform1i(M.wave, +el('wave').value);
      pass(null);

      // PiP: grayscale preview of the modulation source (blur + contrast applied)
      if (el('pip-check').checked){
        const pipW = Math.round(canvas.width / 4);
        const pipH = Math.round(pipW * camH / camW);
        // WebGL origin is bottom-left, so "top-left" visually = y offset of canvas.height - pipH
        gl.viewport(0, canvas.height - pipH, pipW, pipH);
        gl.useProgram(progGray);
        gl.uniform1i(uGraySrc, 0);
        gl.bindTexture(gl.TEXTURE_2D, result.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // keep each range paired with its number field (two-way)
  ['freq','depth','phase','scroll','duty','width','blur','contrast'].forEach(id => {
    const r = el(id), n = el(id + '-n');
    r.addEventListener('input', () => { n.value = r.value; });
    n.addEventListener('input', () => { r.value = n.value; });
  });

  // show duty for square, width for pulse
  function syncRows(){
    const wv = el('wave').value;
    el('dutyRow').style.display = wv === '2' ? '' : 'none';
    el('widthRow').style.display = wv === '3' ? '' : 'none';
  }
  el('wave').addEventListener('change', syncRows);
  syncRows();

  // switch camera: enumerate first (so a just-plugged-in device is included),
  // then advance to the next videoinput, stop the old stream, start the new one.
  el('cam-switch').addEventListener('click', () => {
    if (!navigator.mediaDevices) return;
    el('cam-switch').disabled = true;
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (!ready) return startCamera(null);
      if (cams.length < 2) return;   // nothing to switch to

      // find where we are now, advance to the next (wrapping)
      let idx = cams.findIndex(d => d.deviceId === currentDeviceId);
      const next = cams[(idx + 1) % cams.length];

      // stop the old stream so the device releases before we reopen
      ready = false;
      if (activeStream) activeStream.getTracks().forEach(t => t.stop());
      return startCamera(next.deviceId);
    }).catch(() => {
      msg.style.display = '';
      msg.textContent = 'Camera unavailable. Allow camera access, then try switch camera again.';
    }).finally(() => { el('cam-switch').disabled = false; });
  });

  // preset menu: populate from PRESETS array and apply on selection
  const presetSel = el('preset');
  PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    opt.disabled = !floatOK && p.mode === 0;
    presetSel.appendChild(opt);
  });

  function applyPreset(p){
    ['freq','depth','phase','scroll','blur','contrast'].forEach(id => {
      if (p[id] !== undefined){
        el(id).value = p[id];
        el(id + '-n').value = p[id];
      }
    });
    if (p.mode !== undefined) el('mode').value = (!floatOK && p.mode === 0) ? 1 : p.mode;
    if (p.wave  !== undefined){ el('wave').value  = p.wave;  syncRows(); }
    if (p.duty  !== undefined){ el('duty').value  = p.duty;  el('duty-n').value  = p.duty;  }
    if (p.width !== undefined){ el('width').value = p.width; el('width-n').value = p.width; }
    el('preset-apply').disabled = true;
  }

  // re-enable the reset button whenever any control is touched after a preset is applied
  el('panel').addEventListener('input', () => { el('preset-apply').disabled = false; });
  el('panel').addEventListener('change', e => { if (e.target !== presetSel) el('preset-apply').disabled = false; });

  presetSel.addEventListener('change', () => {
    const p = PRESETS[+presetSel.value];
    if (p && p.mode !== undefined) applyPreset(p);  // skip the placeholder (no mode key)
  });

  el('preset-apply').addEventListener('click', () => {
    const p = PRESETS[+presetSel.value];
    if (p && p.mode !== undefined) applyPreset(p);
  });

  // collapse toggle
  const gui = el('gui'), toggle = el('toggle');
  toggle.addEventListener('click', () => {
    const hidden = gui.classList.toggle('collapsed');
    el('app').classList.toggle('controls-collapsed', hidden);
    toggle.textContent = hidden ? 'show controls' : 'hide controls';
    toggle.setAttribute('aria-expanded', String(!hidden));
  });

  // save canvas as png (shared by the panel button and the corner capture button)
  function saveImage(){
    if (!ready) return;
    canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'video-oscillations.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
  el('shot').addEventListener('click', saveImage);
  el('capture').addEventListener('click', saveImage);
})();
