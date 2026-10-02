// Diligência determinística, sem IA.
//
// Roda sempre: serve de piso quando a IA não está disponível e de conferência
// cruzada quando está. Só marca CONFIRMADO o que está escrito na fonte; o
// resto vira INFERIDO ou NÃO ENCONTRADO.
import { FONTE_PAGINA } from "../coleta/caixa.js";
import { emissaoCertidao } from "../coleta/pdf.js";

const TERMOS_ONUS = [
  [/\bPENHORA\b/, "Penhora", "alto"],
  [/INDISPONIBILIDADE/, "Indisponibilidade", "crítico"],
  [/ALIENA[ÇC][ÃA]O FIDUCI[ÁA]RIA/, "Alienação fiduciária", "médio"],
  [/\bHIPOTECA\b/, "Hipoteca", "alto"],
  [/\bUSUFRUTO\b/, "Usufruto", "alto"],
  [/ARROLAMENTO/, "Arrolamento fiscal", "médio"],
  [/\bSERVID[ÃA]O\b/, "Servidão", "médio"],
  [/PROMESSA DE COMPRA/, "Promessa de compra e venda", "alto"],
  [/CITA[ÇC][ÃA]O.{0,40}A[ÇC][ÃA]O/, "Citação de ação", "alto"],
];

const dataBr = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** `hoje`: Date à meia-noite UTC do dia em Brasília. */
export function diligenciar(imovel, textoMatricula, matriculaEscaneada, hoje) {
  const r = { onus: [], ocupacao: "desconhecido", ocupacaoEtiqueta: "NÃO ENCONTRADO", ocupacaoTrecho: "", riscos: [],
    pendencias: [], certidaoEmissao: null, certidaoVencida: null, matriculaLida: false, acaoJudicial: false };
  const obs = imovel ? imovel.observacoes.join(" ").toLowerCase() : "";

  if (imovel) {
    const declarado = imovel.observacoes.find((o) => /gravame|penhora|indisponibilidade/i.test(o));
    if (declarado) {
      r.onus.push({ tipo: "Gravame/penhora/indisponibilidade averbada",
        descricao: "A CAIXA declara ônus averbado na matrícula, sem dizer qual nem o valor.",
        etiqueta: "CONFIRMADO", gravidade: "alto", cancelado: false, fonte: FONTE_PAGINA, trecho: declarado });
    }
    if (obs.includes("desocupado")) {
      Object.assign(r, { ocupacao: "desocupado confirmado", ocupacaoEtiqueta: "CONFIRMADO", ocupacaoTrecho: "Imóvel desocupado" });
    } else if (obs.includes("ocupado")) {
      Object.assign(r, { ocupacao: "ocupado pelo devedor", ocupacaoEtiqueta: "INFERIDO",
        ocupacaoTrecho: "Imóvel ocupado (ocupante não identificado)" });
    }
    if (obs.includes("ação judicial") || obs.includes("acao judicial")) {
      r.acaoJudicial = true;
      r.riscos.push({ risco: "Existe ação judicial sobre o imóvel (declarado pela CAIXA)", nivel: "alto",
        mitigacao: "Localizar o processo no tribunal e ler a fase e os pedidos antes do lance." });
    }
    if (obs.includes("regularização por conta do adquirente")) {
      r.riscos.push({ risco: "Regularização documental por conta do comprador", nivel: "médio",
        mitigacao: "Orçar averbações e baixas no cartório antes do lance." });
    }
    if (imovel.regraCondominio.includes("10%")) {
      r.riscos.push({ risco: "Condomínio atrasado até 10% da avaliação fica com o comprador", nivel: "médio",
        mitigacao: "Pedir declaração de débitos ao síndico ou à administradora." });
    }
    if (imovel.regraTributos.includes("10%")) {
      r.riscos.push({ risco: "IPTU/TLP atrasados até 10% da avaliação ficam com o comprador", nivel: "médio",
        mitigacao: "Emitir certidão de débitos do imóvel na Receita local." });
    }
  }

  if (textoMatricula) {
    const em = emissaoCertidao(textoMatricula);
    if (em.data) {
      r.certidaoEmissao = dataBr(em.data);
      if (em.validadeDias) r.certidaoVencida = (hoje - em.data) / 86400000 > em.validadeDias;
    }
    if (!matriculaEscaneada) {
      r.matriculaLida = true;
      const up = textoMatricula.toUpperCase();
      for (const [padrao, tipo, gravidade] of TERMOS_ONUS) {
        const m = up.match(padrao);
        if (m) {
          r.onus.push({ tipo, descricao: `Termo '${tipo}' aparece na matrícula; conferir se foi cancelado.`,
            etiqueta: "INFERIDO", gravidade, cancelado: false, fonte: "Matrícula (texto do PDF)",
            trecho: textoMatricula.slice(Math.max(0, m.index - 80), m.index + m[0].length + 120).replaceAll("\n", " ") });
        }
      }
    }
  }

  if (!r.matriculaLida) r.pendencias.push("Ler a matrícula completa (atos de registro e averbações): o PDF não foi lido.");
  if (r.certidaoVencida) {
    r.pendencias.push(`Pedir certidão de inteiro teor atualizada: a enviada foi emitida em ${r.certidaoEmissao} e já venceu.`);
  }
  if (r.ocupacao === "desconhecido") r.pendencias.push("Confirmar a ocupação (vizinhos, síndico, visita externa).");
  return r;
}
