# Imagem oficial do Playwright: Node 22 e Chromium já instalados, na mesma versão do package-lock.
# No container não há Edge nem Chrome do Windows, então a coleta usa o Chromium do Playwright.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NAVEGADOR_CANAL= \
    ANALISTA_DADOS=/dados \
    PORT=8765

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY views ./views

# Usuário sem privilégios (já existe na imagem do Playwright).
RUN mkdir -p /dados && chown pwuser:pwuser /dados
USER pwuser

EXPOSE 8765
VOLUME ["/dados"]
CMD ["node", "src/servidor.js"]
