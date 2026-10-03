// Design Canvas Capture: menyuntikkan penangkap ke tab, dan mengirim hasilnya ke server kanvas.
// Pengiriman dilakukan di sini (bukan di halaman), karena extension boleh menghubungi localhost
// berkat host_permissions, sedangkan halaman web biasa diblokir browser.

const DEFAULTS = { server: 'http://localhost:3333', mode: 'copy' };

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(['server', 'mode'])) };
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['capture.js'] });
}

// Dari popup: { type: 'start', what: 'pick' | 'page', tabId }
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'start') {
    (async () => {
      try {
        const { mode } = await settings();
        await inject(msg.tabId);
        await chrome.tabs.sendMessage(msg.tabId, { type: msg.what === 'page' ? 'dc-page' : 'dc-pick', mode });
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true; // balasan async
  }
  if (msg.type === 'dc-send') {
    sendToCanvas(msg, sender.tab?.id);
  }
  return false;
});

// Shortcut Alt+Shift+D: langsung mulai memilih elemen di tab aktif.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'pick-element' || !tab?.id) return;
  const { mode } = await settings();
  await inject(tab.id);
  await chrome.tabs.sendMessage(tab.id, { type: 'dc-pick', mode });
});

async function sendToCanvas({ html, width, height, name }, tabId) {
  const { server } = await settings();
  let text;
  let error = false;
  try {
    const res = await fetch(`${server.replace(/\/$/, '')}/api/artboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, width, height, html }),
    });
    if (!res.ok) throw new Error(`server menjawab ${res.status}`);
    const created = await res.json();
    text = `Terkirim ke Design Canvas sebagai frame "${created.name}".`;
  } catch (err) {
    error = true;
    text = `Gagal mengirim: kanvas tidak berjalan di ${server}? (${err.message})`;
  }
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'dc-toast', text, error });
}
