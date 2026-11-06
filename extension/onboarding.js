const GENIOS = { origins: ['https://bib-voebb.genios.de/*'] };

async function refresh() {
  const granted = await browser.permissions.contains(GENIOS);
  document.getElementById('access').textContent = granted ? 'Access to VÖBB Genios is allowed.' : 'Access to VÖBB Genios is not allowed yet. Without it, no badges can be checked.';
  document.getElementById('grant').hidden = granted;
}

document.getElementById('grant').addEventListener('click', async () => {
  try { await browser.permissions.request(GENIOS); } catch { /* declined or unavailable; the status below says so */ }
  await refresh();
});

refresh().catch(() => { document.getElementById('access').textContent = 'Could not check access. Open the extension’s permissions in about:addons.'; });
