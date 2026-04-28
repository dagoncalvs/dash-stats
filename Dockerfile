FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install
COPY scraper.js ./

# Wrapper HTTP simples para expor o scraper como API
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]