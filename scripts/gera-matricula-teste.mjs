// Gera test/fixtures/matricula_teste.pdf: um PDF sintético que imita a certidão
// escaneada de uma matrícula. Como na certidão real, o texto extraível traz só
// o selo e a certificação (os atos seriam imagem). Não contém dado pessoal:
// a certidão verdadeira não vai para o repositório.
import fs from "node:fs";

const PAGINAS = 4;
const rodape = (n) => [`Protocolo: 0000000  Atendente: ONR  Feita em: 10/04/2026 15:00:46  pgs.: ${n}/${PAGINAS}`];
const certificacao = [
  "CERTIFICO, nos termos do artigo 19 da lei 6.015/73, que a presente certidao de inteiro teor",
  "da matricula noticia todas as referencias relativas ao dominio. DOU FE. 10/04/2026 15:00:46.",
  "Esta certidao tem prazo de validade de 30 dias.",
];

const objetos = [];
const add = (corpo) => { objetos.push(corpo); return objetos.length; };
const catalogo = add("");            // 1
const paginas = add("");             // 2
const fonte = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const filhos = [];
for (let n = 1; n <= PAGINAS; n++) {
  const linhas = n === PAGINAS ? [...rodape(n), ...certificacao] : rodape(n);
  const fluxo = "BT /F1 9 Tf 40 60 Td 12 TL " + linhas.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ") + " ET";
  const conteudo = add(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
  filhos.push(add(`<< /Type /Page /Parent ${paginas} 0 R /MediaBox [0 0 595 842] /Contents ${conteudo} 0 R `
    + `/Resources << /Font << /F1 ${fonte} 0 R >> >> >>`));
}
objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${paginas} 0 R >>`;
objetos[paginas - 1] = `<< /Type /Pages /Kids [${filhos.map((f) => `${f} 0 R`).join(" ")}] /Count ${PAGINAS} >>`;

let pdf = "%PDF-1.4\n";
const offsets = [];
objetos.forEach((corpo, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
  + `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const destino = new URL("../test/fixtures/matricula_teste.pdf", import.meta.url);
fs.writeFileSync(destino, pdf, "latin1");
console.log(`gravado ${destino.pathname} (${pdf.length} bytes)`);
