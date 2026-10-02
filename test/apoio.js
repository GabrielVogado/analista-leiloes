// Apoio dos testes: caso real de referência, apartamento CAIXA 8555526095620 em Samambaia-DF.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { interpretarTexto, urlDetalhe } from "../src/coleta/caixa.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
export const ID = "8555526095620";
export const HOJE = new Date(Date.UTC(2026, 9, 1));
// Perfil do teste feito no projeto: revenda, financiado, R$ 20 mil de capital, margem de 20%.
export const PERFIL = { objetivo: "revenda", capitalDisponivel: 20000, formaPagamento: "financiado", margemMinima: 0.20,
  reformaMaxima: 20000, aceitaOcupado: "sim, se estimado", riscoJuridico: "médio" };
const LINK = "https://www.leilaoimovel.com.br/imovel/df/samambaia/residencial-2-quartos-1-vaga-na-garagem-wc-sala-cozinha-"
  + "imovel-caixa-economica-federal-cef-2845001-8555526095620-venda-direta-caixa";

export const textoPagina = () => fs.readFileSync(path.join(FIX, "caixa_8555526095620.txt"), "utf8");
export const matricula = () => fs.readFileSync(path.join(FIX, "matricula_teste.pdf"));
const links = () => JSON.parse(fs.readFileSync(path.join(FIX, "caixa_8555526095620.links.json"), "utf8"));

/** Página CAIXA lida e PDF da matrícula barrado pelo antibot, como aconteceu em 01/10/2026. */
export function coletaSamambaia() {
  const imovel = interpretarTexto(ID, textoPagina(), links());
  return { imovel, documentos: {}, fontes: [
    { nome: "Página do imóvel na CAIXA", url: urlDetalhe(ID), nivel: 4, status: "lida", dataHora: "01/10/2026 19:20", observacao: "" },
    { nome: "PDF: matrícula (CAIXA)", url: imovel.linksDocumentos["matrícula"], nivel: 2, status: "bloqueada",
      dataHora: "01/10/2026 19:21", observacao: "resposta não é PDF (bloqueio antibot/CAPTCHA). Envie o PDF pelo formulário." },
  ] };
}

export const IA_DILIGENCIA = {
  resumo: "Matrícula 333872 do 3º Ofício do DF com penhora de execução de condomínio não cancelada.",
  dados: [{ campo: "Proprietário atual", valor: "Caixa Econômica Federal", etiqueta: "CONFIRMADO", fonte: "Matrícula, p. 3",
    trecho: "consolidação da propriedade em favor da CEF" }],
  onus: [{ tipo: "Penhora", descricao: "Penhora em execução de cotas condominiais", etiqueta: "CONFIRMADO", gravidade: "alto",
    cancelado: false, fonte: "Matrícula, p. 3", trecho: "AV- PENHORA ... condomínio" }],
  ocupacao: { situacao: "desconhecido", etiqueta: "NÃO ENCONTRADO", fonte: "", trecho: "", estrategia: "" },
  processos: [], debitos: [], divergencias: [], alertasFraude: [], riscos: [], pendencias: [], invalidaria: [],
  conferencias: [], certidaoEmissao: "10/04/2026", matriculaLida: true,
};

export const entrada = (comMatricula = true, extra = {}) => ({ link: LINK, perfil: PERFIL,
  uploads: comMatricula ? { "matrícula": matricula() } : {}, ...extra });
