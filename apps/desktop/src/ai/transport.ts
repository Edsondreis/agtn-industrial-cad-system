/**
 * Ponte com o lado nativo (src-tauri/src/ai.rs). O WebView nunca vê a chave nem fala com a internet (CSP
 * `connect-src` só IPC): o pedido vai por IPC ao Rust, que lê a chave do Gerenciador de Credenciais do Windows.
 */
import type { GeminiTransport } from "@agtn/ai";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../platform/platform";

export const nativeAvailable = (): boolean => isTauri();

/** Chamada ao Gemini pelo Rust. Cancelar devolve na hora (a resposta que chegar depois é descartada). */
export const geminiTransport: GeminiTransport = (model, body, signal) => {
  if (!isTauri()) return Promise.resolve({ status: -2, body: '{"error":{"message":"IA disponível só no aplicativo instalado"}}' });
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("cancelado", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    invoke<{ status: number; body: string }>("ai_gemini_generate", { model, body })
      .then((r) => resolve(r))
      .catch((e) => reject(e instanceof Error ? e : new Error(String(e))))
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/** Há chave guardada? (null = fora do app instalado). Nunca devolve a chave. */
export async function keyStatus(): Promise<boolean | null> {
  if (!isTauri()) return null;
  return invoke<boolean>("ai_key_status");
}
export async function keySet(key: string): Promise<void> {
  if (!isTauri()) throw new Error("Disponível só no aplicativo instalado.");
  await invoke("ai_key_set", { key });
}
export async function keyClear(): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_key_clear");
}
