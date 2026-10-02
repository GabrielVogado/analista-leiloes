// Configuração lida de variáveis de ambiente. Nenhuma chave é gravada em arquivo.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lista(valor, padrao) {
  return String(valor || padrao).split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  porta: Number(process.env.PORT || 8765),
  dirAnalises: path.join(process.env.ANALISTA_DADOS || path.join(RAIZ, "dados"), "analises"),
  // "msedge" e "chrome" usam o navegador já instalado; vazio usa o Chromium do Playwright.
  navegadorCanal: process.env.NAVEGADOR_CANAL ?? "msedge",
  navegadorTimeoutMs: Number(process.env.NAVEGADOR_TIMEOUT_MS || 45000),
  // IA gratuita: Gemini (plano grátis do Google AI Studio).
  geminiChave: () => process.env.GEMINI_API_KEY || "",
  // Modelos em ordem de preferência (separados por vírgula). Se um estiver sobrecarregado (503) ou não
  // existir para a chave (404), a chamada passa para o próximo. O 2.5 não aceita mais chaves novas.
  geminiModelos: lista(process.env.GEMINI_MODELO, "gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite"),
  geminiModelosBusca: lista(process.env.GEMINI_MODELO_BUSCA, "gemini-3.8-flash,gemini-3.5-flash"),
  // Espera entre tentativas quando o modelo responde 503 (alta demanda).
  geminiEsperaMs: Number(process.env.GEMINI_ESPERA_MS ?? 4000),
};

export function iaDisponivel() {
  return Boolean(config.geminiChave());
}

const FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/** Data e hora de Brasília no formato DD/MM/AAAA HH:MM. */
export function dataHoraBrasilia(d = new Date()) {
  return FMT.format(d).replace(",", "");
}

/** Data de hoje em Brasília como objeto Date à meia-noite UTC (para contas de dias). */
export function hojeBrasilia(d = new Date()) {
  const [dia, mes, ano] = FMT.format(d).slice(0, 10).split("/").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

export function brl(v, casas = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return (v < 0 ? "−R$ " : "R$ ") + s;
}

export function pct(v, casas = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(casas).replace(".", ",").replace("-", "−") + "%";
}
