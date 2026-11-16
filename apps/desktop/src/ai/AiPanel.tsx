/**
 * Painel lateral AGTN AI ASSISTANT. O CAD continua sendo o protagonista: painel recolhível, à direita, sobre a área de
 * trabalho; nenhuma alteração acontece sem o cartão de prévia + "Confirmar".
 */
import "./ai.css";
import { GEMINI_FREE_LIST_SOURCE, GEMINI_FREE_MODELS, type GeminiFreeModel } from "@agtn/ai";
import type { Entity } from "@agtn/geometry";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../ui/Icons";
import { type AiController, TOOL_LABEL } from "./controller";
import { keyClear, keySet, keyStatus, nativeAvailable } from "./transport";

export function AiPanel({ ai, onClose }: { ai: AiController; onClose: () => void }) {
  useSyncExternalStore(
    (f) => ai.subscribe(f),
    () => ai.version,
  );
  const [text, setText] = useState("");
  const [cfg, setCfg] = useState(() => !ai.prefs.consent);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [ai.version]);

  const submit = () => {
    const t = text;
    setText("");
    void ai.send(t);
  };
  const pv = ai.pending?.preview;
  const ents = (pv?.visual as { entities?: Entity[] } | undefined)?.entities;

  return (
    <aside className="ai-panel" data-testid="ai-panel" aria-label="AGTN AI Assistant">
      <div className="ai-h">
        <span className="ai-logo">IA</span>
        <b>AGTN AI ASSISTANT</b>
        <span className="ai-model" title={`Gemini, nível gratuito — ${ai.prefs.model}`}>
          {ai.prefs.model}
        </span>
        <div className="spacer" />
        <button className="ibtn" title="Nova conversa" onClick={() => ai.newConversation()} data-testid="ai-new">
          <Icon name="plus" />
        </button>
        <button className={`ibtn${cfg ? " on" : ""}`} title="Configuração e privacidade" onClick={() => setCfg((x) => !x)} data-testid="ai-cfg">
          <Icon name="gear" />
        </button>
        <button className="ibtn" title="Recolher o assistente" onClick={onClose} data-testid="ai-close">
          <Icon name="close" />
        </button>
      </div>

      {cfg ? (
        <AiSettings ai={ai} onDone={() => setCfg(false)} />
      ) : (
        <>
          <div className="ai-list" ref={list} data-testid="ai-list">
            {!ai.messages.length && (
              <div className="ai-empty">
                Peça em português, por exemplo:
                {["Crie um perfil U de 200 de alma, abas de 75, espessura 6 e raio 6.", "Crie uma chapa de 500 por 300 milímetros.", "Qual é a área da seleção?", "Qual é o volume dos sólidos?", "Crie um desenho técnico em A4."].map((s) => (
                  <button key={s} className="ai-sug" onClick={() => setText(s)}>
                    {s}
                  </button>
                ))}
                <small>O assistente só altera o desenho depois que você confirmar a prévia. Tudo pode ser desfeito com Ctrl+Z.</small>
              </div>
            )}
            {ai.messages.map((m) =>
              m.kind === "usuario" ? (
                <div key={m.id} className="ai-msg ai-user">
                  {m.text}
                </div>
              ) : m.kind === "ia" ? (
                <div key={m.id} className="ai-msg ai-bot">
                  {m.text}
                </div>
              ) : m.kind === "ferramenta" ? (
                <div key={m.id} className={`ai-tool ai-tool-${m.status}`} title={m.text}>
                  <span className="dot" /> {TOOL_LABEL[m.name] ?? m.name}
                  {m.status === "erro" && <span className="why"> — {m.text}</span>}
                </div>
              ) : m.kind === "aplicado" ? (
                <div key={m.id} className={`ai-applied${m.ok ? " ok" : ""}`} data-testid="ai-applied">
                  {m.ok ? "✓ " : ""}
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="ai-msg ai-err" role="alert" data-testid="ai-error">
                  {m.text}
                  {(m.errKind === "sem_chave" || m.errKind === "consentimento" || m.errKind === "chave_invalida") && (
                    <button className="btn" onClick={() => setCfg(true)}>
                      Abrir configuração
                    </button>
                  )}
                </div>
              ),
            )}
            {pv && (
              <div className={`ai-card${pv.destructive ? " danger" : ""}`} data-testid="ai-preview">
                <div className="ai-card-h">{pv.destructive ? "⚠ Altera o que já existe" : "Prévia — nada foi alterado ainda"}</div>
                <b>{pv.title}</b>
                {ents && ents.length > 0 && <MiniView entities={ents} />}
                <ul>
                  {pv.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
                <div className="ai-card-btns">
                  <button className={`btn ${pv.destructive ? "danger" : "primary"}`} onClick={() => void ai.confirm(true)} disabled={ai.busy} data-testid="ai-confirm">
                    Confirmar
                  </button>
                  <button className="btn" onClick={() => void ai.confirm(false)} disabled={ai.busy} data-testid="ai-reject">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {ai.busy && (
              <div className="ai-busy" role="status" data-testid="ai-busy">
                <span className="spinner" /> Pensando…
                <button className="btn" onClick={() => ai.cancel()} data-testid="ai-cancel">
                  Cancelar
                </button>
              </div>
            )}
          </div>
          <div className="ai-in">
            <textarea
              value={text}
              placeholder={ai.pending ? "Confirme ou cancele a prévia acima…" : "Peça algo ao assistente (Enter envia, Shift+Enter quebra linha)"}
              disabled={ai.busy || !!ai.pending}
              rows={2}
              maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation(); // não deixa a digitação ir para a linha de comando do CAD
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              data-testid="ai-input"
            />
            <button className="btn primary" onClick={submit} disabled={ai.busy || !!ai.pending || !text.trim()} data-testid="ai-send">
              Enviar
            </button>
          </div>
          <div className="ai-foot">
            Hoje: {ai.quota.usage.today}/{ai.prefs.rpd} pedidos · Gemini nível gratuito (sem cobrança) · requer internet
          </div>
        </>
      )}
    </aside>
  );
}

function AiSettings({ ai, onDone }: { ai: AiController; onDone: () => void }) {
  const [has, setHas] = useState<boolean | null | undefined>(undefined);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void keyStatus().then(setHas).catch(() => setHas(null));
  }, []);
  const native = nativeAvailable();
  return (
    <div className="ai-cfg" data-testid="ai-settings">
      <h4>Privacidade (leia antes de usar)</h4>
      <p>
        O assistente usa o <b>Google Gemini no nível gratuito</b>. Pelos termos do Google, o conteúdo enviado no nível gratuito <b>pode ser usado para melhorar produtos do Google e lido por revisores humanos</b>. Não peça nada com informação confidencial.
      </p>
      <p>
        O AGTN envia só o mínimo: seu texto, um resumo do desenho (contagens por tipo, extensão, seleção, camada atual) e os resultados das ferramentas. <b>Nunca</b> envia o arquivo, o nome do arquivo, pastas ou geometrias completas. Precisa de internet; sem ela o CAD funciona normalmente.
      </p>
      <label className="ai-chk">
        <input type="checkbox" checked={ai.prefs.consent} onChange={(e) => ai.setPrefs({ consent: e.target.checked })} data-testid="ai-consent" /> Entendi e concordo em usar o assistente nessas condições
      </label>

      <h4>Chave da API do Gemini</h4>
      <p>
        Crie a chave no Google AI Studio num projeto <b>SEM faturamento</b> (sem cartão): sem faturamento o Google não tem como cobrar — ao acabar a cota ele só recusa, e o AGTN espera a renovação. A chave fica no Gerenciador de Credenciais do Windows, nunca no projeto ou no programa.
      </p>
      {!native ? (
        <p className="ai-warn">Configuração da chave disponível só no aplicativo instalado.</p>
      ) : (
        <>
          <div className="ai-row">
            <span>{has === undefined ? "verificando…" : has ? "Chave guardada ✓" : "Nenhuma chave guardada"}</span>
            {has && (
              <button className="btn" onClick={() => void keyClear().then(() => (setHas(false), setMsg("Chave removida.")))}>
                Remover
              </button>
            )}
          </div>
          <div className="ai-row">
            <input type="password" value={key} placeholder="Colar a chave (AIza…)" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoComplete="off" />
            <button
              className="btn primary"
              disabled={!key.trim()}
              onClick={() =>
                void keySet(key)
                  .then(() => (setKey(""), setHas(true), setMsg("Chave guardada no Gerenciador de Credenciais.")))
                  .catch((e) => setMsg(`Não guardei: ${String((e as Error)?.message ?? e)}`))
              }
            >
              Guardar
            </button>
          </div>
        </>
      )}
      {msg && <p className="ai-note">{msg}</p>}

      <h4>Modelo (só gratuitos)</h4>
      <select value={ai.prefs.model} onChange={(e) => ai.setPrefs({ model: e.target.value as GeminiFreeModel })} data-testid="ai-model">
        {GEMINI_FREE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <p className="ai-note">Lista: {GEMINI_FREE_LIST_SOURCE}. O AGTN nunca troca sozinho para modelo pago.</p>

      <h4>Limites locais (antes de enviar)</h4>
      <div className="ai-row">
        <label>
          por minuto <input type="number" min={1} max={60} value={ai.prefs.rpm} onChange={(e) => ai.setPrefs({ rpm: Number(e.target.value) || 1 })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label>
          por dia <input type="number" min={1} max={5000} value={ai.prefs.rpd} onChange={(e) => ai.setPrefs({ rpd: Number(e.target.value) || 1 })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
      </div>
      <p className="ai-note">A cota diária do Gemini renova à meia-noite do Pacífico. Hoje: {ai.quota.usage.today} pedido(s), {ai.quota.usage.tokens} tokens.</p>
      <button className="btn primary" onClick={onDone} disabled={!ai.prefs.consent} data-testid="ai-cfg-done">
        Voltar à conversa
      </button>
    </div>
  );
}

/** Miniatura da prévia (só exibição; a geometria aplicada é a calculada pelo motor). */
function MiniView({ entities }: { entities: Entity[] }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const paths: string[] = [];
  for (const e of entities.slice(0, 400)) {
    if (e.type === "line") {
      add(e.a.x, e.a.y), add(e.b.x, e.b.y);
      paths.push(`M${e.a.x} ${-e.a.y}L${e.b.x} ${-e.b.y}`);
    } else if (e.type === "circle") {
      add(e.c.x - e.r, e.c.y - e.r), add(e.c.x + e.r, e.c.y + e.r);
      paths.push(`M${e.c.x - e.r} ${-e.c.y}a${e.r} ${e.r} 0 1 0 ${2 * e.r} 0a${e.r} ${e.r} 0 1 0 ${-2 * e.r} 0`);
    } else if (e.type === "arc") {
      const p0 = { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) };
      const p1 = { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) };
      const sweep = (((e.a1 - e.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      add(e.c.x - e.r, e.c.y - e.r), add(e.c.x + e.r, e.c.y + e.r);
      paths.push(`M${p0.x} ${-p0.y}A${e.r} ${e.r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${p1.x} ${-p1.y}`);
    } else if (e.type === "polyline" && e.pts.length) {
      let d = `M${e.pts[0].x} ${-e.pts[0].y}`;
      const n = e.pts.length;
      for (let i = 0; i < (e.closed ? n : n - 1); i++) {
        const a = e.pts[i], b = e.pts[(i + 1) % n], bu = e.bulges[i] ?? 0;
        add(a.x, a.y), add(b.x, b.y);
        if (Math.abs(bu) < 1e-12) d += `L${b.x} ${-b.y}`;
        else {
          const c = Math.hypot(b.x - a.x, b.y - a.y), r = (c * (1 + bu * bu)) / (4 * Math.abs(bu));
          d += `A${r} ${r} 0 ${Math.abs(bu) > 1 ? 1 : 0} ${bu > 0 ? 0 : 1} ${b.x} ${-b.y}`;
        }
      }
      paths.push(e.closed ? d + "Z" : d);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, 1e-6), pad = 0.06 * Math.max(w, h);
  return (
    <svg className="ai-mini" viewBox={`${minX - pad} ${-maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" data-testid="ai-mini">
      <path d={paths.join("")} fill="none" stroke="currentColor" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
