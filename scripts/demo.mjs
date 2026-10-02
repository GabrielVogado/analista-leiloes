// Gera uma análise de exemplo em dados/analises/ sem rede e sem chave de IA, para ver o layout.
// Usa a página CAIXA de Samambaia salva em 01/10/2026, a certidão sintética e respostas de IA simuladas
// (marcadas como exemplo no próprio resultado). Rodar: npm run demo
import { executar, novoId } from "../src/pipeline.js";
import { HOJE, IA_DILIGENCIA, coletaSamambaia, entrada } from "../test/apoio.js";

const iaMercado = async () => ({
  comparaveis: [
    { descricao: "EXEMPLO: apto 2 quartos, QR 410", fonte: "DFimóveis", url: "https://www.dfimoveis.com.br/", data: "09/2026", areaM2: 48, preco: 215000, tipoPreco: "pedido" },
    { descricao: "EXEMPLO: apto 2 quartos, QR 408", fonte: "OLX", url: "https://www.olx.com.br/", data: "09/2026", areaM2: 50, preco: 220000, tipoPreco: "pedido" },
    { descricao: "EXEMPLO: apto 2 quartos, QR 412", fonte: "ZAP", url: "https://www.zapimoveis.com.br/", data: "09/2026", areaM2: 47, preco: 205000, tipoPreco: "pedido" },
  ],
  conservador: 200000, base: 215000, otimista: 235000, confianca: "média",
  metodo: "EXEMPLO de layout: comparáveis fictícios, não use para decidir.", liquidezNota: 9,
  liquidezTexto: "Exemplo", aluguelEstimado: 1200, condominioMensalEstimado: 250,
});

const comIa = await executar(novoId(), entrada(), {
  coletaPronta: coletaSamambaia(), hoje: HOJE, iaDiligencia: async () => IA_DILIGENCIA, iaMercado });
const semIa = await executar(novoId(), entrada(false), { coletaPronta: coletaSamambaia(), hoje: HOJE });
for (const r of [comIa, semIa]) console.log(`${r.decisao} (nota ${r.nota}): http://localhost:8765/analises/${r.id}`);
