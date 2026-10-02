// Caso real de referência: apartamento CAIXA 8555526095620 em Samambaia-DF.
//
// Resultado conhecido da análise manual do projeto: NÃO PARTICIPAR, por penhora
// de condomínio averbada na matrícula e margem negativa no cenário base.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

import { config } from "../src/config.js";
import { executar } from "../src/pipeline.js";
import { HOJE, IA_DILIGENCIA, ID, coletaSamambaia, entrada, textoPagina } from "./apoio.js";

before(() => {
  config.dirAnalises = fs.mkdtempSync(path.join(os.tmpdir(), "analista-"));
  delete process.env.GEMINI_API_KEY;
});

test("sem IA: Samambaia dá NÃO PARTICIPAR com as travas esperadas", async () => {
  const r = await executar("t1", entrada(), { coletaPronta: coletaSamambaia(), hoje: HOJE });
  assert.equal(r.decisao, "NÃO PARTICIPAR");
  const codigos = new Set(r.travas.map((t) => t.codigo));
  assert.ok(codigos.has("sem_margem"), "prejuízo no cenário base");
  assert.ok(codigos.has("onus"), "gravame/penhora declarado pela CAIXA");
  assert.ok(codigos.has("certidao"), "certidão de 10/04/2026, validade de 30 dias");
  assert.ok(codigos.has("matricula"), "sem IA, a matrícula escaneada não conta como lida");
  assert.ok(r.financeiro.cenarios.BASE.lucro < 0);
  assert.equal(r.imovel.avaliacao, 266000);
  assert.equal(r.lanceAnalisado, 162873);
  assert.equal(r.confianca, "baixa");
  assert.equal(r.iaUsada, false);
});

test("com IA simulada: registra a penhora de condomínio e usa os comparáveis", async () => {
  const chamadas = {};
  const iaDiligencia = async (contexto, docs) => {
    chamadas.docs = docs.map((d) => d.nome);
    assert.match(contexto, /gravame\/penhora/);
    return IA_DILIGENCIA;
  };
  const iaMercado = async (desc) => {
    assert.match(desc, /SAMAMBAIA/i);
    return { comparaveis: [
      { descricao: "Apto 2q QR 410", fonte: "DFimóveis", url: "https://exemplo.com/1", data: "09/2026", areaM2: 48, preco: 215000, tipoPreco: "pedido" },
      { descricao: "Apto 2q QR 408", fonte: "OLX", url: "https://exemplo.com/2", data: "09/2026", areaM2: 50, preco: 220000, tipoPreco: "pedido" },
      { descricao: "Apto 2q QR 412", fonte: "ZAP", url: "javascript:alert(1)", data: "09/2026", areaM2: null, preco: 205000, tipoPreco: "pedido" },
    ], conservador: 200000, base: 215000, otimista: 235000, confianca: "média", metodo: "teste", liquidezNota: 9,
    liquidezTexto: "", aluguelEstimado: 1200, condominioMensalEstimado: 250 };
  };
  const r = await executar("t2", entrada(), { coletaPronta: coletaSamambaia(), hoje: HOJE, iaDiligencia, iaMercado });
  assert.deepEqual(chamadas.docs, ["matrícula"]);
  assert.equal(r.decisao, "NÃO PARTICIPAR");
  assert.ok(r.onus.some((o) => o.tipo === "Penhora" && o.descricao.includes("condomin")));
  assert.ok(!r.travas.some((t) => t.codigo === "matricula"));
  assert.equal(r.mercado.conservador, 200000);
  assert.equal(r.condominioMes, 250);
  // Link que não é http(s) vindo da IA/web é descartado
  assert.equal(r.mercado.comparaveis[2].url, "");
  assert.ok(r.fontes.every((f) => !f.url.startsWith("javascript")));
});

test("resposta de mercado inválida não derruba a análise", async () => {
  const r = await executar("t3", entrada(), { coletaPronta: coletaSamambaia(), hoje: HOJE,
    iaDiligencia: async () => IA_DILIGENCIA, iaMercado: async () => ({ comparaveis: [], conservador: "muito" }) });
  assert.ok(r.limitacoes.some((l) => l.includes("Pesquisa de comparáveis falhou")));
  assert.equal(r.mercado.conservador, 0.75 * 266000);
  assert.equal(r.mercado.confianca, "baixa");
});

test("sem matrícula: pede o upload", async () => {
  const r = await executar("t4", entrada(false), { coletaPronta: coletaSamambaia(), hoje: HOJE });
  assert.ok(r.limitacoes.some((l) => l.includes("Matrícula não disponível")));
  assert.ok(r.documentos.some((d) => d.documento === "Matrícula" && d.status === "ausente"));
});

test("fontes com CAPTCHA aparecem como NÃO ENCONTRADO e o bloqueio fica registrado", async () => {
  const r = await executar("t5", entrada(false), { coletaPronta: coletaSamambaia(), hoje: HOJE });
  const porNome = Object.fromEntries(r.fontes.map((f) => [f.nome, f]));
  assert.equal(porNome["CENPROT (protestos)"].status, "não encontrada");
  assert.equal(porNome["PDF: matrícula (CAIXA)"].status, "bloqueada");
});

test("texto colado pelo usuário substitui a página bloqueada, sem abrir o navegador", async () => {
  const r = await executar("t6", entrada(true, { link: ID, textoPagina: textoPagina() }), { hoje: HOJE });
  assert.equal(r.decisao, "NÃO PARTICIPAR");
  assert.equal(r.fontes[0].status, "enviada pelo usuário");
  assert.equal(r.imovel.precoMinimo, 162873);
});
