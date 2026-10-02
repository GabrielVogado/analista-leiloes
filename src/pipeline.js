// Orquestra uma análise de ponta a ponta e grava o resultado em dados/analises/<id>/.
//
// Etapas: identificar o lote → abrir as páginas → ler PDFs (enviados ou baixados)
// → diligência determinística → diligência com IA → mercado → modelo financeiro
// → nota, travas e decisão.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as financeiro from "./analise/financeiro.js";
import * as nota from "./analise/nota.js";
import { diligenciar } from "./analise/regras.js";
import * as caixa from "./coleta/caixa.js";
import * as pdf from "./coleta/pdf.js";
import { brl, config, dataHoraBrasilia, hojeBrasilia, iaDisponivel, pct } from "./config.js";

// Fontes institucionais que exigem CAPTCHA: entram como NÃO ENCONTRADO, sem tentativa de burlar.
const FONTES_COM_CAPTCHA = [
  ["CENPROT (protestos)", "https://www.pesquisaprotesto.com.br/", 5],
  ["Justiça Federal (processos)", "https://www.cjf.jus.br/", 3],
];

export const PERFIL_PADRAO = { objetivo: "revenda", capitalDisponivel: 450000, formaPagamento: "à vista",
  margemMinima: 0.20, reformaMaxima: 50000, aceitaOcupado: "sim, se estimado", riscoJuridico: "médio" };

export function novoId() {
  const d = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${d.slice(0, 8)}-${d.slice(8)}-${crypto.randomBytes(3).toString("hex")}`;
}

export const idValido = (id) => /^[A-Za-z0-9-]{1,40}$/.test(id);
export const pasta = (id) => path.join(config.dirAnalises, id);

export function gravarStatus(id, etapa, concluida = false, erro = "") {
  fs.mkdirSync(pasta(id), { recursive: true });
  fs.writeFileSync(path.join(pasta(id), "status.json"),
    JSON.stringify({ etapa, concluida, erro, atualizado: dataHoraBrasilia() }), "utf8");
}

const lerJson = (arquivo) => (fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, "utf8")) : null);
export const lerStatus = (id) => lerJson(path.join(pasta(id), "status.json"));
export const lerResultado = (id) => lerJson(path.join(pasta(id), "resultado.json"));

// Só links http(s) vão para o painel: URLs vindas da web/IA podem trazer javascript: ou data:.
const urlSegura = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

/**
 * entrada: { link, perfil, uploads: {nome: Buffer}, lance, valorMercado: [c, b, o], itbiAliquota, condominioMes,
 *            debitosInformados, reformaInformada, textoPagina, usarIa }
 * opcoes (para testes sem rede): { coletaPronta, hoje, iaDiligencia, iaMercado }
 */
export async function executar(id, entrada, opcoes = {}) {
  try {
    const resultado = await rodar(id, entrada, opcoes);
    fs.mkdirSync(pasta(id), { recursive: true });
    fs.writeFileSync(path.join(pasta(id), "resultado.json"), JSON.stringify(resultado, null, 1), "utf8");
    gravarStatus(id, "Concluída", true);
    return resultado;
  } catch (e) {
    gravarStatus(id, "Falhou", true, String(e.stack || e).slice(0, 2000));
    throw e;
  }
}

async function rodar(id, entrada, { coletaPronta = null, hoje = hojeBrasilia(), iaDiligencia = null, iaMercado = null }) {
  const e = { uploads: {}, textoPagina: "", usarIa: true, ...entrada };
  const p = { ...PERFIL_PADRAO, ...e.perfil };
  const geradoEm = dataHoraBrasilia();
  const limitacoes = [];
  let fontes = [];

  // 1. Identificação e coleta
  gravarStatus(id, "Identificando o lote");
  const idCaixa = caixa.extrairIdCaixa(e.link) || (e.textoPagina ? caixa.extrairIdCaixa(e.textoPagina) : null);
  let coleta = coletaPronta;
  let textoPortal = "";
  if (!coleta && e.textoPagina.trim() && idCaixa) {
    const nome = "Página do imóvel na CAIXA (texto colado pelo usuário)";
    const colado = caixa.interpretarTexto(idCaixa, e.textoPagina);
    for (const d of Object.values(colado.dados)) d.fonte = nome;
    coleta = { imovel: colado, documentos: {}, fontes: [{ nome, url: caixa.urlDetalhe(idCaixa), nivel: 4,
      status: "enviada pelo usuário", dataHora: dataHoraBrasilia(), observacao: "Revalide no site no dia do lance." }] };
  }
  if (!coleta) {
    gravarStatus(id, "Abrindo as páginas do lote no navegador");
    const { comNavegador } = await import("./coleta/navegador.js");
    coleta = await comNavegador(async (nav) => {
      if (!e.link.includes("caixa.gov.br") && /^https?:\/\//.test(e.link)) {
        const pg = await nav.abrir(e.link);
        const lida = pg.texto && !pg.bloqueada && !pg.erro;
        if (lida) textoPortal = pg.texto;
        fontes.push({ nome: "Anúncio no portal (apoio)", url: e.link, nivel: 8,
          status: lida ? "lida" : (pg.bloqueada ? "bloqueada" : "erro"), dataHora: dataHoraBrasilia(),
          observacao: pg.erro || (pg.bloqueada ? "bloqueio antibot/CAPTCHA; não houve tentativa de burlar" : "") });
      }
      if (idCaixa) return caixa.coletar(nav, idCaixa, new Set(Object.keys(e.uploads)));
      limitacoes.push("Não encontrei número de imóvel CAIXA no link. Nesta versão o fluxo completo é o da CAIXA.");
      return { imovel: null, fontes: [], documentos: {} };
    });
  }
  fontes = [...coleta.fontes, ...fontes];
  const im = coleta.imovel;
  for (const f of fontes) if (["bloqueada", "erro"].includes(f.status)) limitacoes.push(`${f.nome}: ${f.observacao}`);

  // 2. Documentos: os enviados pelo usuário têm prioridade sobre os baixados
  gravarStatus(id, "Lendo os PDFs");
  const docs = { ...coleta.documentos };
  for (const [nome, conteudo] of Object.entries(e.uploads)) {
    docs[nome] = conteudo;
    fontes.push({ nome: `PDF: ${nome} (enviado pelo usuário)`, url: "", nivel: nome === "matrícula" ? 2 : 1,
      status: "enviada pelo usuário", dataHora: dataHoraBrasilia(), observacao: "" });
  }
  const textos = {};
  const pastaDocs = path.join(pasta(id), "documentos");
  fs.mkdirSync(pastaDocs, { recursive: true });
  for (const [nome, conteudo] of Object.entries(docs)) {
    textos[nome] = await pdf.extrair(conteudo);
    fs.writeFileSync(path.join(pastaDocs, `${nome.replaceAll(" ", "_")}.pdf`), conteudo);
  }
  const tm = textos["matrícula"];
  if (!docs["matrícula"]) limitacoes.push("Matrícula não disponível: envie o PDF para a leitura dos atos.");
  else if (tm.escaneado) limitacoes.push("A matrícula é um PDF escaneado: os atos só são lidos pela IA (leitura de imagem).");
  if (!docs.edital) {
    limitacoes.push("Edital não enviado nem encontrado na página. Para venda online CAIXA valem as regras gerais da venda online.");
  }

  // 3. Diligência determinística
  gravarStatus(id, "Conferindo regras da matrícula e do lote");
  const dr = diligenciar(im, tm ? tm.texto : "", tm ? tm.escaneado : true, hoje);

  // 4. Diligência com IA
  const usarIa = e.usarIa && (Boolean(iaDiligencia) || iaDisponivel());
  let ia = null;
  if (usarIa && (im || Object.keys(docs).length || textoPortal)) {
    gravarStatus(id, "Lendo os documentos com IA");
    try {
      const fn = iaDiligencia || (await import("./analise/ia.js")).diligenciaDocumental;
      ia = await fn(contextoParaIa(im, dr, textoPortal), Object.entries(docs).map(([nome, dados]) => ({ nome, dados })), p);
    } catch (ex) {
      limitacoes.push(`Leitura por IA falhou: ${String(ex.message || ex).slice(0, 200)}`);
    }
  } else if (!usarIa) {
    limitacoes.push("Sem chave de IA (GEMINI_API_KEY): documentos escaneados e comparáveis não foram lidos por IA.");
  }

  // 5. Consolidação documental
  let onus = dr.onus.filter((o) => o.fonte === caixa.FONTE_PAGINA);
  let matriculaLida = dr.matriculaLida;
  let ocupacao = { situacao: dr.ocupacao, etiqueta: dr.ocupacaoEtiqueta, trecho: dr.ocupacaoTrecho, estrategia: "" };
  const riscos = [...dr.riscos];
  const pendencias = [...dr.pendencias];
  let dadosExtra = [], processos = [], debitos = [], divergencias = [], alertas = [], invalidaria = [], conferencias = [];
  let certidaoEmissao = dr.certidaoEmissao;
  let resumoIa = "";
  if (ia) {
    resumoIa = ia.resumo || "";
    matriculaLida = matriculaLida || Boolean(ia.matriculaLida);
    onus = onus.concat(ia.onus || []);
    const oc = ia.ocupacao || {};
    if (oc.situacao && (oc.situacao !== "desconhecido" || ocupacao.situacao === "desconhecido")) {
      ocupacao = { situacao: oc.situacao, etiqueta: oc.etiqueta || "INFERIDO", trecho: oc.trecho || "", estrategia: "" };
    }
    ocupacao.estrategia = oc.estrategia || "";
    riscos.push(...(ia.riscos || []));
    pendencias.push(...(ia.pendencias || []));
    dadosExtra = ia.dados || [];
    processos = ia.processos || [];
    debitos = ia.debitos || [];
    divergencias = (ia.divergencias || []).filter((d) => ["CONFLITANTE", "CONFIRMADO"].includes(d.etiqueta)).map((d) => d.descricao);
    alertas = ia.alertasFraude || [];
    invalidaria = ia.invalidaria || [];
    conferencias = ia.conferencias || [];
    certidaoEmissao = certidaoEmissao || ia.certidaoEmissao || null;
  } else {
    onus = onus.concat(dr.onus.filter((o) => o.fonte !== caixa.FONTE_PAGINA));
  }

  // 6. Mercado
  gravarStatus(id, "Pesquisando comparáveis");
  let mercado = null;
  let condEstimado = null;
  if (e.valorMercado) {
    const [c, b, o] = e.valorMercado;
    mercado = { conservador: c, base: b, otimista: o, etiqueta: "ESTIMADO", confianca: "média",
      metodo: "Valores informados pelo usuário no formulário.", comparaveis: [], liquidezNota: 8, liquidezTexto: "",
      aluguelEstimado: null, pesquisado: true };
  } else if (im && usarIa) {
    try {
      const fn = iaMercado || (await import("./analise/ia.js")).pesquisarMercado;
      const m = await fn(descricaoParaMercado(im));
      for (const k of ["conservador", "base", "otimista"]) {
        if (!(Number(m[k]) > 0)) throw new Error(`valor '${k}' ausente na resposta`);
      }
      condEstimado = Number(m.condominioMensalEstimado) > 0 ? Number(m.condominioMensalEstimado) : null;
      const comparaveis = (m.comparaveis || []).filter((cp) => Number(cp.preco) > 0).map((cp) => ({
        descricao: String(cp.descricao || ""), fonte: String(cp.fonte || ""), url: urlSegura(cp.url), data: String(cp.data || ""),
        areaM2: Number(cp.areaM2) > 0 ? Number(cp.areaM2) : null, preco: Number(cp.preco),
        precoM2: Number(cp.areaM2) > 0 ? Number(cp.preco) / Number(cp.areaM2) : null,
        tipoPreco: cp.tipoPreco === "transacionado" ? "transacionado" : "pedido" }));
      // A ordem conservador ≤ base ≤ otimista é garantida aqui, não confiada ao modelo.
      const [c, b, o] = [Number(m.conservador), Number(m.base), Number(m.otimista)].sort((x, y) => x - y);
      mercado = { conservador: c, base: b, otimista: o, etiqueta: "ESTIMADO",
        confianca: ["alta", "média", "baixa"].includes(m.confianca) && comparaveis.length >= 3 ? m.confianca : "baixa",
        metodo: String(m.metodo || ""), comparaveis,
        liquidezNota: Math.max(0, Math.min(15, Math.round(Number(m.liquidezNota) || 8))),
        liquidezTexto: String(m.liquidezTexto || ""),
        aluguelEstimado: Number(m.aluguelEstimado) > 0 ? Number(m.aluguelEstimado) : null, pesquisado: true };
      for (const cp of comparaveis) {
        fontes.push({ nome: `Comparável: ${cp.fonte}`, url: cp.url, nivel: 7, status: "lida", dataHora: dataHoraBrasilia(),
          observacao: cp.descricao.slice(0, 120) });
      }
    } catch (ex) {
      limitacoes.push(`Pesquisa de comparáveis falhou: ${String(ex.message || ex).slice(0, 200)}`);
    }
  }
  if (!mercado && im && im.avaliacao) {
    mercado = { conservador: 0.75 * im.avaliacao, base: 0.85 * im.avaliacao, otimista: 0.95 * im.avaliacao,
      etiqueta: "ESTIMADO", confianca: "baixa", comparaveis: [], liquidezNota: 7, liquidezTexto: "", aluguelEstimado: null,
      metodo: "Sem comparáveis: 75% / 85% / 95% da avaliação do banco. Pesquise anúncios antes de decidir.", pesquisado: false };
    pendencias.push("Pesquisar 3 a 8 comparáveis da microrregião: o valor de saída é só uma fração da avaliação.");
  }

  const preco = e.lance || (im && im.precoMinimo);
  if (!im || !mercado || !preco) return resultadoIncompleto(id, e, p, geradoEm, fontes, limitacoes, im, onus, pendencias);

  // 7. Financeiro
  gravarStatus(id, "Calculando custos e cenários");
  const [itbi, itbiNota] = e.itbiAliquota != null ? [e.itbiAliquota, "Informada pelo usuário"] : financeiro.aliquotaItbi(im.uf, im.cidade);
  const tipo = im.tipo.toLowerCase().includes("casa") ? "casa" : "apartamento";
  const condominioMes = e.condominioMes ?? condEstimado ?? (tipo === "apartamento" ? 300 : 80);
  const prem = financeiro.premissas({
    preco, avaliacao: im.avaliacao || preco, valorConservador: mercado.conservador, valorBase: mercado.base,
    valorOtimista: mercado.otimista, tipo, formaPagamento: p.formaPagamento, itbiAliquota: itbi, condominioMes,
    ocupacao: ocupacao.situacao, debitosInformados: e.debitosInformados ?? null, reformaInformada: e.reformaInformada ?? null,
    comissaoLeiloeiroPct: im.modalidade.startsWith("Venda") ? 0 : 0.05,
  });
  const fin = financeiro.analisar(prem, p.margemMinima, p.capitalDisponivel);
  const base = fin.cenarios.BASE;
  const cons = fin.conservadorBase;
  const lm = fin.lanceMaximo;

  // 8. Nota, travas, decisão
  gravarStatus(id, "Calculando nota e travas");
  const dados = [...Object.values(im.dados), ...dadosExtra];
  const bloqueadas = fontes.filter((f) => f.status === "bloqueada").length;
  const criterios = {
    "Retorno/desconto": { pontos: nota.notaRetorno(cons.margem, p.margemMinima), max: 30 },
    "Segurança jurídica/documental": { pontos: nota.notaJuridica({ onus, matriculaLida, certidaoVencida: dr.certidaoVencida,
      acaoJudicial: dr.acaoJudicial, divergencias: divergencias.length }), max: 25 },
    "Posse/ocupação": { pontos: nota.PONTOS_POSSE[ocupacao.situacao] ?? 6, max: 15 },
    "Localização/liquidez": { pontos: mercado.liquidezNota, max: 15 },
    "Pagamento/execução": { pontos: nota.notaPagamento({ forma: p.formaPagamento, aceitaFinanciamento: im.aceitaFinanciamento,
      capitalOk: base.capitalNecessario <= p.capitalDisponivel, fraude: alertas.length > 0 }), max: 10 },
    "Qualidade dos dados": { pontos: nota.notaDados(dados.filter((d) => d.etiqueta === "CONFIRMADO").length, dados.length, bloqueadas), max: 5 },
  };
  const notaFinal = Math.round(Object.values(criterios).reduce((s, c) => s + c.pontos, 0));
  const travas = nota.avaliarTravas({
    margemConservadorBase: cons.margem, margemMinima: p.margemMinima, lucroBase: base.lucro,
    capitalAssinatura: base.capitalAssinatura, capitalNecessario: base.capitalNecessario, capitalDisponivel: p.capitalDisponivel,
    preco, lanceMax: lm.faixaMax, onus, matriculaLida, certidaoVencida: dr.certidaoVencida, alertasFraude: alertas,
    formaPagamento: p.formaPagamento, aceitaFinanciamento: im.aceitaFinanciamento, ocupacao: ocupacao.situacao,
    aceitaOcupado: p.aceitaOcupado, reformaBase: base.reforma, reformaMaxima: p.reformaMaxima, divergencias,
  });
  const decisao = nota.decidir(travas, notaFinal, cons.margem, p.margemMinima);

  for (const [nome, url, nivel] of FONTES_COM_CAPTCHA) {
    fontes.push({ nome, url, nivel, status: "não encontrada", dataHora: "",
      observacao: "Consulta exige CAPTCHA: NÃO ENCONTRADO, sem tentativa de burlar. Consulte manualmente." });
  }
  if (!invalidaria.length) {
    invalidaria = [
      "Certidão de matrícula atualizada com ônus diferente do considerado.",
      "Débitos de condomínio ou IPTU acima da estimativa (a regra do banco deixa até 10% da avaliação com o comprador).",
      "Comparáveis transacionados abaixo do valor conservador usado.",
      "Ocupação diferente da considerada ou desocupação judicial demorada.",
      "Mudança do preço, da data ou das condições do lote.",
    ];
  }
  if (!conferencias.length) {
    conferencias = [
      "Revalidar no dia: preço, data de encerramento, regras de pagamento e ocupação na página do lote.",
      "Certidão de inteiro teor da matrícula emitida há menos de 30 dias.",
      "Declaração de débitos do condomínio e certidão de IPTU/TLP do imóvel.",
      "Processo das penhoras e ações registradas: fase, valor e se há suspensão.",
      "Pagamento só pelos canais e contas indicados no edital ou pelo banco.",
      "Revisão jurídica e vistoria externa antes do lance.",
    ];
  }

  const resumo = `No lance de ${brl(preco)}, o cenário base termina com ${brl(base.lucro)} (margem ${pct(base.margem)}); `
    + `no valor conservador de saída a margem é ${pct(cons.margem)}. A faixa de lance máximo que preserva a margem do `
    + `perfil vai de ${brl(lm.faixaMin)} a ${brl(lm.faixaMax)}. `
    + (travas.length ? `${travas.length} trava(s) acionada(s).` : "Nenhuma trava acionada.")
    + (resumoIa ? ` ${resumoIa}` : "");

  return {
    id, versao: 2, geradoEm, link: e.link, perfil: p,
    imovel: {
      id: im.id, url: im.url, titulo: `${im.tipo} · ${im.endereco.split(",")[0]}`, endereco: im.endereco,
      cidade: im.cidade, uf: im.uf, tipo: im.tipo, modalidade: im.modalidade, emDisputa: im.emDisputa,
      avaliacao: im.avaliacao, precoMinimo: im.precoMinimo, desconto: im.desconto, areaPrivativa: im.areaPrivativa,
      areaTotal: im.areaTotal, areaTerreno: im.areaTerreno, aceitaFinanciamento: im.aceitaFinanciamento,
      observacoes: im.observacoes,
    },
    decisao, nota: notaFinal,
    confianca: nota.confianca({ fontesBloqueadas: bloqueadas, matriculaLida, mercadoPesquisado: mercado.pesquisado && mercado.confianca !== "baixa" }),
    criterios, resumo, travas, dados, onus,
    ocupacao: { ...ocupacao, custos: Object.fromEntries(financeiro.CENARIOS.map((c, i) =>
      [c, (financeiro.DESOCUPACAO[ocupacao.situacao] || financeiro.DESOCUPACAO.desconhecido)[i]])) },
    processos, debitos, riscos,
    documentos: quadroDocumentos(docs, textos, matriculaLida, dr, certidaoEmissao, divergencias),
    mercado, financeiro: fin, lanceAnalisado: preco,
    itbi: { aliquota: itbi, nota: itbiNota, etiqueta: e.itbiAliquota != null ? "CONFIRMADO" : "INFERIDO" },
    condominioMes,
    pendencias: [...new Set(pendencias)], invalidaria, conferencias, fontes, limitacoes: [...new Set(limitacoes)],
    iaUsada: Boolean(ia) || (mercado.pesquisado && !e.valorMercado),
    modeloIa: usarIa ? (iaDiligencia ? "simulada" : `${config.geminiModelo} (Gemini, plano gratuito)`) : null,
  };
}

function descricaoParaMercado(im) {
  const d = (campo) => (im.dados[campo] ? im.dados[campo].valor : "?");
  return `${im.tipo} em ${im.endereco}. Área privativa ${im.areaPrivativa ?? "?"} m², área total ${im.areaTotal ?? "?"} m², `
    + `terreno ${im.areaTerreno ?? "?"} m². ${d("Quartos")} quartos, ${d("Vagas")} vaga(s). Cidade ${im.cidade}/${im.uf}.`;
}

function contextoParaIa(im, dr, textoPortal) {
  const partes = [];
  if (im) partes.push("PÁGINA DO LOTE NA CAIXA (texto literal):\n" + im.texto.slice(0, 12000));
  if (textoPortal) partes.push("ANÚNCIO NO PORTAL (fonte de apoio, nível 8):\n" + textoPortal.slice(0, 8000));
  partes.push("REGRAS DETERMINÍSTICAS: " + JSON.stringify({ onusDeclarados: dr.onus, ocupacao: dr.ocupacao,
    certidaoEmissao: dr.certidaoEmissao, certidaoVencida: dr.certidaoVencida }));
  return partes.join("\n\n");
}

function quadroDocumentos(docs, textos, matriculaLida, dr, certidaoEmissao, divergencias) {
  const q = [];
  for (const nome of ["edital", "matrícula", "regras da venda online", "laudo"]) {
    const titulo = nome[0].toUpperCase() + nome.slice(1);
    if (docs[nome]) {
      const t = textos[nome];
      if (nome === "matrícula") {
        q.push({ documento: titulo, status: divergencias.length ? "conflitante" : (matriculaLida ? "confirmado" : "pendente"),
          observacao: (certidaoEmissao ? `Certidão emitida em ${certidaoEmissao}` : "Data da certidão não lida")
            + (dr.certidaoVencida ? " · VENCIDA" : "") + (t.escaneado ? " · PDF escaneado" : "") });
      } else {
        q.push({ documento: titulo, status: "confirmado", observacao: `${t.paginas} página(s)` + (t.escaneado ? " · escaneado" : "") });
      }
    } else if (["edital", "matrícula"].includes(nome)) {
      q.push({ documento: titulo, status: "ausente", observacao: "Envie o PDF." });
    }
  }
  q.push({ documento: "Processo judicial", status: "pendente", observacao: "Localizar pelo número na matrícula (tribunal/DJE)." });
  q.push({ documento: "Certidões de débitos (condomínio, IPTU)", status: "pendente", observacao: "Pedir antes do lance." });
  return q;
}

function resultadoIncompleto(id, e, p, geradoEm, fontes, limitacoes, im, onus, pendencias) {
  return {
    id, versao: 2, geradoEm, link: e.link, perfil: p, incompleto: true,
    imovel: { id: im ? im.id : "", titulo: im ? im.endereco : "Imóvel não identificado", cidade: im ? im.cidade : "", uf: im ? im.uf : "" },
    decisao: "DADOS INSUFICIENTES", nota: 0, confianca: "baixa",
    resumo: "Não foi possível ler os dados essenciais do lote (página bloqueada por verificação antibot, link sem número "
      + "CAIXA ou sem preço). Abra a página do lote no seu navegador, copie todo o texto (Ctrl+A, Ctrl+C), cole no campo "
      + "'Texto da página do lote' do formulário e envie o PDF da matrícula.",
    travas: [{ codigo: "objeto", tipo: "documental", descricao: "Objeto mal identificado: dados do lote não lidos." }],
    onus, pendencias: [...pendencias, "Colar o texto da página do lote no formulário ou tentar de novo mais tarde."],
    fontes, limitacoes,
  };
}
