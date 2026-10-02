// Modelo financeiro conservador: custo total, cenários e lance máximo.
//
// Custo total = lance + comissão + ITBI + registro/certidões + tarifas bancárias
//             + juros e seguros até a revenda + condomínio de carregamento
//             + débitos assumidos + reforma + desocupação + contingência
//             + corretagem na venda + IR sobre o ganho.
//
// Desconto real = 1 - (custo total ÷ valor conservador).
// Lance máximo  = maior lance em que a margem líquida, no valor CONSERVADOR de
//                 saída com os custos do cenário BASE, ainda atinge a margem mínima.
//
// Toda premissa sem fonte primária é ESTIMADO e aparece no dashboard.

export const CENARIOS = ["OTIMISTA", "BASE", "ESTRESSE"];

// Débitos em % da avaliação: a regra CAIXA deixa ao comprador condomínio e
// tributos até 10% da avaliação cada.
export const PREMISSAS_CENARIO = {
  OTIMISTA: { meses: 7, reforma: { apartamento: 6000, casa: 8000 }, debitosPct: 0.01, valor: "otimista" },
  BASE: { meses: 10, reforma: { apartamento: 12000, casa: 15000 }, debitosPct: 0.03, valor: "base" },
  ESTRESSE: { meses: 16, reforma: { apartamento: 20000, casa: 25000 }, debitosPct: 0.10, valor: "conservador" },
};

// Custo de desocupação por situação (R$): otimista, base, estresse.
export const DESOCUPACAO = {
  "desocupado confirmado": [0, 0, 3000],
  "desconhecido": [0, 5000, 15000],
  "ocupado pelo devedor": [3000, 10000, 25000],
  "locado": [3000, 8000, 20000],
  "ocupado por terceiro": [5000, 15000, 35000],
  "invadido": [10000, 25000, 50000],
};

// Alíquotas a conferir na legislação local antes do lance: entram como INFERIDO.
const ITBI_CONHECIDO = {
  DF: [0.02, "DF: 2% para imóvel usado (lei distrital vigente desde 01/2025; conferir na SEEC-DF)"],
  GOIANIA: [0.03, "Goiânia: alíquota a confirmar na Prefeitura (3% usado como teto)"],
};
const ITBI_PADRAO = [0.03, "Alíquota local não confirmada: 3% usado como teto conservador"];

export function aliquotaItbi(uf, cidade) {
  const chave = String(cidade || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ITBI_CONHECIDO[chave] || ITBI_CONHECIDO[String(uf || "").toUpperCase()] || ITBI_PADRAO;
}

export function premissas(p) {
  return {
    tipo: "apartamento", formaPagamento: "financiado",
    entradaPct: 0.05,           // entrada mínima informada pela CAIXA para SBPE
    jurosSeguroMes: 0.010,      // juros + seguros sobre o saldo financiado
    itbiAliquota: 0.03,
    registroPct: 0.015, registroFixo: 600,
    tarifasBanco: 1500,         // só financiado
    comissaoLeiloeiroPct: 0,    // venda online CAIXA não cobra; leilão costuma cobrar 5%
    condominioMes: 300, iptuMes: 50,
    corretagemPct: 0.05, irGanhoPct: 0.15,
    contingenciaPct: 0.05,      // sobre lance + reforma
    ocupacao: "desconhecido",
    reformaInformada: null, debitosInformados: null,
    ...p,
  };
}

export function calcular(p, cenario, valorVenda = null, preco = null) {
  const s = PREMISSAS_CENARIO[cenario];
  const P = preco ?? p.preco;
  const V = valorVenda ?? { conservador: p.valorConservador, base: p.valorBase, otimista: p.valorOtimista }[s.valor];
  const meses = s.meses;
  const financiado = p.formaPagamento === "financiado";

  const entrada = P * (financiado ? p.entradaPct : 1);
  const saldo = P - entrada;
  const comissao = P * p.comissaoLeiloeiroPct;
  const itbi = P * p.itbiAliquota;
  const registro = P * p.registroPct + p.registroFixo;
  const tarifas = financiado ? p.tarifasBanco : 0;
  const juros = saldo * p.jurosSeguroMes * meses;
  const carregamento = (p.condominioMes + p.iptuMes) * meses;
  const debitos = p.debitosInformados ?? s.debitosPct * p.avaliacao;
  const reforma = p.reformaInformada ?? s.reforma[p.tipo];
  const desocupacao = (DESOCUPACAO[p.ocupacao] || DESOCUPACAO.desconhecido)[CENARIOS.indexOf(cenario)];
  const contingencia = p.contingenciaPct * (P + reforma);
  const corretagem = p.corretagemPct * V;
  const ganho = V - corretagem - (P + comissao + itbi + registro + reforma);
  const ir = Math.max(0, p.irGanhoPct * ganho);

  const composicao = {
    "Lance": P, "Comissão do leiloeiro": comissao, "ITBI": itbi, "Registro e certidões": registro,
    "Tarifas bancárias": tarifas, "Juros e seguros": juros, "Condomínio e IPTU até a venda": carregamento,
    "Débitos assumidos": debitos, "Reforma": reforma, "Desocupação": desocupacao, "Contingência": contingencia,
    "Corretagem na venda": corretagem, "IR sobre o ganho": ir,
  };
  const custoTotal = Object.values(composicao).reduce((a, b) => a + b, 0);
  const lucro = V - custoTotal;
  const capitalAssinatura = entrada + comissao + itbi + registro + tarifas;
  const caixaAteRevenda = juros + carregamento + debitos + reforma + desocupacao + contingencia;
  const capitalNecessario = capitalAssinatura + caixaAteRevenda;
  return {
    cenario, valorVenda: V, preco: P, meses, reforma, custoTotal, lucro, margem: V ? lucro / V : 0,
    capitalAssinatura, caixaAteRevenda, capitalNecessario,
    roiCapital: capitalNecessario ? lucro / capitalNecessario : 0, composicao,
  };
}

// Maior lance em [0, valor conservador] que satisfaz a condição (monótona decrescente no lance).
function maiorPreco(p, condicao) {
  let lo = 0, hi = p.valorConservador;
  if (!condicao(lo)) return 0;
  for (let i = 0; i < 60; i++) {
    const meio = (lo + hi) / 2;
    if (condicao(meio)) lo = meio; else hi = meio;
  }
  return lo;
}

/**
 * Faixa de lance máximo.
 * - pelaMargem: margem mínima no valor conservador com custos BASE (topo da faixa).
 * - pelaMargemEstresse: idem com custos ESTRESSE (piso da faixa).
 * - peloCapital: maior lance cujo capital necessário (BASE) cabe no capital do usuário.
 *   Fica fora da faixa: quando é menor, vira trava de capital, não um lance "recomendado".
 */
export function lanceMaximo(p, margemMinima, capitalDisponivel = null) {
  const base = maiorPreco(p, (P) => calcular(p, "BASE", p.valorConservador, P).margem >= margemMinima);
  const estresse = maiorPreco(p, (P) => calcular(p, "ESTRESSE", p.valorConservador, P).margem >= margemMinima);
  const capital = capitalDisponivel === null ? null
    : maiorPreco(p, (P) => calcular(p, "BASE", p.valorConservador, P).capitalNecessario <= capitalDisponivel);
  return { pelaMargem: base, pelaMargemEstresse: estresse, peloCapital: capital,
    faixaMin: Math.min(estresse, base), faixaMax: base };
}

export function analisar(p, margemMinima, capitalDisponivel) {
  const cenarios = Object.fromEntries(CENARIOS.map((c) => [c, calcular(p, c)]));
  return {
    cenarios,
    conservadorBase: calcular(p, "BASE", p.valorConservador),
    descontoReal: p.valorConservador ? 1 - cenarios.BASE.custoTotal / p.valorConservador : null,
    lanceMaximo: lanceMaximo(p, margemMinima, capitalDisponivel),
    pontoEquilibrio: maiorPreco(p, (P) => calcular(p, "BASE", p.valorConservador, P).lucro >= 0),
    premissas: p,
  };
}
