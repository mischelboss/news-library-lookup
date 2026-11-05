async function refresh() {
  const state = await browser.runtime.sendMessage({ type: 'status' });
  document.getElementById('status').textContent = `${state.enabled ? 'Enabled' : 'Paused'} · ${state.pending} pending · ${state.cached} cached. ${state.status}`;
  document.getElementById('toggle').textContent = state.enabled ? 'Pause checks' : 'Enable checks';
}
document.getElementById('toggle').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'toggle' }); await refresh(); });
document.getElementById('reset').addEventListener('click', async () => { await browser.runtime.sendMessage({ type: 'reset' }); await refresh(); });
refresh().catch(() => { document.getElementById('status').textContent = 'Background unavailable. Inspect the extension in about:debugging.'; });
