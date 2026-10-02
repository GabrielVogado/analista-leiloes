import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as fin from "../src/analise/financeiro.js";
import { chamar, extrairJson, textoDaResposta } from "../src/analise/ia.js";
import * as nota from "../src/analise/nota.js";
import { extrairIdCaixa, interpretarTexto } from "../src/coleta/caixa.js";
import { pareceBloqueio } from "../src/coleta/navegador.js";
import { emissaoCertidao, extrair } from "../src/coleta/pdf.js";
import { brl, pct } from "../src/config.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const prem = (extra = {}) => fin.premissas({ preco: 100000, avaliacao: 180000, valorConservador: 150000, valorBase: 165000,
  valorOtimista: 180000, ...extra });

test("número CAIXA em vários formatos", () => {
  assert.equal(extrairIdCaixa("8555526095620"), "8555526095620");
  assert.equal(extrairIdCaixa("Número do imóvel: 855552609562-0"), "8555526095620");
  assert.equal(extrairIdCaixa("https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1444419803117"), "1444419803117");
  assert.equal(extrairIdCaixa("https://exemplo.com/sem-numero"), null);
});

test("página CAIXA de Samambaia é interpretada campo a campo", () => {
  const t = fs.readFileSync(path.join(FIX, "caixa_8555526095620.txt"), "utf8");
  const links = JSON.parse(fs.readFileSync(path.join(FIX, "caixa_8555526095620.links.json"), "utf8"));
  const im = interpretarTexto("8555526095620", t, links);
  assert.equal(im.avaliacao, 266000);
  assert.equal(im.precoMinimo, 162873);
  assert.ok(Math.abs(im.desconto - 0.3877) < 1e-9);
  assert.equal(im.tipo, "Apartamento");
  assert.equal(im.cidade, "Samambaia");
  assert.equal(im.uf, "DF");
  assert.equal(im.areaPrivativa, 46.76);
  assert.equal(im.areaTotal, 86.85);
  assert.equal(im.modalidade, "Venda Online");
  assert.equal(im.emDisputa, true);
  assert.equal(im.aceitaFinanciamento, true);
  assert.equal(im.aceitaFgts, false);
  assert.equal(im.dados["Matrícula"].valor, "333872");
  assert.equal(im.dados["Inscrição imobiliária"].etiqueta, "NÃO ENCONTRADO");
  assert.equal(im.dados["Área do terreno"].etiqueta, "NÃO ENCONTRADO");
  assert.ok(im.observacoes.some((o) => /gravame\/penhora\/indisponibilidade/.test(o)));
  assert.match(im.linksDocumentos["matrícula"], /\/editais\/matricula\/DF\/8555526095620\.pdf$/);
});

test("à vista não tem juros nem tarifa bancária", () => {
  const r = fin.calcular(prem({ formaPagamento: "à vista" }), "BASE");
  assert.equal(r.composicao["Juros e seguros"], 0);
  assert.equal(r.composicao["Tarifas bancárias"], 0);
  assert.ok(r.capitalAssinatura >= 100000);
});

test("financiado: entrada de 5% e juros sobre o saldo", () => {
  const r = fin.calcular(prem(), "BASE");
  assert.equal(r.composicao["Juros e seguros"], 95000 * 0.01 * 10);
  assert.equal(r.capitalAssinatura, 5000 + r.composicao.ITBI + r.composicao["Registro e certidões"] + 1500);
});

test("custo total é a soma da composição e o lucro fecha com o valor de venda", () => {
  const r = fin.calcular(prem(), "ESTRESSE");
  const soma = Object.values(r.composicao).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(soma - r.custoTotal) < 0.01);
  assert.equal(r.lucro, r.valorVenda - r.custoTotal);
});

test("lance máximo respeita a margem mínima", () => {
  const p = prem();
  const lm = fin.lanceMaximo(p, 0.20);
  assert.ok(lm.faixaMin <= lm.faixaMax);
  assert.ok(fin.calcular(p, "BASE", p.valorConservador, lm.pelaMargem).margem >= 0.20 - 1e-6);
  assert.ok(fin.calcular(p, "BASE", p.valorConservador, lm.pelaMargem + 500).margem < 0.20);
});

test("cenários saem ordenados do melhor para o pior", () => {
  const lucros = fin.CENARIOS.map((c) => fin.calcular(prem(), c).lucro);
  assert.ok(lucros[0] > lucros[1] && lucros[1] > lucros[2]);
});

test("ITBI: DF conhecido, resto usa teto", () => {
  assert.equal(fin.aliquotaItbi("DF", "Samambaia")[0], 0.02);
  assert.equal(fin.aliquotaItbi("MG", "Uberaba")[0], 0.03);
  assert.equal(fin.aliquotaItbi("GO", "Goiânia")[0], 0.03);
});

test("trava financeira vence nota alta; documental vira DADOS INSUFICIENTES", () => {
  assert.equal(nota.decidir([{ tipo: "financeira" }], 95, 0.5, 0.2), "NÃO PARTICIPAR");
  assert.equal(nota.decidir([{ tipo: "fraude" }], 95, 0.5, 0.2), "NÃO PARTICIPAR");
  assert.equal(nota.decidir([{ tipo: "documental" }], 95, 0.5, 0.2), "DADOS INSUFICIENTES");
  assert.equal(nota.decidir([], 70, 0.25, 0.2), "AVANÇAR À DILIGÊNCIA");
  assert.equal(nota.decidir([], 50, 0.25, 0.2), "MONITORAR");
});

test("bloqueio antibot é reconhecido", () => {
  assert.ok(pareceBloqueio("<title>Radware Bot Manager CAPTCHA</title>"));
  assert.ok(pareceBloqueio("Executando verificação de segurança ... Ray ID: a43f"));
  assert.ok(!pareceBloqueio("<title>Detalhe do imóvel</title>"));
});

test("certidão de matrícula escaneada: sem texto dos atos, emissão de 10/04/2026 com validade de 30 dias", async () => {
  const t = await extrair(fs.readFileSync(path.join(FIX, "matricula_teste.pdf")));
  assert.equal(t.paginas, 4);
  assert.equal(t.escaneado, true);
  const em = emissaoCertidao(t.texto);
  assert.equal(em.data.toISOString().slice(0, 10), "2026-04-10");
  assert.equal(em.validadeDias, 30);
});

test("resposta da IA: texto do último passo e JSON com ou sem cerca", () => {
  const resp = { steps: [{ type: "google_search_call", queries: ["x"] }, { type: "model_output", content: [{ type: "text", text: "```json\n{\"a\": 1}\n```" }] }] };
  assert.deepEqual(extrairJson(textoDaResposta(resp)), { a: 1 });
  assert.deepEqual(extrairJson("Segue: {\"b\": [1, 2]} fim"), { b: [1, 2] });
  assert.throws(() => extrairJson("sem json"));
  assert.throws(() => textoDaResposta({ steps: [] }));
});

test("formatação brasileira de valores", () => {
  assert.equal(brl(162873), "R$ 162.873");
  assert.equal(brl(-13618.4), "−R$ 13.618");
  assert.equal(brl(null), "—");
  assert.equal(pct(-0.0602), "−6,0%");
  assert.equal(pct(0.2, 0), "20%");
});

test("IA: 503 repete e passa ao próximo modelo; 404 pula; 429 para", async () => {
  const ok = { status: 200, texto: JSON.stringify({ steps: [{ content: [{ text: "{\"a\":1}" }] }] }) };
  const chamadas = [];
  const roteiro = { m1: [{ status: 503, texto: "" }, { status: 503, texto: "" }, { status: 503, texto: "" }], m2: [{ status: 404, texto: "" }], m3: [ok] };
  const postar = async (c) => { chamadas.push(c.model); return roteiro[c.model].shift(); };
  const r = await chamar({ input: "x" }, ["m1", "m2", "m3"], { postar, esperaMs: 0 });
  assert.deepEqual(chamadas, ["m1", "m1", "m1", "m2", "m3"]);
  assert.equal(r.modelo, "m3");
  await assert.rejects(chamar({ input: "x", tools: [{}] }, ["m1"], { postar: async () => ({ status: 429, texto: "" }), esperaMs: 0 }),
    /busca do Google/);
  await assert.rejects(chamar({ input: "x" }, ["m1"], { postar: async () => ({ status: 503, texto: "" }), esperaMs: 0 }),
    /Nenhum modelo Gemini disponível/);
});
