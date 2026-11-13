/* Fingerprint collector for the research lab.
   1) gathers a broad set of browser/device signals and hashes them (custom_hash),
   2) loads self-hosted CreepJS in a hidden iframe and reads the fingerprint it computes,
   3) POSTs everything to /collect. Every probe is wrapped so one failure never stops the rest. */
(function () {
  "use strict";
  const T = (fn, d) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };

  async function sha256(str) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { // http (non-secure) fallback: cheap non-crypto hash
      let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
      return ("00000000" + h.toString(16)).slice(-8);
    }
  }

  function canvas2d() {
    const c = document.createElement("canvas"); c.width = 280; c.height = 60;
    const ctx = c.getContext("2d");
    ctx.textBaseline = "top"; ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60"; ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069"; ctx.fillText("Fingerprint \u{1F512} 0x9A", 2, 15);
    ctx.fillStyle = "rgba(102,204,0,0.7)"; ctx.fillText("Fingerprint \u{1F512} 0x9A", 4, 17);
    return c.toDataURL();
  }

  function webgl() {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const params = {};
    [gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VERTEX_ATTRIBS, gl.MAX_VARYING_VECTORS,
     gl.MAX_VERTEX_UNIFORM_VECTORS, gl.MAX_FRAGMENT_UNIFORM_VECTORS, gl.ALIASED_LINE_WIDTH_RANGE,
     gl.MAX_VIEWPORT_DIMS].forEach((p, i) => { try { params["p" + i] = String(gl.getParameter(p)); } catch (e) {} });
    return {
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      extensions: (gl.getSupportedExtensions() || []).join(","),
      params
    };
  }

  function audio() {
    return new Promise((resolve) => {
      try {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) return resolve(null);
        const ctx = new Ctx(1, 44100, 44100);
        const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = 10000;
        const comp = ctx.createDynamicsCompressor();
        osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
        ctx.startRendering();
        ctx.oncomplete = (e) => {
          const d = e.renderedBuffer.getChannelData(0);
          let sum = 0; for (let i = 4500; i < 5000; i++) sum += Math.abs(d[i]);
          resolve(sum.toString());
        };
        setTimeout(() => resolve(null), 1500);
      } catch (e) { resolve(null); }
    });
  }

  function fonts() {
    const base = ["monospace", "sans-serif", "serif"];
    const test = ["Arial","Courier New","Georgia","Times New Roman","Verdana","Tahoma","Comic Sans MS",
      "Impact","Trebuchet MS","Segoe UI","Roboto","Helvetica","Calibri","Cambria","Consolas","Menlo",
      "Ubuntu","Noto Sans","DejaVu Sans","Liberation Sans"];
    const span = document.createElement("span");
    span.style.cssText = "position:absolute;left:-9999px;font-size:72px";
    span.textContent = "mmmmmmmmmmlli";
    document.body.appendChild(span);
    const baseW = {}, baseH = {};
    base.forEach(b => { span.style.fontFamily = b; baseW[b] = span.offsetWidth; baseH[b] = span.offsetHeight; });
    const present = test.filter(f => base.some(b => {
      span.style.fontFamily = "'" + f + "'," + b;
      return span.offsetWidth !== baseW[b] || span.offsetHeight !== baseH[b];
    }));
    document.body.removeChild(span);
    return present;
  }

  async function collectSignals() {
    const n = navigator, s = screen;
    const [canvasData, audioData] = [T(canvas2d, null), await audio()];
    return {
      userAgent: n.userAgent, platform: T(() => n.platform), vendor: T(() => n.vendor),
      language: n.language, languages: T(() => (n.languages || []).join(",")),
      hardwareConcurrency: T(() => n.hardwareConcurrency), deviceMemory: T(() => n.deviceMemory),
      maxTouchPoints: T(() => n.maxTouchPoints), cookieEnabled: n.cookieEnabled,
      doNotTrack: T(() => n.doNotTrack), pdfViewer: T(() => n.pdfViewerEnabled),
      uaData: T(() => n.userAgentData ? {brands: n.userAgentData.brands, mobile: n.userAgentData.mobile, platform: n.userAgentData.platform} : null),
      screen: { w: s.width, h: s.height, availW: s.availWidth, availH: s.availHeight,
                colorDepth: s.colorDepth, pixelDepth: s.pixelDepth, dpr: window.devicePixelRatio,
                orientation: T(() => s.orientation && s.orientation.type) },
      timezone: T(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      tzOffset: new Date().getTimezoneOffset(),
      locale: T(() => Intl.DateTimeFormat().resolvedOptions().locale),
      touch: ("ontouchstart" in window) || T(() => n.maxTouchPoints > 0, false),
      plugins: T(() => [...n.plugins].map(p => p.name).join(","), ""),
      storage: { local: T(() => !!window.localStorage), session: T(() => !!window.sessionStorage), idb: T(() => !!window.indexedDB) },
      webdriver: T(() => n.webdriver),
      canvasHash: canvasData ? await sha256(canvasData) : null,
      webgl: T(webgl, null),
      audioHash: audioData ? await sha256(audioData) : null,
      fonts: T(fonts, []),
      math: T(() => [Math.tan(-1e300), Math.sin(1e300), Math.cos(1e300), Math.acosh(1e308)].join(",")),
      gpuTier: T(() => n.gpu ? "webgpu" : null)
    };
  }

  // Load self-hosted CreepJS in a hidden iframe and read the fingerprint it writes to the DOM.
  function readCreep() {
    return new Promise((resolve) => {
      const done = (v) => { try { frame.remove(); } catch (e) {} resolve(v); };
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px";
      frame.src = "/static/creep/index.html";
      document.body.appendChild(frame);
      const deadline = Date.now() + 30000;
      const tick = () => {
        let out = null;
        try {
          const doc = frame.contentDocument, win = frame.contentWindow;
          const txt = (doc && doc.getElementById("fingerprint-data")) ? doc.getElementById("fingerprint-data").textContent : "";
          const hash = (txt.match(/FP ID:\s*([0-9a-f]{32,})/) || [])[1] || "";
          const fuzzy = (txt.match(/Fuzzy:\s*([0-9a-f]{32,})/) || [])[1] || "";
          if (hash || fuzzy) {
            let lies = "", resistance = "";
            try { const F = win.Fingerprint || {};
                  if (F.lies && typeof F.lies.totalLies === "number") lies = String(F.lies.totalLies);
                  if (F.resistance) resistance = JSON.stringify({privacy:F.resistance.privacy, mode:F.resistance.mode, extension:F.resistance.extension}).slice(0,180);
            } catch (e) {}
            out = { hash: hash, fuzzy: fuzzy, lies: (lies ? "lies:" + lies + " " : "") + resistance };
          }
        } catch (e) { return done({ hash: "", note: "cross-origin" }); }
        if (out && (out.hash || out.fuzzy)) return done(out);
        if (Date.now() > deadline) return done({ hash: "", note: "timeout" });
        setTimeout(tick, 800);
      };
      setTimeout(tick, 2000);
    });
  }

  async function run() {
    const [signals, creep] = await Promise.all([collectSignals(), readCreep()]);
    const custom_hash = await sha256(JSON.stringify(signals));
    try {
      await fetch("/collect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_hash, signals, creep })
      });
    } catch (e) { /* research page: swallow network errors */ }
  }

  if (document.readyState === "complete") run();
  else window.addEventListener("load", run);
})();
