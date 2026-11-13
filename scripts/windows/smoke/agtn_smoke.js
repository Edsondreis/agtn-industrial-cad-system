/*
 * AGTN Industrial CAD — TESTE DE FUMAÇA DENTRO DO APP (FASE 4 · ETAPA 4, homologação WebView2).
 *
 * Este arquivo é injetado na página do app INSTALADO pelo protocolo de depuração (CDP no WebView2, WebDriver no
 * Linux). Não faz parte do app e não muda nada no produto: usa só o que o app já expõe — a interface, o gancho de
 * teste `window.__agtn3d` (ligado por localStorage "agtn.e2e" = "1") e os comandos Tauri que o próprio app chama.
 *
 * Uso (o chamador espera a Promise):   window.__agtnSmoke({ arquivo, ref, pastaSaida, comTauri })
 *   arquivo    nome do .agtncad aberto na inicialização (chave em referencias.json)
 *   ref        objeto referencias.json[arquivo]
 *   pastaSaida pasta (com espaço e acento) para gravar DXF/DWG/agtncad; só com Tauri
 * Devolve { testes: [{ id, nome, ok, detalhe, ms }], ... } — nunca lança.
 */
(function () {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

  // SHA-256 em JS puro (não depende de crypto.subtle / contexto seguro)
  function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = bytes.length;
    const n = (((l + 9 + 63) >> 6) << 6);
    const m = new Uint8Array(n);
    m.set(bytes);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, (l * 8) >>> 0);
    dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const w = new Uint32Array(64);
    const rot = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
  }

  async function waitFor(fn, ms, step = 100) {
    const t0 = performance.now();
    for (;;) {
      let v;
      try { v = fn(); } catch (e) { v = undefined; }
      if (v) return v;
      if (performance.now() - t0 > ms) return null;
      await sleep(step);
    }
  }

  window.__agtnSmoke = async function (cfg) {
    const out = { arquivo: cfg.arquivo, origem: location.origin, userAgent: navigator.userAgent, inicio: new Date().toISOString(), testes: [], medidas: {} };
    const T = (id, nome, ok, detalhe, ms) => out.testes.push({ id, nome, ok: !!ok, detalhe: detalhe == null ? "" : String(detalhe), ms: ms == null ? null : Math.round(ms) });
    const ref = cfg.ref || { corpos: {} };
    const inv = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    try {
      // S1 — o app abriu: página carregada, interface 2D montada
      const nav = performance.getEntriesByType("navigation")[0];
      out.medidas.domPronto_ms = nav ? Math.round(nav.domContentLoadedEventEnd) : null;
      out.medidas.carregado_ms = nav ? Math.round(nav.loadEventEnd) : null;
      const has2d = await waitFor(() => document.querySelector("canvas") && [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "3D"), 20000);
      T("S1", "aplicativo abre (interface 2D montada)", has2d, `origem ${location.origin}; Tauri ${inv ? "sim" : "não"}; DOM ${out.medidas.domPronto_ms} ms`);
      if (!has2d) return out;
      // o arquivo da linha de comando precisa estar aberto ANTES de montar o 3D (o título passa a ter o nome dele)
      if (cfg.esperarTitulo) {
        const stem = cfg.arquivo.replace(/\.agtncad$/, "");
        const tOpen = performance.now();
        const opened = await waitFor(() => document.title.includes(stem), 30000);
        out.medidas.aberturaArquivo_ms = Math.round(performance.now() - tOpen);
        T("S1b", "arquivo aberto pela linha de comando (caminho com espaço e acento)", opened, `título "${document.title}"`);
        if (!opened) return out;
      }
      // desenho 2D (v3.1.1): a linha de comando do app informa quantos objetos o projeto abriu
      if (cfg.objetos2D != null) {
        const re = /Projeto aberto: (\d+) objeto/;
        const m = await waitFor(() => document.body.innerText.match(re), 20000);
        const n = m ? Number(m[1]) : null;
        T("S2D", "desenho 2D da v3.1.1 aberto com todos os objetos", n === cfg.objetos2D, `${n} objeto(s) (ref ${cfg.objetos2D})`);
        if (cfg.somente2D) { out.fim = new Date().toISOString(); return out; }
      }

      // S2/S3 — motor WASM + OCCT: entrar no 3D e esperar o motor (worker + WebAssembly + OCCT)
      out.medidas.webassembly = typeof WebAssembly === "object";
      out.medidas.worker = typeof Worker === "function";
      localStorage.setItem("agtn.e2e", "1"); // liga o gancho de teste antes do 3D montar
      // escuta o worker do motor (criado ao entrar no 3D) para guardar o erro DETALHADO, que a tela resume
      const workerErros = [];
      if (!window.__agtnWorkerSpy && typeof Worker === "function") {
        const W0 = window.Worker;
        const Spy = function (u, o) {
          const w = new W0(u, o);
          w.addEventListener("message", (e) => { const d = e.data; if (d && d.ok === false) workerErros.push({ erro: d.error, detalhes: d.details || [] }); });
          w.addEventListener("error", (e) => workerErros.push({ erro: `erro no worker: ${e.message}` }));
          return w;
        };
        Spy.prototype = W0.prototype;
        window.Worker = Spy;
        window.__agtnWorkerSpy = workerErros;
      }
      const t3d = performance.now();
      has2d.click();
      const dot = await waitFor(() => { const d = document.querySelector(".st3-dot"); return d && (d.classList.contains("ready") || d.classList.contains("error")) ? d : null; }, 90000);
      const tEng = performance.now() - t3d;
      const stTxt = (document.querySelector(".st3-dot") && document.querySelector(".st3-dot").parentElement && document.querySelector(".st3-dot").parentElement.textContent) || "";
      const pronto = dot && dot.classList.contains("ready");
      const errTela = (document.querySelector(".v3-center.err") || {}).innerText || "";
      if (!pronto) out.medidas.erroMotor = { tela: errTela, worker: window.__agtnWorkerSpy || workerErros };
      T("S2", "motor WebAssembly inicializa no worker", out.medidas.webassembly && out.medidas.worker && pronto,
        dot ? (pronto ? "pronto" : `erro: ${errTela.replace(/\s+/g, " ")} | worker: ${JSON.stringify(window.__agtnWorkerSpy || workerErros).slice(0, 600)}`) : "sem resposta em 90 s", tEng);
      const occt = /OCCT\s*\d/.test(stTxt) ? stTxt.match(/OCCT[^·]*/)[0].trim() : "";
      const msInit = (stTxt.match(/pronto em ([\d.]+) ms/) || [])[1];
      out.medidas.motorPronto_ms = msInit ? Number(msInit) : null;
      T("S3", "OCCT carrega (kernel identificado)", pronto && occt, `${occt || "não identificado"}; init ${msInit ?? "?"} ms; texto: ${stTxt.slice(0, 120)}`);
      if (!pronto) return out;

      // S4 — sólidos regenerados no app com os volumes de referência
      if (!(await waitFor(() => window.__agtn3d, 10000))) { T("S4", "gancho de teste disponível", false, "window.__agtn3d ausente"); return out; }
      const want = Object.entries(ref.corpos || {});
      const tReg = performance.now();
      const bodies = await waitFor(() => {
        const a = window.__agtn3d;
        const m = a.model();
        const bs = Object.values(m.nodes).filter((n) => n.kind === "body");
        if (!bs.length || bs.length < want.length) return null;
        const vs = bs.map((b) => { const g = a.vp.geom(b.id); return g ? [b, g.props.volume] : null; });
        return vs.every(Boolean) ? vs : null;
      }, 120000, 200);
      out.medidas.regeneracao_ms = Math.round(performance.now() - tReg);
      const a = window.__agtn3d;
      if (!bodies) { T("S4", "sólido 3D criado", false, "corpos não regenerados em 120 s"); return out; }
      const vol = {};
      for (const [b, v] of bodies) vol[b.name] = v;
      const bad = want.filter(([n, e]) => !(n in vol) || !near(vol[n], e.volume, 1e-9));
      T("S4", "sólidos 3D regenerados com volume de referência (1e-9)", want.length > 0 && bad.length === 0,
        want.map(([n, e]) => `${n}: ${vol[n]} (ref ${e.volume})`).join("; "), out.medidas.regeneracao_ms);
      const st = a.status();
      const states = Object.values(st).flat().map((s) => s.state);
      const errs = states.filter((s) => s === "error" || s === "dependency_error");
      T("S4b", "todas as operações sem erro", errs.length === 0, `${states.length} operações; erros ${errs.length}`);

      // S5 — booleana: só se o arquivo tiver operação que corta/une (FASE 3: extrusão "cut")
      const feats = Object.values(a.model().nodes).filter((n) => n.kind === "body" && n.source && n.source.features).flatMap((n) => n.source.features);
      const hasBool = feats.some((f) => f.t === "extrude" && (f.op === "cut" || f.op === "join")) || feats.some((f) => f.t === "combine");
      if (hasBool) T("S5", "operação booleana (corte/união) com volume exato", bad.length === 0, feats.map((f) => f.t + (f.op ? `:${f.op}` : "")).join(","));

      // S6/S7 — planificação e exportação (corpos de chapa)
      const sheets = a.sheets();
      for (const [b] of bodies) {
        const e = (ref.corpos || {})[b.name];
        const s = sheets[b.id];
        if (!e || !e.chapa || !s) continue;
        const fp = s.flat;
        const w = fp.box.maxX - fp.box.minX;
        const h = fp.box.maxY - fp.box.minY;
        const okFlat = fp.state === "valida" && near(s.flatArea, e.chapa.flatArea, 1e-9) && near(w, e.chapa.blank[0], 1e-9) && near(h, e.chapa.blank[1], 1e-9) && near(fp.cutLength, e.chapa.corte, 1e-9);
        T("S6", `planificação de ${b.name}`, okFlat, `estado ${fp.state}; área ${s.flatArea} (ref ${e.chapa.flatArea}); blank ${w} × ${h} (ref ${e.chapa.blank.join(" × ")}); corte ${fp.cutLength}`);
        for (const v of ["R2000", "R12"]) {
          const t0 = performance.now();
          const rep = a.flatDxf(fp, v);
          const ms = performance.now() - t0;
          T(`S7-${v}`, `DXF ${v} gerado e conferido no app`, rep && rep.ok, rep ? rep.checks.filter((c) => !c.ok).map((c) => c.name).join(", ") || `${rep.checks.length} conferências OK` : "flatDxf ausente", ms);
        }
        // mesmo texto que o diálogo grava: SHA-256 igual ao do Node = saída idêntica entre plataformas
        for (const v of ["R2000", "R12"]) {
          const r = a.flatDxf(fp, v);
          if (!r || typeof r.text !== "string") { T(`S7-${v}-hash`, `DXF ${v} idêntico ao de referência (SHA-256)`, false, "gancho sem texto (app antigo?)"); continue; }
          const hsh = sha256(r.text);
          T(`S7-${v}-hash`, `DXF ${v} idêntico ao de referência (SHA-256)`, hsh === e.chapa.dxfSha256[v], `${hsh.slice(0, 16)}… (ref ${e.chapa.dxfSha256[v].slice(0, 16)}…)`);
        }
        // gravação real em disco pelo Rust (caminho com espaço e acento), DXF e DWG
        if (inv && cfg.pastaSaida) {
          const sep = cfg.pastaSaida.includes("\\") ? "\\" : "/";
          const base = `${cfg.pastaSaida}${sep}${cfg.arquivo.replace(/\.agtncad$/, "")} peça ção`;
          const rep = a.flatDxf(fp, "R2000");
          if (rep && rep.bytes) {
            // gravação igual à do diálogo: bytes CP1252 por write_file (cabeçalho x-path), relidos por read_file
            try {
              const t0 = performance.now();
              await inv("write_file", rep.bytes, { headers: { "x-path": encodeURIComponent(`${base}.dxf`) } });
              const back = new Uint8Array(await inv("read_file", { path: `${base}.dxf` }));
              const same = back.length === rep.bytes.length && back.every((x, i) => x === rep.bytes[i]);
              T("S7-disco-dxf", "DXF gravado pelo Rust e relido igual (caminho com espaço e acento)", same, `${base}.dxf (${rep.bytes.length} bytes)`, performance.now() - t0);
            } catch (err) { T("S7-disco-dxf", "DXF gravado pelo Rust e relido igual (caminho com espaço e acento)", false, String(err)); }
            try {
              const t0 = performance.now();
              await inv("dwg_write_from_dxf", rep.bytes, { headers: { "x-path": encodeURIComponent(`${base}.dwg`), "x-version": encodeURIComponent("ACAD2018") } });
              const dxfBack = new TextDecoder("latin1").decode(new Uint8Array(await inv("dwg_read_as_dxf", { path: `${base}.dwg` })));
              T("S7-dwg", "DWG gravado pelo conversor nativo e relido (camada CUT_OUTER presente)", /CUT_OUTER/.test(dxfBack), `${base}.dwg → DXF de volta ${dxfBack.length} bytes`, performance.now() - t0);
            } catch (err) { T("S7-dwg", "DWG gravado pelo conversor nativo e relido (camada CUT_OUTER presente)", false, String(err)); }
          }
        }
      }

      // persistência: o documento salvo pelo Rust num caminho com acento reabre idêntico
      if (inv && cfg.pastaSaida && a.serialize) {
        const sep = cfg.pastaSaida.includes("\\") ? "\\" : "/";
        const p = `${cfg.pastaSaida}${sep}${cfg.arquivo.replace(/\.agtncad$/, "")} — cópia ção.agtncad`;
        try {
          const txt = a.serialize();
          await inv("write_text", { path: p, contents: txt });
          const back = new TextDecoder().decode(new Uint8Array(await inv("read_file", { path: p })));
          T("S8-salvar", "projeto .agtncad salvo e relido (caminho com acento)", back === txt, `${p} (${txt.length} bytes)`);
        } catch (err) { T("S8-salvar", "projeto .agtncad salvo e relido (caminho com acento)", false, String(err)); }
      }

      // S9 — violações de segurança vistas pela própria página (CSP)
      const v = window.__agtnCsp || [];
      T("S9", "nenhuma violação de CSP registrada na página", v.length === 0, v.length ? JSON.stringify(v.slice(0, 5)) : "0 violações (ouvinte securitypolicyviolation)");
      out.medidas.memoriaJS_MB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      out.medidas.statusMotor = stTxt.slice(0, 200);
    } catch (err) {
      T("SX", "erro inesperado no teste", false, (err && err.stack) || String(err));
    }
    out.fim = new Date().toISOString();
    return out;
  };
})();
