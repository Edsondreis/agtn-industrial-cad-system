/*
 * AGTN Industrial CAD — FASE 5: verificação de STEP/DXF DENTRO DO APP INSTALADO (WebView2).
 *
 * Injetado pelo protocolo de depuração (webview2_step_smoke.ps1). Não faz parte do app: usa a interface e os ganchos
 * de teste `window.__agtnStep` / `window.__agtn2d` (ligados por localStorage "agtn.e2e" = "1").
 *
 *   window.__agtnStepSmoke({ arquivo, ref, timeoutMs })  → { testes: [...], medidas: {...} }   (documento fica aberto)
 *   window.__agtnStepClose()                              → { testes: [...] }                    (fecha e confere)
 *   window.__agtnDxfSmoke({ arquivo, ref })               → { testes: [...] }
 * Nunca lança.
 */
(function () {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
  async function waitFor(fn, ms, step) {
    const t0 = performance.now();
    for (;;) {
      let v;
      try { v = fn(); } catch (e) { v = undefined; }
      if (v) return v;
      if (performance.now() - t0 > ms) return null;
      await sleep(step || 150);
    }
  }
  const mk = (out) => (id, nome, ok, detalhe) => out.testes.push({ id, nome, ok: !!ok, detalhe: detalhe == null ? "" : String(detalhe), ms: null });

  window.__agtnStepSmoke = async function (cfg) {
    const out = { arquivo: cfg.arquivo, testes: [], medidas: {} };
    const T = mk(out);
    const ref = cfg.ref || {};
    try {
      const t0 = performance.now();
      const viewer = await waitFor(() => document.querySelector('[data-testid="step-viewer"]'), 30000);
      T("P1", "STEP da linha de comando abre no visualizador (documento próprio)", viewer, viewer ? "aba STEP" : "visualizador não apareceu");
      if (!viewer) return out;
      const fim = await waitFor(() => window.__agtnStep && (window.__agtnStep.phase === "pronto" || window.__agtnStep.phase === "falha") && window.__agtnStep, cfg.timeoutMs || 300000, 250);
      await sleep(500);
      const s = window.__agtnStep;
      out.medidas.total_ms = Math.round(performance.now() - t0);
      out.medidas.fases_ms = s && s.ms;
      out.medidas.estado = s && s.phase;
      out.medidas.estadoTela = (document.querySelector('[data-testid="step-state"]') || {}).textContent || null;
      if (!fim) {
        T("P2", "leitura termina (estado final)", false, `estado ${s && s.phase} após ${cfg.timeoutMs || 300000} ms`);
        return out;
      }
      if (ref.falha) {
        const msg = s.error || "";
        T("P2", "arquivo inválido: 'Falha na leitura' com mensagem clara", s.phase === "falha" && new RegExp(ref.falha).test(msg), msg);
        T("P3", "app continua respondendo após a falha", !!document.querySelector('[data-testid="step-close"]'), "");
        return out;
      }
      T("P2", "estado 'Arquivo pronto'", s.phase === "pronto" && out.medidas.estadoTela === "Arquivo pronto", `${out.medidas.estadoTela}; ${s.error || ""}`);
      const sum = s.summary || {};
      out.medidas.resumo = sum;
      out.medidas.unidade = s.scan && s.scan.length;
      if (ref.solids != null) T("P3", "quantidade de sólidos = referência", sum.solids === ref.solids, `${sum.solids} (ref ${ref.solids})`);
      if (ref.volume != null) T("P4", "volume (B-rep) = referência independente (erro relativo < 1e-6)", rel(sum.volume, ref.volume) < 1e-6, `${sum.volume} (ref ${ref.volume})`);
      if (ref.area != null) T("P5", "área (B-rep) = referência (< 1e-6)", rel(sum.area, ref.area) < 1e-6, `${sum.area} (ref ${ref.area})`);
      if (ref.bbox) {
        const b = sum.bbox;
        const got = b ? [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] : [];
        T("P6", "caixa delimitadora = referência (± 0,05 mm)", b && ref.bbox.every((v, i) => Math.abs(v - got[i]) < 0.05), got.map((v) => v.toFixed(3)).join(" "));
      }
      const un = s.scan && s.scan.length ? s.scan.length.name : null;
      T("P7", "unidade do arquivo informada", un === (ref.unidade === undefined ? "mm" : ref.unidade), `${un === null ? "desconhecida" : un} (ref ${ref.unidade === undefined ? "mm" : ref.unidade}); tela: ${(document.querySelector('[data-testid="step-file-unit"]') || {}).textContent}`);
      const inv = (s.invalid || []).length;
      T("P8", ref.invalid ? "geometria inválida do motor SINALIZADA na tela" : "nenhum corpo inválido", inv === (ref.invalid || 0) && (!ref.invalid || !!document.querySelector('[data-testid="step-invalid"]')), `${inv} inválido(s)`);
      // navegação
      const vistas = [];
      for (const k of ["frente", "tras", "superior", "inferior", "esquerda", "direita", "iso"]) {
        s.view(k);
        await sleep(450);
        vistas.push(((document.querySelector(".rb-view.on") || {}).textContent || "").trim());
      }
      T("P9", "7 vistas padrão", vistas.every(Boolean), vistas.join(", "));
      const h0 = s.cam().height;
      s.fit();
      await sleep(500);
      s.mode("arame");
      await sleep(300);
      s.mode("sombreado-arestas");
      await sleep(300);
      const tri = (window.__agtnStep && window.__agtnStep.triangles) || 0;
      T("P10", "ajustar, arame/sólido e malha de exibição gerada", tri > 0 || (sum.solids || 0) > 0, `triângulos ${tri}; altura vista ${h0.toFixed(1)} → ${s.cam().height.toFixed(1)}`);
    } catch (e) {
      T("PX", "execução", false, (e && e.message) || String(e));
    }
    return out;
  };

  window.__agtnStepClose = async function () {
    const out = { testes: [] };
    const T = mk(out);
    try {
      const b = document.querySelector('[data-testid="step-close"]');
      if (b) b.click();
      const gone = await waitFor(() => !document.querySelector('[data-testid="step-viewer"]'), 10000);
      await sleep(300);
      T("P11", "fechar o documento: visualizador e aba STEP somem, gancho liberado", gone && !document.querySelector('[data-testid="ws-step"]') && window.__agtnStep === undefined, "");
      const d2 = window.__agtn2d;
      T("P12", "volta ao DESENHO com o desenho intacto (vazio, sem caminho)", !!document.querySelector(".cmdline") && d2 && d2.size() === 0 && d2.file().path === null, d2 ? `${d2.size()} objeto(s)` : "sem gancho 2D");
    } catch (e) {
      T("PX", "fechar", false, (e && e.message) || String(e));
    }
    return out;
  };

  window.__agtnDxfSmoke = async function (cfg) {
    const out = { arquivo: cfg.arquivo, testes: [], medidas: {} };
    const T = mk(out);
    const ref = cfg.ref || {};
    try {
      const re = /(DXF|DWG) aberto: (\d+) objeto\(s\)\. ([^\n]*)/;
      const m = await waitFor(() => document.body.innerText.match(re), 30000);
      out.medidas.mensagem = m && m[0];
      const n = m ? Number(m[2]) : null;
      T("D1", "DXF da linha de comando aberto no desenho", m, m ? m[0].slice(0, 160) : "sem mensagem de abertura");
      if (!m) return out;
      if (ref.objetos != null) T("D2", "objetos = leitor de referência", n === ref.objetos, `${n} (ref ${ref.objetos})`);
      if (ref.unidade) T("D3", "unidade explícita na mensagem", new RegExp(ref.unidade).test(m[3]), m[3]);
      if (ref.naoSuportadas) T("D4", "entidades não suportadas avisadas", new RegExp(ref.naoSuportadas).test(m[3]), m[3]);
      const d2 = window.__agtn2d;
      T("D5", "somente leitura: o desenho não fica ligado ao .dxf (Salvar pede .agtncad)", d2 && d2.file().path === null, d2 ? JSON.stringify(d2.file()) : "sem gancho");
    } catch (e) {
      T("DX", "execução", false, (e && e.message) || String(e));
    }
    return out;
  };
})();
