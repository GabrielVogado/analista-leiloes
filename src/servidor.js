// Servidor web: formulário, acompanhamento e dashboard da análise.
// Rodar: npm start   (http://localhost:8765)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";
import nunjucks from "nunjucks";

import { ehPdf } from "./coleta/pdf.js";
import { RAIZ, brl, config, iaDisponivel, pct } from "./config.js";
import * as pipeline from "./pipeline.js";

const LIMITE_PDF = 30 * 1024 * 1024;
const CLASSE_ETIQUETA = { "CONFIRMADO": "C", "ESTIMADO": "E", "INFERIDO": "I", "CONFLITANTE": "X", "NÃO ENCONTRADO": "N" };
const CLASSE_DECISAO = { "AVANÇAR À DILIGÊNCIA": "s-ok", "MONITORAR": "s-warn", "DADOS INSUFICIENTES": "s-warn", "NÃO PARTICIPAR": "s-bad" };

/** Aceita '162.873,00', '162873', '20.000', '20%' ou vazio. */
export function numero(txt) {
  if (txt === undefined || txt === null || !String(txt).trim()) return null;
  let t = String(txt).trim().replace("R$", "").replaceAll(" ", "");
  const porcento = t.endsWith("%");
  t = t.replace(/%$/, "");
  if (t.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replaceAll(".", "").replace(",", ".");
  const v = Number(t);
  if (!Number.isFinite(v)) throw new Error(`valor inválido: ${txt}`);
  return porcento ? v / 100 : v;
}

/** Percentual digitado como '20', '20%' ou '0,2' vira fração. */
const fracao = (txt) => { const v = numero(txt); return v !== null && v > 1 ? v / 100 : v; };

export function criarApp() {
  const app = express();
  const env = nunjucks.configure(path.join(RAIZ, "views"), { autoescape: true, express: app });
  env.addFilter("brl", brl);
  env.addFilter("pct", pct);
  env.addFilter("etq", (e) => CLASSE_ETIQUETA[e] || "N");
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_PDF, files: 3 } });
  const painel = (r, exportado) => ({ r, exportado, classeDecisao: CLASSE_DECISAO[r.decisao] || "s-warn" });

  app.get("/", (req, res) => {
    res.render("index.njk", { ia: iaDisponivel(), analises: recentes() });
  });

  app.post("/analises", upload.fields([{ name: "edital" }, { name: "matricula" }, { name: "laudo" }]), (req, res) => {
    const f = req.body;
    let entrada;
    try {
      const capital = numero(f.capital_disponivel);
      if (!String(f.link || "").trim() || capital === null) throw new Error("informe o link e o capital disponível");
      const vm = [numero(f.valor_conservador), numero(f.valor_base), numero(f.valor_otimista)];
      const uploads = {};
      for (const [campo, nome] of [["edital", "edital"], ["matricula", "matrícula"], ["laudo", "laudo"]]) {
        const arq = req.files?.[campo]?.[0];
        if (!arq) continue;
        if (!ehPdf(arq.buffer)) throw new Error(`${arq.originalname}: não é um PDF`);
        uploads[nome] = arq.buffer;
      }
      entrada = {
        link: String(f.link).trim(),
        perfil: {
          objetivo: f.objetivo === "renda" ? "renda" : "revenda", capitalDisponivel: capital,
          formaPagamento: f.forma_pagamento === "à vista" ? "à vista" : "financiado",
          margemMinima: fracao(f.margem_minima) ?? 0.2, reformaMaxima: numero(f.reforma_maxima) ?? 0,
          aceitaOcupado: f.aceita_ocupado === "não" ? "não" : "sim, se estimado",
          riscoJuridico: ["baixo", "médio", "alto"].includes(f.risco_juridico) ? f.risco_juridico : "médio",
        },
        uploads, lance: numero(f.lance), valorMercado: vm.every((v) => v > 0) ? vm : null,
        itbiAliquota: fracao(f.itbi), condominioMes: numero(f.condominio_mes), debitosInformados: numero(f.debitos),
        reformaInformada: numero(f.reforma), textoPagina: String(f.texto_pagina || "").slice(0, 200000),
      };
    } catch (e) {
      return res.status(400).send(`Dados inválidos no formulário: ${e.message}`);
    }
    const id = pipeline.novoId();
    pipeline.gravarStatus(id, "Na fila");
    pipeline.executar(id, entrada).catch(() => {}); // o erro já fica gravado em status.json
    res.redirect(303, `/analises/${id}`);
  });

  app.param("id", (req, res, next, id) => (pipeline.idValido(id) ? next() : res.status(400).send("Identificador inválido")));

  app.get("/analises/:id", (req, res) => {
    const r = pipeline.lerResultado(req.params.id);
    if (r) return res.render("dashboard.njk", painel(r, false));
    const status = pipeline.lerStatus(req.params.id);
    if (!status) return res.status(404).send("Análise não encontrada");
    res.render("andamento.njk", { id: req.params.id, status });
  });

  app.get("/analises/:id/dashboard.html", (req, res) => {
    const r = pipeline.lerResultado(req.params.id);
    if (!r) return res.status(404).send("Análise ainda não concluída");
    res.setHeader("Content-Disposition", `attachment; filename="analise-${req.params.id}.html"`);
    res.render("dashboard.njk", painel(r, true));
  });

  app.get("/api/analises/:id", (req, res) => {
    res.json(pipeline.lerResultado(req.params.id) || { status: pipeline.lerStatus(req.params.id) });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(413).send(`Arquivo recusado: ${err.message} (limite de 30 MB por PDF)`);
    next(err);
  });
  return app;
}

function recentes(limite = 10) {
  if (!fs.existsSync(config.dirAnalises)) return [];
  return fs.readdirSync(config.dirAnalises).sort().reverse().slice(0, limite)
    .map((id) => pipeline.lerResultado(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, titulo: r.imovel.titulo, decisao: r.decisao, nota: r.nota, geradoEm: r.geradoEm }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  criarApp().listen(config.porta, () => {
    console.log(`Analista de Leilões em http://localhost:${config.porta}`);
    console.log(iaDisponivel() ? "IA: Gemini (GEMINI_API_KEY definida)" : "IA: desligada (defina GEMINI_API_KEY)");
  });
}
