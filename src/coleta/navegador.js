// Abertura de páginas com Playwright.
//
// Usa um navegador real (Edge ou Chrome instalados, por padrão) e se comporta
// como um usuário comum: abre a página, lê o texto e baixa os documentos que a
// própria página oferece. Se o site responde com CAPTCHA, verificação antibot
// (Radware, Cloudflare) ou 403/429, a coleta para e registra o bloqueio. Não há
// nova tentativa nem técnica para contornar a verificação: o usuário é
// orientado a enviar o PDF ou colar o texto da página.
import { config } from "../config.js";

const MARCAS_BLOQUEIO = [
  "radware bot manager", "radware block page", "captcha.perfdrive.com", "shieldsquare", "hcaptcha", "g-recaptcha",
  "cf-challenge", "access denied", "acesso negado", "executando verificação de segurança", "just a moment",
  "checking your browser", "verify you are human", "ray id:",
];
const STATUS_BLOQUEIO = new Set([401, 403, 429]);

export function pareceBloqueio(htmlOuTexto) {
  const baixo = String(htmlOuTexto).slice(0, 20000).toLowerCase();
  return MARCAS_BLOQUEIO.some((m) => baixo.includes(m));
}

/**
 * Abre um navegador, executa `fn(nav)` e fecha.
 * nav.abrir(url) -> { url, status, html, texto, bloqueada, erro, links: [[hrefEOnclick, texto]] }
 * nav.baixarPelaPagina(url) -> { url, conteudo: Buffer|null, bloqueado, erro }
 */
export async function comNavegador(fn) {
  const { chromium } = await import("playwright");
  const opcoes = { headless: true };
  if (config.navegadorCanal) opcoes.channel = config.navegadorCanal;
  const browser = await chromium.launch(opcoes);
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  let paginaAtual = null;

  const nav = {
    async abrir(url, esperaMs = 2500) {
      const pg = await ctx.newPage();
      paginaAtual = pg;
      try {
        const resp = await pg.goto(url, { waitUntil: "domcontentloaded", timeout: config.navegadorTimeoutMs });
        await pg.waitForTimeout(esperaMs);
        const html = await pg.content();
        const texto = await pg.innerText("body");
        const links = await pg.evaluate(() => Array.from(document.querySelectorAll("a")).map((a) => [
          (a.getAttribute("href") || "") + " " + (a.getAttribute("onclick") || ""), (a.innerText || "").trim()]));
        const status = resp ? resp.status() : null;
        const bloqueada = pareceBloqueio(html) || (STATUS_BLOQUEIO.has(status) && texto.length < 3000);
        return { url: pg.url(), status, html, texto, bloqueada, erro: "", links };
      } catch (e) {
        return { url, status: null, html: "", texto: "", bloqueada: false, erro: String(e.message || e).slice(0, 300), links: [] };
      }
    },

    // Baixa um arquivo com a sessão da página aberta, como o clique do usuário faria.
    async baixarPelaPagina(url) {
      if (!paginaAtual) return { url, conteudo: null, bloqueado: false, erro: "nenhuma página aberta" };
      try {
        const [status, b64] = await paginaAtual.evaluate(async (u) => {
          const r = await fetch(u, { credentials: "include" });
          const a = new Uint8Array(await r.arrayBuffer());
          let s = "";
          for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
          return [r.status, btoa(s)];
        }, url);
        const dados = Buffer.from(b64, "base64");
        if (dados.subarray(0, 4).toString("latin1") === "%PDF") return { url, conteudo: dados, bloqueado: false, erro: "" };
        const bloqueado = pareceBloqueio(dados.subarray(0, 20000).toString("latin1"));
        return { url, conteudo: null, bloqueado,
          erro: "resposta não é PDF" + (bloqueado ? " (bloqueio antibot/CAPTCHA)" : ` (HTTP ${status})`) };
      } catch (e) {
        return { url, conteudo: null, bloqueado: false, erro: String(e.message || e).slice(0, 300) };
      }
    },
  };

  try {
    return await fn(nav);
  } finally {
    await browser.close();
  }
}
