/**
 * AIWebPush Campaign Scraper
 * 
 * Uso: node scraper.js
 * 
 * Variáveis de ambiente necessárias:
 *   AIWEBPUSH_EMAIL    - seu e-mail de login
 *   AIWEBPUSH_PASSWORD - sua senha
 *   AIWEBPUSH_SITE     - domínio do site (ex: recommendcentral.com)
 *   TARGET_DATE        - (opcional) data no formato YYYY-MM-DD; padrão = ontem
 * 
 * Saída: JSON no stdout com as campanhas encontradas
 */

const { chromium } = require('playwright');

// ─── Helpers ────────────────────────────────────────────────────────────────

function getTargetDate() {
  if (process.env.TARGET_DATE) return process.env.TARGET_DATE;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function parseBrDate(str) {
  // Aceita "27/04/2026 19:08" ou "27/04/2026"
  const [datePart] = str.trim().split(' ');
  const [day, month, year] = datePart.split('/');
  return `${year}-${month}-${day}`;
}

function parseNumber(str) {
  if (!str || str.trim() === '-') return 0;
  // Remove separadores de milhar (ponto) e troca vírgula por ponto para decimais
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const email    = process.env.AIWEBPUSH_EMAIL;
  const password = process.env.AIWEBPUSH_PASSWORD;
  const site     = process.env.AIWEBPUSH_SITE;
  const target   = getTargetDate();

  if (!email || !password) {
    process.stderr.write('Erro: AIWEBPUSH_EMAIL e AIWEBPUSH_PASSWORD são obrigatórios\n');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await context.newPage();

  try {
    // ── 1. Login ─────────────────────────────────────────────────────────────
    await page.goto('https://app.aiwebpush.com/login', { waitUntil: 'networkidle' });

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Aguarda redirecionamento pós-login
    await page.waitForURL(/app\.aiwebpush\.com\/(?!login)/, { timeout: 15000 });

    // ── 2. Navega para campanhas ──────────────────────────────────────────────
    await page.goto('https://app.aiwebpush.com/my-campaigns', { waitUntil: 'networkidle' });

    // ── 3. Seleciona o site correto (se houver seletor) ───────────────────────
    if (site) {
      // Aguarda o seletor de site aparecer
      const siteSelector = await page.$('select, [role="combobox"], [class*="site-select"], [class*="siteSelect"]');
      if (siteSelector) {
        // Tenta clicar e selecionar o site
        await siteSelector.click();
        await page.waitForTimeout(500);

        // Procura a opção com o texto do site
        const option = await page.locator(`[role="option"]:has-text("${site}")`).first();
        if (await option.isVisible()) {
          await option.click();
        } else {
          // Fallback: select nativo
          await page.selectOption('select', { label: site });
        }
        await page.waitForLoadState('networkidle');
      }
    }

    // ── 4. Coleta campanhas paginando ─────────────────────────────────────────
    const campaigns = [];
    let currentPage = 1;
    let foundOlderDate = false;

    while (!foundOlderDate) {
      // Aguarda os cards de campanha carregarem
      await page.waitForSelector('[class*="campaign"], [class*="Campaign"]', { timeout: 10000 });
      await page.waitForTimeout(800); // pequena pausa para dados renderizarem

      // ── Extrai todos os itens da página atual ──────────────────────────────
      const items = await page.evaluate((targetDate) => {
        const results = [];

        // Seletores candidatos para o container de cada campanha
        const cards = document.querySelectorAll(
          '[class*="campaign-item"], [class*="campaignItem"], [class*="campaign-card"], [class*="campaignCard"], .campaign-row, [class*="CampaignItem"]'
        );

        cards.forEach(card => {
          const text = card.innerText || '';

          // ── Data de envio ──────────────────────────────────────────────────
          // Procura padrões como "Envio: 27/04/2026 19:11"
          const dateMatch = text.match(/Envio[:\s]+(\d{2}\/\d{2}\/\d{4})/);
          const rawDate = dateMatch ? dateMatch[1] : '';
          const [day, month, year] = rawDate ? rawDate.split('/') : ['', '', ''];
          const isoDate = rawDate ? `${year}-${month}-${day}` : '';

          if (!isoDate) return; // ignora cards sem data

          // ── Nome da campanha ───────────────────────────────────────────────
          const titleEl = card.querySelector('a, h3, h4, [class*="title"], [class*="name"]');
          const name = titleEl ? titleEl.textContent.trim() : 'Sem nome';

          // ── Status ─────────────────────────────────────────────────────────
          const statusEl = card.querySelector('[class*="status"], [class*="badge"], [class*="chip"]');
          const status = statusEl ? statusEl.textContent.trim() : '';

          // ── Métricas ───────────────────────────────────────────────────────
          // Coleta todos os números e seus rótulos
          const metricBlocks = card.querySelectorAll('[class*="metric"], [class*="stat"], [class*="number"]');
          let enviados = '', impressoes = '', clicks = '', ctr = '', its = '';

          // Tenta extrair pelos rótulos abaixo dos números
          const allText = Array.from(card.querySelectorAll('*'))
            .filter(el => el.children.length === 0)
            .map(el => el.textContent.trim())
            .filter(t => t.length > 0);

          for (let i = 0; i < allText.length; i++) {
            const val = allText[i];
            const label = (allText[i + 1] || '').toLowerCase();
            if (label.includes('enviado')) enviados = val;
            else if (label.includes('impressão') || label.includes('impressoe')) impressoes = val;
            else if (label === 'clicks' || label === 'cliques') clicks = val;
            else if (label === 'ctr') ctr = val;
            else if (label === 'its') its = val;
          }

          results.push({ isoDate, name, status, enviados, impressoes, clicks, ctr, its });
        });

        return results;
      }, target);

      // ── Filtra e classifica ────────────────────────────────────────────────
      for (const item of items) {
        if (item.isoDate === target) {
          campaigns.push({
            data:       item.isoDate,
            campanha:   item.name,
            status:     item.status,
            enviados:   parseNumber(item.enviados),
            impressoes: parseNumber(item.impressoes),
            clicks:     parseNumber(item.clicks),
            ctr:        parseNumber(item.ctr),
            its:        parseNumber(item.its),
          });
        } else if (item.isoDate < target) {
          // Chegou em data anterior — inutile paginar mais
          foundOlderDate = true;
        }
      }

      // ── Próxima página ─────────────────────────────────────────────────────
      if (foundOlderDate) break;

      const nextBtn = await page.$(
        '[aria-label="next"], [aria-label="Próxima"], button:has-text("›"), button:has-text("→"), [class*="next"]:not([disabled])'
      );
      if (!nextBtn) break;

      const isDisabled = await nextBtn.evaluate(el =>
        el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')
      );
      if (isDisabled) break;

      await nextBtn.click();
      await page.waitForLoadState('networkidle');
      currentPage++;

      // Segurança: não paginamos mais de 20 páginas
      if (currentPage > 20) break;
    }

    // ── 5. Saída ───────────────────────────────────────────────────────────────
    const output = {
      success:    true,
      targetDate: target,
      site:       site || 'todos',
      count:      campaigns.length,
      campaigns,
    };

    process.stdout.write(JSON.stringify(output, null, 2));

  } catch (err) {
    process.stdout.write(JSON.stringify({
      success: false,
      error:   err.message,
      stack:   err.stack,
    }));
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
