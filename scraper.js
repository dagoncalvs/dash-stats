/**
 * AIWebPush Campaign Scraper
 *
 * Variáveis de ambiente necessárias:
 *   AIWEBPUSH_EMAIL    - seu e-mail de login
 *   AIWEBPUSH_PASSWORD - sua senha
 *   AIWEBPUSH_SITE     - domínio do site (ex: recommendcentral.com)
 *   TARGET_DATE        - (opcional) data no formato YYYY-MM-DD; padrão = ontem
 */

const { chromium } = require('playwright');

function getTargetDate() {
  if (process.env.TARGET_DATE) return process.env.TARGET_DATE;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function parseNumber(str) {
  if (!str || str.trim() === '-' || str.trim() === '0') return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

(async () => {
  const email    = process.env.AIWEBPUSH_EMAIL;
  const password = process.env.AIWEBPUSH_PASSWORD;
  const site     = process.env.AIWEBPUSH_SITE;
  const target   = getTargetDate();

  if (!email || !password) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: 'AIWEBPUSH_EMAIL e AIWEBPUSH_PASSWORD são obrigatórios',
    }));
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });

    context.setDefaultNavigationTimeout(60000);
    context.setDefaultTimeout(60000);

    const page = await context.newPage();

    // ── 1. Login ────────────────────────────────────────────────────────────
    process.stderr.write('[1/5] Abrindo página de login...\n');
    await page.goto('https://app.aiwebpush.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Angular precisa de tempo para renderizar os componentes
    await page.waitForTimeout(3000);

    process.stderr.write('[2/5] Preenchendo credenciais...\n');
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail"]', email);
    await page.fill('input[type="password"], input[name="password"], input[placeholder*="senha"]', password);

    // Botão "Acessar" do Angular Material — não tem type="submit"
    process.stderr.write('[2/5] Clicando em Acessar...\n');
    await page.click('button[color="primary"], button:has-text("Acessar")');

    await page.waitForURL(/app\.aiwebpush\.com\/(?!login)/, { timeout: 30000 });
    process.stderr.write('[3/5] Login OK. Navegando para campanhas...\n');

    // ── 2. Campanhas ─────────────────────────────────────────────────────────
    await page.goto('https://app.aiwebpush.com/my-campaigns', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    // ── 3. Seleciona o site ───────────────────────────────────────────────────
    if (site) {
      const siteSelector = await page.$(
        'select, [role="combobox"], [class*="site-select"], [class*="siteSelect"], mat-select'
      );
      if (siteSelector) {
        await siteSelector.click();
        await page.waitForTimeout(1000);
        const option = await page.locator(`[role="option"]:has-text("${site}")`).first();
        if (await option.isVisible()) {
          await option.click();
        } else {
          await page.selectOption('select', { label: site });
        }
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      }
    }

    // ── 4. Scraping paginado ──────────────────────────────────────────────────
    process.stderr.write('[4/5] Coletando campanhas...\n');
    const campaigns = [];
    let currentPage = 1;
    let foundOlderDate = false;

    while (!foundOlderDate) {
      // Aguarda as mat-rows da tabela Angular carregarem
      await page.waitForSelector('mat-row', { timeout: 30000 });
      await page.waitForTimeout(1500);

      const items = await page.evaluate((targetDate) => {
        const results = [];
        const seen = new Set();

        // Cada campanha é uma mat-row na tabela Angular Material
        const rows = document.querySelectorAll('mat-row');

        rows.forEach(row => {
          const text = row.innerText || '';

          // ── Data ────────────────────────────────────────────────────
          const dateMatch = text.match(/Envio[:\s]+(\d{2}\/\d{2}\/\d{4})/);
          if (!dateMatch) return;
          const [day, month, year] = dateMatch[1].split('/');
          const isoDate = `${year}-${month}-${day}`;

          // ── Nome (primeiro link ou célula de nome) ──────────────────
          const nameEl = row.querySelector('mat-cell a, .campaign-name, mat-cell h3, mat-cell h4');
          const name = nameEl ? nameEl.textContent.trim() : text.split('\n')[0].trim();

          // Deduplicação por nome + data
          const key = `${isoDate}:${name}`;
          if (seen.has(key)) return;
          seen.add(key);

          // ── Status ──────────────────────────────────────────────────
          const statusEl = row.querySelector('[class*="badge"], [class*="chip"], [class*="status"]');
          const status = statusEl ? statusEl.textContent.trim() : '';

          // ── Métricas via .metric > .metric-value + .metric-label ────
          // Estrutura confirmada pelo HTML real da plataforma:
          // <div class="metric">
          //   <span class="metric-value">2345</span>
          //   <span class="metric-label">Enviados</span>
          // </div>
          let enviados = '0', impressoes = '0', clicks = '0', ctr = '0', its = '0';

          row.querySelectorAll('.metric').forEach(metric => {
            const value = metric.querySelector('.metric-value')?.textContent.trim() || '0';
            const label = (metric.querySelector('.metric-label')?.textContent.trim() || '').toLowerCase();

            if (label.includes('enviado'))      enviados   = value;
            else if (label.includes('impres'))  impressoes = value;
            else if (label === 'clicks')        clicks     = value;
            else if (label === 'ctr')           ctr        = value;
            else if (label === 'its')           its        = value;
          });

          results.push({ isoDate, name, status, enviados, impressoes, clicks, ctr, its });
        });

        return results;
      }, target);

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
          foundOlderDate = true;
        }
      }

      if (foundOlderDate) break;

      const nextBtn = await page.$(
        '[aria-label="next"], [aria-label="Próxima"], button:has-text("›"), button:has-text("→"), [class*="next"]:not([disabled])'
      );
      if (!nextBtn) break;

      const isDisabled = await nextBtn.evaluate(el =>
        el.disabled ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.classList.contains('disabled')
      );
      if (isDisabled) break;

      await nextBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      currentPage++;
      if (currentPage > 20) break;
    }

    // ── 5. Saída ──────────────────────────────────────────────────────────────
    process.stderr.write(`[5/5] Concluído. ${campaigns.length} campanha(s) encontrada(s).\n`);
    process.stdout.write(JSON.stringify({
      success:    true,
      targetDate: target,
      site:       site || 'todos',
      count:      campaigns.length,
      campaigns,
    }, null, 2));

  } catch (err) {
    process.stdout.write(JSON.stringify({
      success: false,
      error:   err.message,
      stack:   err.stack,
    }));
  } finally {
    if (browser) await browser.close();
  }
})();