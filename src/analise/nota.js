// Nota 0-100, travas e decisão.
//
// Pesos do método: retorno/desconto 30; segurança jurídica/documental 25;
// posse/ocupação 15; localização/liquidez 15; pagamento/execução 10;
// qualidade dos dados 5. Nota alta não supera trava crítica.
import { brl, pct } from "../config.js";

export const PONTOS_POSSE = { "desocupado confirmado": 15, "desconhecido": 6, "locado": 7, "ocupado pelo devedor": 5,
  "ocupado por terceiro": 3, "invadido": 0 };
const DESCONTO_GRAVIDADE = { "crítico": 14, "alto": 9, "médio": 4, "baixo": 1 };

export function notaRetorno(margemBase, margemMinima) {
  if (margemBase <= 0) return 0;
  return Math.round(Math.min(30, (30 * margemBase) / Math.max(margemMinima, 0.01)) * 10) / 10;
}

export function notaJuridica({ onus, matriculaLida, certidaoVencida, acaoJudicial, divergencias }) {
  let pontos = 25;
  for (const o of onus) if (!o.cancelado) pontos -= DESCONTO_GRAVIDADE[o.gravidade] ?? 4;
  if (!matriculaLida) pontos -= 8;
  if (certidaoVencida) pontos -= 3;
  if (acaoJudicial) pontos -= 6;
  pontos -= 3 * divergencias;
  return Math.max(0, pontos);
}

export function notaPagamento({ forma, aceitaFinanciamento, capitalOk, fraude }) {
  if (fraude) return 0;
  let pontos = 10;
  if (forma === "financiado" && aceitaFinanciamento === false) pontos -= 7;
  if (forma === "financiado" && aceitaFinanciamento === null) pontos -= 3;
  if (!capitalOk) pontos -= 5;
  return Math.max(0, pontos);
}

export function notaDados(confirmados, total, fontesBloqueadas) {
  if (!total) return 0;
  return Math.round(Math.max(0, (5 * confirmados) / total - fontesBloqueadas * 0.5) * 10) / 10;
}

export function avaliarTravas(a) {
  const t = [];
  const add = (codigo, tipo, descricao) => t.push({ codigo, tipo, descricao });
  if (a.alertasFraude.length) add("fraude", "fraude", "ALERTA DE FRAUDE: " + a.alertasFraude.join("; "));
  if (a.lucroBase < 0) {
    add("sem_margem", "financeira", `Custo sem margem: o cenário BASE termina em prejuízo de ${brl(Math.abs(a.lucroBase))}.`);
  } else if (a.margemConservadorBase < a.margemMinima) {
    add("margem_abaixo", "financeira",
      `Margem no valor conservador (${pct(a.margemConservadorBase)}) abaixo do mínimo do perfil (${pct(a.margemMinima, 0)}).`);
  }
  if (a.capitalAssinatura > a.capitalDisponivel) {
    add("capital", "financeira",
      `Capital para assinar (${brl(a.capitalAssinatura)}) acima do disponível (${brl(a.capitalDisponivel)}).`);
  } else if (a.capitalNecessario > a.capitalDisponivel) {
    add("capital", "financeira", `O capital cobre a assinatura (${brl(a.capitalAssinatura)}), mas até a revenda saem mais `
      + `${brl(a.capitalNecessario - a.capitalAssinatura)} em parcelas, débitos e reforma, e o total passa dos `
      + `${brl(a.capitalDisponivel)} disponíveis.`);
  }
  if (a.preco > a.lanceMax) add("acima_lance_max", "financeira", "Preço atual acima da faixa de lance máximo que preserva a margem.");
  if (a.formaPagamento === "financiado" && a.aceitaFinanciamento === false) {
    add("financiamento", "financeira", "O perfil é financiado e o lote não aceita financiamento.");
  }
  if (!["desocupado confirmado", "desconhecido"].includes(a.ocupacao) && a.aceitaOcupado === "não") {
    add("ocupado", "documental", "Imóvel ocupado e o perfil não aceita ocupação.");
  }
  if (a.reformaBase > a.reformaMaxima) {
    add("reforma", "financeira", `Reforma estimada (${brl(a.reformaBase)}) acima do teto do perfil.`);
  }
  const graves = a.onus.filter((o) => !o.cancelado && ["crítico", "alto"].includes(o.gravidade));
  if (graves.length) {
    add("onus", "documental", "Ônus incerto: " + [...new Set(graves.map((o) => o.tipo))].sort().join("; ")
      + ". Exige certidão atualizada e leitura do processo antes do lance.");
  }
  if (!a.matriculaLida) add("matricula", "documental", "Documento essencial não lido: matrícula.");
  if (a.certidaoVencida) add("certidao", "documental", "Documentação desatualizada: certidão de matrícula vencida.");
  for (const d of a.divergencias) add("divergencia", "documental", `Divergência: ${d}`);
  return t;
}

export function decidir(travas, nota, margemBase, margemMinima) {
  if (travas.some((x) => x.tipo === "fraude" || x.tipo === "financeira")) return "NÃO PARTICIPAR";
  if (travas.some((x) => x.tipo === "documental")) return "DADOS INSUFICIENTES";
  if (margemBase >= margemMinima && nota >= 60) return "AVANÇAR À DILIGÊNCIA";
  return "MONITORAR";
}

export function confianca({ fontesBloqueadas, matriculaLida, mercadoPesquisado }) {
  if (matriculaLida && mercadoPesquisado && fontesBloqueadas === 0) return "alta";
  if (matriculaLida || mercadoPesquisado) return "média";
  return "baixa";
}
