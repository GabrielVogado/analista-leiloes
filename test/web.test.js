import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { config } from "../src/config.js";
import { executar } from "../src/pipeline.js";
import { criarApp, numero } from "../src/servidor.js";
import { HOJE, ID, coletaSamambaia, entrada, matricula, textoPagina } from "./apoio.js";

let servidor, base;

before(async () => {
  config.dirAnalises = fs.mkdtempSync(path.join(os.tmpdir(), "analista-web-"));
  delete process.env.GEMINI_API_KEY;
  servidor = criarApp().listen(0);
  await new Promise((ok) => servidor.once("listening", ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

test("formulário abre e avisa que a IA está desligada", async () => {
  const r = await fetch(base + "/");
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Link do lote/);
  assert.match(html, /IA desligada/);
});

test("dashboard de Samambaia traz todas as seções e é um HTML único", async () => {
  await executar("20261001-teste", entrada(), { coletaPronta: coletaSamambaia(), hoje: HOJE });
  const r = await fetch(base + "/analises/20261001-teste");
  const html = await r.text();
  assert.equal(r.status, 200);
  for (const trecho of ["NÃO PARTICIPAR", "Critérios da nota", "Cenários", "Composição dos custos", "Matriz de riscos",
    "Documentos", "Ocupação e posse", "Comparáveis de mercado", "Checklist de pendências",
    "O que invalidaria esta análise", "Conferências obrigatórias antes do lance", "Fontes primárias consultadas",
    "R$ 266.000", "CENPROT"]) {
    assert.ok(html.includes(trecho), trecho);
  }
  assert.ok(!/\{\{|\{%/.test(html), "sobrou marcação de template");
  assert.ok(!/undefined|NaN|\[object Object\]/.test(html), "valor não formatado no painel");
  const exp = await fetch(base + "/analises/20261001-teste/dashboard.html");
  const expHtml = await exp.text();
  assert.match(exp.headers.get("content-disposition"), /attachment/);
  assert.ok(!/<script src|rel="stylesheet"/.test(expHtml), "HTML exportado não pode depender de arquivos externos");
});

test("envio pelo formulário com texto colado e matrícula roda a análise inteira", async () => {
  const form = new FormData();
  form.set("link", ID);
  form.set("capital_disponivel", "20.000");
  form.set("forma_pagamento", "financiado");
  form.set("margem_minima", "20");
  form.set("reforma_maxima", "20.000");
  form.set("texto_pagina", textoPagina());
  form.set("matricula", new Blob([matricula()], { type: "application/pdf" }), "matricula.pdf");
  const r = await fetch(base + "/analises", { method: "POST", body: form, redirect: "manual" });
  assert.equal(r.status, 303);
  const destino = r.headers.get("location");
  let resultado;
  for (let i = 0; i < 100 && !resultado?.decisao; i++) {
    await new Promise((ok) => setTimeout(ok, 100));
    resultado = await (await fetch(base + "/api" + destino)).json();
  }
  assert.equal(resultado.decisao, "NÃO PARTICIPAR");
  assert.equal(resultado.perfil.capitalDisponivel, 20000);
  assert.equal(resultado.perfil.margemMinima, 0.2);
});

test("formulário recusa arquivo que não é PDF e identificador inválido", async () => {
  const form = new FormData();
  form.set("link", ID);
  form.set("capital_disponivel", "20000");
  form.set("matricula", new Blob(["não sou pdf"]), "x.pdf");
  assert.equal((await fetch(base + "/analises", { method: "POST", body: form })).status, 400);
  assert.equal((await fetch(base + "/analises/..%2F..%2Fsegredo")).status, 400);
  assert.equal((await fetch(base + "/analises/nao-existe")).status, 404);
});

test("números em formato brasileiro", () => {
  assert.equal(numero("162.873,00"), 162873);
  assert.equal(numero("R$ 20.000"), 20000);
  assert.equal(numero("20%"), 0.2);
  assert.equal(numero("1.5"), 1.5);
  assert.equal(numero(""), null);
  assert.throws(() => numero("abc"));
});
