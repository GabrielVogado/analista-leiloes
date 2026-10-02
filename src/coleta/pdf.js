// Leitura de PDFs (edital, matrícula, laudo).
//
// Matrículas costumam ser imagens escaneadas: o texto extraível traz só o selo
// e a certificação. Nesses casos o PDF segue inteiro para a IA, que lê as
// páginas como imagem. Sem IA, a matrícula fica como não lida.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MIN_CHARS_PAGINA_TEXTO = 700;

export const ehPdf = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 4).toString("latin1") === "%PDF";

/** Retorna { texto, paginas, escaneado, erro }. */
export async function extrair(conteudo) {
  try {
    const doc = await getDocument({ data: new Uint8Array(conteudo), useSystemFonts: true, verbosity: 0 }).promise;
    const textos = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i);
      const tc = await pagina.getTextContent();
      textos.push(tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
    }
    await doc.destroy();
    const comTexto = textos.filter((t) => t.trim().length >= MIN_CHARS_PAGINA_TEXTO).length;
    return { texto: textos.join("\n"), paginas: textos.length, escaneado: comTexto < Math.max(1, textos.length / 2), erro: "" };
  } catch (e) {
    return { texto: "", paginas: 0, escaneado: true, erro: `PDF ilegível: ${e.message || e}`.slice(0, 200) };
  }
}

/** Data de emissão e validade de uma certidão de matrícula, quando legíveis no texto. */
export function emissaoCertidao(texto) {
  const mv = texto.match(/prazo\s+de\s+validade\s+de\s*(\d+)\s*dias/i);
  const validadeDias = mv ? Number(mv[1]) : null;
  const padroes = [/Feita\s+em:\s*(\d{2})\/(\d{2})\/(\d{4})/, /DOU\s+F[ÉE][\s\S]{0,60}?(\d{2})\/(\d{2})\/(\d{4})/,
    /[Ee]mitida\s+em:?\s*(\d{2})\/(\d{2})\/(\d{4})/];
  for (const p of padroes) {
    const m = texto.match(p);
    if (!m) continue;
    const [d, mes, a] = m.slice(1, 4).map(Number);
    const data = new Date(Date.UTC(a, mes - 1, d));
    if (data.getUTCMonth() === mes - 1) return { data, validadeDias, trecho: m[0].slice(0, 160) };
  }
  return { data: null, validadeDias, trecho: "" };
}
