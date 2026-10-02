// Coleta de imóveis da CAIXA (venda-imoveis.caixa.gov.br).
//
// Aceita o número do imóvel (13 dígitos), o link da CAIXA ou um link de portal
// que contenha o número (ex.: leilaoimovel.com.br/...-8555526095620-...).
import { dataHoraBrasilia } from "../config.js";

export const BASE = "https://venda-imoveis.caixa.gov.br";
export const urlDetalhe = (id) => `${BASE}/sistema/detalhe-imovel.asp?hdnOrigem=index&hdnimovel=${id}`;
export const URL_REGRAS_VOL = `${BASE}/editais/regras-VOL/comocomprar.pdf?v=01`;
export const FONTE_PAGINA = "Página do imóvel na CAIXA";

const UF = {
  "DISTRITO FEDERAL": "DF", "GOIAS": "GO", "GOIÁS": "GO", "SAO PAULO": "SP", "SÃO PAULO": "SP", "MINAS GERAIS": "MG",
  "RIO DE JANEIRO": "RJ", "BAHIA": "BA", "PARANA": "PR", "PARANÁ": "PR", "RIO GRANDE DO SUL": "RS",
  "SANTA CATARINA": "SC", "PERNAMBUCO": "PE", "CEARA": "CE", "CEARÁ": "CE", "PARA": "PA", "PARÁ": "PA",
  "MARANHAO": "MA", "MARANHÃO": "MA", "ESPIRITO SANTO": "ES", "ESPÍRITO SANTO": "ES", "MATO GROSSO": "MT",
  "MATO GROSSO DO SUL": "MS", "PARAIBA": "PB", "PARAÍBA": "PB", "RIO GRANDE DO NORTE": "RN", "ALAGOAS": "AL",
  "SERGIPE": "SE", "PIAUI": "PI", "PIAUÍ": "PI", "TOCANTINS": "TO", "RONDONIA": "RO", "RONDÔNIA": "RO",
  "ACRE": "AC", "AMAZONAS": "AM", "RORAIMA": "RR", "AMAPA": "AP", "AMAPÁ": "AP",
};

const MODALIDADES = ["Venda Direta Online", "Venda Online", "Licitação Aberta", "Leilão SFI - Edital Único",
  "2º Leilão SFI", "1º Leilão SFI", "Venda Direta"];

/** Número do imóvel CAIXA a partir de link ou texto. Aceita 13 dígitos ou o formato 12-1. */
export function extrairIdCaixa(entrada) {
  const e = String(entrada || "").trim();
  let m = e.match(/hdnimovel=(\d{13})/i);
  if (m) return m[1];
  m = e.match(/(?<!\d)(\d{12})-(\d)(?!\d)/);
  if (m) return m[1] + m[2];
  const todos = [...e.matchAll(/(?<!\d)(\d{13})(?!\d)/g)];
  return todos.length ? todos[todos.length - 1][1] : null;
}

function moeda(txt) {
  const m = String(txt || "").match(/R\$\s*([\d.]+,\d{2})/);
  return m ? Number(m[1].replaceAll(".", "").replace(",", ".")) : null;
}

function numero(txt) {
  const m = String(txt || "").match(/([\d.]+,\d+|\d+)/);
  return m ? Number(m[1].replaceAll(".", "").replace(",", ".")) : null;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Extrai os campos da página de detalhe. Função pura, sem rede, para ser testável. */
export function interpretarTexto(id, texto, links = [], url = "") {
  const t = String(texto).replaceAll("\u00a0", " ").replaceAll("\r", "");
  const im = {
    id, url: url || urlDetalhe(id), dados: {}, avaliacao: null, precoMinimo: null, desconto: null, tipo: "",
    cidade: "", uf: "", endereco: "", areaPrivativa: null, areaTotal: null, areaTerreno: null, modalidade: "",
    emDisputa: false, aceitaFinanciamento: null, aceitaFgts: null, aceitaParcelamento: null,
    regraCondominio: "", regraTributos: "", observacoes: [], linksDocumentos: {}, texto: t,
  };

  const guardar = (campo, valor, trecho = "") => {
    im.dados[campo] = valor === null || valor === undefined || valor === ""
      ? { campo, valor: "—", etiqueta: "NÃO ENCONTRADO", fonte: FONTE_PAGINA, trecho: "" }
      : { campo, valor: String(valor), etiqueta: "CONFIRMADO", fonte: FONTE_PAGINA,
          trecho: String(trecho || valor).trim().slice(0, 240) };
  };
  const linha = (rotulo) => {
    const m = t.match(new RegExp(`${rotulo}\\s*:[ \\t]*([^\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };

  let l = linha("Valor de avalia[çc][ãa]o");
  im.avaliacao = moeda(l);
  guardar("Valor de avaliação", l, `Valor de avaliação: ${l}`);
  l = linha("Valor m[íi]nimo de venda");
  im.precoMinimo = moeda(l);
  if (l) {
    const md = l.match(/desconto de\s*([\d,]+)\s*%/);
    im.desconto = md ? Number(md[1].replace(",", ".")) / 100 : null;
  }
  guardar("Preço mínimo de venda", l, `Valor mínimo de venda: ${l}`);

  im.tipo = linha("Tipo de im[óo]vel") || "";
  guardar("Tipo", im.tipo);
  for (const [rotulo, campo] of [["Quartos", "Quartos"], ["Garagem", "Vagas"], ["Matr[íi]cula\\(s\\)", "Matrícula"],
    ["Comarca", "Comarca"], ["Of[íi]cio", "Ofício"], ["Inscri[çc][ãa]o imobili[áa]ria", "Inscrição imobiliária"],
    ["Averba[çc][ãa]o dos leil[õo]es negativos", "Averbação dos leilões negativos"]]) {
    guardar(campo, linha(rotulo));
  }
  const insc = im.dados["Inscrição imobiliária"];
  if (insc.etiqueta === "CONFIRMADO" && insc.valor.replace(/[0 ]/g, "") === "") {
    im.dados["Inscrição imobiliária"] = { campo: insc.campo, valor: "—", etiqueta: "NÃO ENCONTRADO", fonte: FONTE_PAGINA,
      trecho: `Página informa '${insc.valor}'` };
  }

  for (const [rotulo, attr, campo] of [["[ÁA]rea privativa", "areaPrivativa", "Área privativa"],
    ["[ÁA]rea total", "areaTotal", "Área total"], ["[ÁA]rea do terreno", "areaTerreno", "Área do terreno"]]) {
    const m = t.match(new RegExp(`${rotulo}\\s*=?\\s*([\\d.,]+)\\s*m`, "i"));
    im[attr] = m ? numero(m[1]) : null;
    guardar(campo, m ? `${m[1]} m²` : null, m ? m[0] : "");
  }

  let m = t.match(/Endere[çc]o:\s*\n?\s*([^\n]+)/);
  im.endereco = m ? m[1].trim() : "";
  guardar("Endereço", im.endereco);
  const mu = im.endereco.match(/,\s*([^,-]+?)\s*-\s*([^,-]+?)\s*$/);
  if (mu) {
    im.cidade = mu[1].trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const estado = mu[2].trim().toUpperCase();
    im.uf = UF[estado] || estado.slice(0, 2);
  }

  for (const mod of MODALIDADES) {
    if (new RegExp(`(^|\\n)\\s*${escapar(mod)}\\s*(\\n|$)`).test(t)) { im.modalidade = mod; break; }
  }
  guardar("Modalidade", im.modalidade);
  im.emDisputa = t.includes("Imóvel em disputa");
  guardar("Situação da disputa", im.emDisputa ? "Em disputa (há proposta registrada)" : null, "Imóvel em disputa");

  m = t.match(/FORMAS DE PAGAMENTO ACEITAS:([\s\S]*?)(REGRAS PARA PAGAMENTO|$)/i);
  const pag = m ? m[1].trim() : "";
  if (pag) {
    im.aceitaFinanciamento = /Permite financiamento/i.test(pag);
    im.aceitaFgts = /Permite utiliza[çc][ãa]o do FGTS/i.test(pag);
    im.aceitaParcelamento = /Permite parcelamento/i.test(pag);
    const itens = pag.split("\n").map((x) => x.replace(/^[\s•.]+|[\s•.]+$/g, "")).filter(Boolean);
    guardar("Formas de pagamento", itens.join(" · "), pag);
  } else {
    guardar("Formas de pagamento", null);
  }

  m = t.match(/Condom[íi]nio:\s*([^\n]+)/);
  im.regraCondominio = m ? m[1].trim() : "";
  guardar("Regra de condomínio", im.regraCondominio);
  m = t.match(/Tributos:\s*([^\n]+)/);
  im.regraTributos = m ? m[1].trim() : "";
  guardar("Regra de tributos", im.regraTributos);

  m = t.match(/Tributos:[^\n]*\n([\s\S]*?)(Regras da Venda|Fazer uma proposta|Galeria de fotos|$)/);
  for (const bruto of (m ? m[1] : "").split("\n")) {
    const item = bruto.replace(/^[\s•]+|[\s•]+$/g, "");
    if (item.length > 8 && !item.includes("Corretores")) im.observacoes.push(item);
  }

  for (const [href, rotulo] of links) {
    const md = String(href).match(/ExibeDoc\('([^']+)'\)/);
    if (md) {
      const nome = md[1].toLowerCase().includes("matricula") ? "matrícula"
        : (String(rotulo || "").toLowerCase().includes("edital") ? "edital" : "documento");
      im.linksDocumentos[nome] = BASE + md[1];
    }
    if (String(href).includes("regrasVendaOnline")) im.linksDocumentos["regras da venda online"] = URL_REGRAS_VOL;
  }
  return im;
}

/**
 * Abre a página do imóvel e tenta baixar os documentos que ela oferece.
 * `pular`: nomes de documentos que o usuário já enviou.
 * Retorna { imovel|null, fontes: [], documentos: {nome: Buffer} }.
 */
export async function coletar(nav, id, pular = new Set()) {
  const url = urlDetalhe(id);
  const fontes = [];
  const pag = await nav.abrir(url);
  if (pag.erro || pag.bloqueada || !pag.texto.includes("Valor de avalia")) {
    const motivo = pag.erro || (pag.bloqueada ? "bloqueio antibot/CAPTCHA (Radware); não houve tentativa de burlar"
      : "página sem dados do imóvel (lote encerrado ou número inválido)");
    fontes.push({ nome: FONTE_PAGINA, url, nivel: 4, status: pag.bloqueada ? "bloqueada" : "erro",
      dataHora: dataHoraBrasilia(), observacao: motivo });
    return { imovel: null, fontes, documentos: {} };
  }
  const imovel = interpretarTexto(id, pag.texto, pag.links, url);
  fontes.push({ nome: FONTE_PAGINA, url, nivel: 4, status: "lida", dataHora: dataHoraBrasilia(), observacao: "" });
  const documentos = {};
  for (const [nome, link] of Object.entries(imovel.linksDocumentos)) {
    if (pular.has(nome)) continue;
    const d = await nav.baixarPelaPagina(link);
    const nivel = nome === "matrícula" ? 2 : 1;
    if (d.conteudo) {
      documentos[nome] = d.conteudo;
      fontes.push({ nome: `PDF: ${nome} (CAIXA)`, url: link, nivel, status: "lida", dataHora: dataHoraBrasilia(), observacao: "" });
    } else {
      fontes.push({ nome: `PDF: ${nome} (CAIXA)`, url: link, nivel, status: d.bloqueado ? "bloqueada" : "erro",
        dataHora: dataHoraBrasilia(), observacao: `${d.erro}. Envie o PDF pelo formulário.` });
    }
  }
  return { imovel, fontes, documentos };
}
