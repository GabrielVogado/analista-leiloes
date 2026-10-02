# Analista de Leilões

Plataforma web que analisa imóveis de leilão: hierarquia de fontes, etiquetas de evidência (CONFIRMADO, ESTIMADO,
INFERIDO, CONFLITANTE, NÃO ENCONTRADO), diligência de edital, matrícula, processo, ocupação e débitos, comparáveis,
custo total em três cenários, nota de 0 a 100, travas e uma de quatro decisões: AVANÇAR À DILIGÊNCIA, MONITORAR,
NÃO PARTICIPAR ou DADOS INSUFICIENTES. O resultado sai num dashboard em HTML único, que também pode ser baixado.

É um filtro financeiro e documental. Não substitui advogado, avaliador ou vistoria, não garante lucro, desocupação ou
ausência de dívidas, e nunca dá lance nem faz pagamento.

## Como rodar

Requisitos: Node 22 ou mais novo e Microsoft Edge ou Google Chrome instalados (o Playwright usa o navegador do Windows).

```bash
npm install
```

```bash
npm start
```

Abra http://localhost:8765.

### Ver o layout sem chave e sem rede

```bash
npm run demo
```

Grava duas análises de exemplo (CAIXA Samambaia, com e sem IA simulada, comparáveis fictícios) em `dados/` e mostra os
links. Rode `npm start` e abra os links, ou a lista "Análises recentes" na tela inicial.

### IA gratuita (Gemini)

Para os primeiros testes a plataforma usa o plano gratuito do Gemini, que lê PDF escaneado (o caso da matrícula) e
pesquisa comparáveis com a busca do Google. Crie uma chave em https://aistudio.google.com/apikey e defina a variável
de ambiente (a chave nunca vai para arquivo do projeto):

```bash
setx GEMINI_API_KEY "sua-chave"
```

Abra um terminal novo e rode `npm start` de novo. Sem a chave, a coleta, as regras e as contas funcionam; o valor de
mercado vira 75%, 85% e 95% da avaliação (ESTIMADO, confiança baixa) e a matrícula escaneada fica como não lida, o que
aciona trava documental. O plano gratuito tem limite diário de chamadas; ao atingir, a análise segue sem IA e avisa.

## O que acontece numa análise

1. **Identificação**: extrai o número do imóvel CAIXA do link (CAIXA, leilaoimovel ou outro portal que traga o número).
2. **Coleta**: abre a página do lote no navegador, lê preço, avaliação, áreas, matrícula, ofício, formas de pagamento,
   regras de condomínio e tributos e observações (ex.: "gravame/penhora/indisponibilidade averbada"), e tenta baixar
   os PDFs que a página oferece.
3. **Bloqueios**: se o site responde com CAPTCHA ou verificação antibot (Radware na CAIXA, Cloudflare em portais), a
   fonte entra como bloqueada e a análise segue com o que existe. Não há tentativa de contornar a verificação. Nesse
   caso, cole o texto da página no formulário (Ctrl+A, Ctrl+C) e envie o PDF da matrícula. CENPROT e Justiça Federal
   exigem CAPTCHA e aparecem sempre como NÃO ENCONTRADO, para consulta manual.
4. **PDFs**: extrai o texto. A data da certidão e a validade de 30 dias são conferidas no texto.
5. **Regras sem IA** (`src/analise/regras.js`): ônus declarados pelo banco, ocupação, ação judicial, regras de débitos,
   certidão vencida.
6. **IA** (`src/analise/ia.js`): lê página, edital e matrícula e devolve fatos etiquetados com fonte e trecho, ônus (com
   cancelamento), ocupação, processos, débitos, riscos e divergências; pesquisa 3 a 8 comparáveis e devolve os valores
   conservador, base e otimista. As contas não ficam com a IA.
7. **Contas em código** (`src/analise/financeiro.js`): custo total, três cenários, desconto real, ponto de equilíbrio e
   faixa de lance máximo. **Nota, travas e decisão** em `src/analise/nota.js`.

## Premissas (ESTIMADO, ajustáveis no formulário)

| Item | Otimista | Base | Estresse |
|---|---|---|---|
| Meses até vender | 7 | 10 | 16 |
| Reforma (apto / casa) | 6 mil / 8 mil | 12 mil / 15 mil | 20 mil / 25 mil |
| Débitos assumidos (% da avaliação) | 1% | 3% | 10% |
| Valor de venda | otimista | base | conservador |

Financiado: entrada de 5%, juros e seguros de 1% a.m. sobre o saldo, tarifas de R$ 1.500. Registro 1,5% + R$ 600.
Corretagem 5%, IR 15% sobre o ganho, contingência 5% de lance + reforma. ITBI: 2% no DF (conferir na SEEC-DF) e 3%
como teto quando a alíquota local não é conhecida. Comissão de leiloeiro: zero em venda online CAIXA, 5% em leilão.

O lance máximo é o maior lance em que a margem líquida, no valor **conservador** de venda, atinge a margem mínima do
perfil: com custos do cenário base (topo da faixa) e do estresse (piso da faixa).

## Testes

```bash
npm test
```

O caso de referência é o apartamento CAIXA 8555526095620, em Samambaia-DF: a análise manual deu NÃO PARTICIPAR, por
penhora averbada na matrícula e margem negativa no cenário base. Os testes rodam sem rede, com a página real salva em 01/10/2026
e uma certidão sintética (a certidão verdadeira tem dados pessoais e fica fora do repositório).

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `GEMINI_API_KEY` | — | Chave gratuita do Gemini (liga a leitura por IA) |
| `GEMINI_MODELO` | `gemini-3.8-flash` | Modelo que lê os documentos |
| `GEMINI_MODELO_BUSCA` | `gemini-2.5-flash` | Modelo da pesquisa de comparáveis (busca do Google gratuita só no 2.5) |
| `NAVEGADOR_CANAL` | `msedge` | `msedge`, `chrome` ou vazio para o Chromium do Playwright |
| `PORT` | `8765` | Porta do servidor |
| `ANALISTA_DADOS` | `./dados` | Onde ficam as análises e os PDFs |
