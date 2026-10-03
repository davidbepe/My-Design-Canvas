// Popup: pilih apa yang ditangkap dan ke mana hasilnya, lalu serahkan ke background.js.
const $ = (id) => document.getElementById(id);
const DEFAULTS = { server: 'http://localhost:3333', mode: 'copy' };

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(['server', 'mode'])) };
  $('server').value = s.server;
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === s.mode;
  checkServer(s.server);
}

async function checkServer(server) {
  const status = $('status');
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/api/artboards`);
    if (!res.ok) throw new Error();
    status.textContent = 'Kanvas terhubung';
    status.className = 'status ok';
  } catch {
    status.textContent = 'Kanvas tidak berjalan';
    status.className = 'status off';
  }
}

for (const r of document.querySelectorAll('input[name="mode"]')) {
  r.addEventListener('change', () => chrome.storage.sync.set({ mode: r.value }));
}
$('server').addEventListener('change', () => {
  const server = $('server').value.trim() || DEFAULTS.server;
  chrome.storage.sync.set({ server });
  checkServer(server);
});

async function start(what) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: 'start', what, tabId: tab.id });
  if (!res?.ok) {
    $('status').textContent = 'Halaman ini tidak bisa ditangkap (mis. chrome:// atau Web Store)';
    $('status').className = 'status off';
    return;
  }
  window.close(); // tutup popup supaya halaman bisa diklik
}

$('pick').addEventListener('click', () => start('pick'));
$('page').addEventListener('click', () => start('page'));
load();
