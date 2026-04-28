# AIWebPush → Google Sheets Bot

Coleta automaticamente as métricas de campanhas do dia anterior no AIWebPush e registra em uma planilha Google Sheets, rodando uma vez por dia via n8n.

---

## Pré-requisitos

- Node.js 18+ instalado no servidor onde o n8n roda
- n8n com acesso ao nó "Execute Command" habilitado
- Conta Google conectada no n8n (para o nó Google Sheets)

---

## 1. Instalar o scraper no servidor

```bash
# Cria a pasta (ajuste o caminho se quiser)
mkdir -p /opt/aiwebpush-bot
cd /opt/aiwebpush-bot

# Copia os arquivos scraper.js e package.json para esta pasta
# (ou clone seu repositório, se for usar Git)

npm install
npx playwright install chromium --with-deps
```

---

## 2. Testar o scraper manualmente

```bash
cd /opt/aiwebpush-bot

AIWEBPUSH_EMAIL="seu@email.com" \
AIWEBPUSH_PASSWORD="suasenha" \
AIWEBPUSH_SITE="recommendcentral.com" \
node scraper.js
```

A saída esperada é um JSON como:

```json
{
  "success": true,
  "targetDate": "2026-04-26",
  "site": "recommendcentral.com",
  "count": 2,
  "campaigns": [
    {
      "data": "2026-04-26",
      "campanha": "SHEIN Sale Alert!",
      "status": "PUBLICADO",
      "enviados": 2345,
      "impressoes": 466,
      "clicks": 2,
      "ctr": 0.43,
      "its": 19.87
    }
  ]
}
```

---

## 3. Configurar variáveis de ambiente no n8n

No painel do n8n, vá em **Settings → Environment Variables** e adicione:

| Variável             | Valor                     |
|----------------------|---------------------------|
| AIWEBPUSH_EMAIL      | seu@email.com             |
| AIWEBPUSH_PASSWORD   | suasenha                  |
| AIWEBPUSH_SITE       | recommendcentral.com      |

> ⚠️ Nunca coloque senha diretamente no workflow — sempre use variáveis de ambiente.

---

## 4. Preparar o Google Sheets

Crie uma planilha com duas abas:

**Aba "Campanhas"** — com os cabeçalhos na linha 1:
```
Data | Campanha | Status | Enviados | Impressões | Clicks | CTR (%) | ITS (%)
```

**Aba "Log"** — com os cabeçalhos:
```
Data | Mensagem
```

Copie o ID da planilha da URL:  
`https://docs.google.com/spreadsheets/d/**[ID_AQUI]**/edit`

---

## 5. Importar o workflow no n8n

1. No n8n, clique em **Workflows → Import from file**
2. Selecione o arquivo `n8n-workflow.json`
3. No nó **"Salvar no Google Sheets"** e no nó **"Log: sem campanhas"**, substitua `SEU_SPREADSHEET_ID_AQUI` pelo ID copiado no passo anterior
4. Configure a credencial Google Sheets nos dois nós (sua conta Google)
5. Salve e ative o workflow

---

## 6. Ajustar o caminho no nó "Executar Scraper"

No nó **"Executar Scraper"**, o comando padrão usa `/opt/aiwebpush-bot`.  
Se instalou em outro lugar, ajuste o caminho:

```
cd /SEU_CAMINHO/aiwebpush-bot && AIWEBPUSH_EMAIL={{ $env.AIWEBPUSH_EMAIL }} ...
```

---

## Agendamento

O workflow dispara todo dia às **8h (horário do servidor)**.  
Para mudar, edite o nó **"Todo dia às 8h"** e ajuste a expressão cron:

- `0 8 * * *`  → 8h todo dia
- `0 6 * * *`  → 6h todo dia
- `0 8 * * 1-5` → 8h apenas dias úteis

---

## Solução de problemas

**"Scraper retornou saída inválida"**  
→ Rode o scraper manualmente e veja o erro. Provavelmente é credencial errada ou mudança no HTML do painel.

**Nenhuma campanha encontrada**  
→ Verifique se havia campanhas enviadas no dia anterior. O log aparece na aba "Log" do Sheets.

**Erro de login**  
→ Confirme que as variáveis de ambiente estão corretas no n8n.

**Chromium não encontrado**  
→ Rode `npx playwright install chromium --with-deps` novamente no servidor.
