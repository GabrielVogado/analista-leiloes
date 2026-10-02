// Gera o texto e os links da página CAIXA salva em 01/10/2026, como o navegador os vê.
import fs from "node:fs";
import { chromium } from "playwright";

const [, , htmlPath, destino] = process.argv;
const raw = fs.readFileSync(htmlPath, "utf8");
const b = await chromium.launch({ channel: "msedge" });
const pg = await b.newPage({ javaScriptEnabled: false });
await pg.setContent(raw, { waitUntil: "domcontentloaded" });
const texto = await pg.innerText("body");
const links = await pg.evaluate(() => Array.from(document.querySelectorAll("a")).map((a) => [
  (a.getAttribute("href") || "") + " " + (a.getAttribute("onclick") || ""), (a.innerText || "").trim()]));
await b.close();
fs.writeFileSync(`${destino}/caixa_8555526095620.txt`, texto, "utf8");
fs.writeFileSync(`${destino}/caixa_8555526095620.links.json`, JSON.stringify(links), "utf8");
console.log(texto.length, links.length);
