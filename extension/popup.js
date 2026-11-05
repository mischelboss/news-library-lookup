async function refresh() {
  const state = await browser.runtime.sendMessage({ type: 'status' });
  document.getElementById('status').textContent = `${state.enabled ? 'Enabled' : 'Paused'} · ${state.pending} pending · ${state.cached} cached. ${state.status}`;
  document.getElementById('toggle').textContent = state.enabled ? 'Pause checks' : 'Enable checks';
}
const act = type => async () => { await browser.runtime.sendMessage({ type }); await refresh(); };
document.getElementById('toggle').addEventListener('click', act('toggle'));
document.getElementById('retry').addEventListener('click', act('retry'));
document.getElementById('reset').addEventListener('click', act('reset'));
refresh().catch(() => { document.getElementById('status').textContent = 'Background unavailable. Inspect the extension in about:debugging.'; });
