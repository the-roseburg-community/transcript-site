/* ==== KEYWORDS ==== */
const keywordsRed    = ["commercial fire","cover fire","flue fire","structure fire","urgent","smoke","accident","grass fire","burn","vehicle fire","mva","nva ","mba ","explosion","gunshot"].map(s=>s.toLowerCase());
const keywordsYellow = ["medical aid","mutual aid","flood","power outage","road closure","water rescue"].map(s=>s.toLowerCase());
const keywordsOrange = ["fire alarm","fire investigation"].map(s=>s.toLowerCase());

/* ==== POLLING CONTROL ==== */
const POLL_MS = 15000;
let inFlight = false;
let aborter  = null;
let lastRenderedIds = "";
let pollTimer = null;

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
    pollTimer = null;
  } else {
    runPoll();
  }
});

/* ==== HELPERS ==== */
function escHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function highlightText(text) {
  const sets = [
    {list: keywordsRed,    cls: 'keyword-red'},
    {list: keywordsYellow, cls: 'keyword-yellow'},
    {list: keywordsOrange, cls: 'keyword-orange'},
  ];
  let html = escHtml(text);
  for (const {list, cls} of sets) {
    for (const kw of list) {
      const t = kw.trim();
      if (!t) continue;
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      html = html.replace(re, `<span class="${cls}">$1</span>`);
    }
  }
  return html;
}

function parseDateFromFilename(fn) {
  try {
    const p = fn.replace('.json', '').split('_');
    if (p.length < 3) return null;
    return new Date(Date.UTC(
      +p[1].slice(0,4), +p[1].slice(4,6)-1, +p[1].slice(6,8),
      +p[2].slice(0,2), +p[2].slice(2,4),   +p[2].slice(4,6)
    ));
  } catch { return null; }
}

function getDateUrls() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth()+1, d = now.getUTCDate();
  const yst = new Date(now.getTime() - 86400000);
  const yy = yst.getUTCFullYear(), ym = yst.getUTCMonth()+1, yd = yst.getUTCDate();
  return [
    `https://archive.theroseburgreceiver.com/fire2/${y}/${m}/${d}/`,
    `https://archive.theroseburgreceiver.com/fire2/${yy}/${ym}/${yd}/`,
  ];
}

async function fetchDirectoryFiles(baseUrl, signal) {
  const r = await fetch(baseUrl, {signal});
  if (!r.ok) return [];
  const text = await r.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const links = Array.from(doc.querySelectorAll('a'))
    .map(a => a.getAttribute('href'))
    .filter(h => h && h.endsWith('.json'))
    .map(filename => ({url: baseUrl + filename, filename}));
  doc.body.innerHTML = '';
  return links;
}

async function fetchTranscriptsOnce() {
  if (inFlight) return;
  inFlight = true;
  if (aborter) { try { aborter.abort(); } catch {} }
  aborter = new AbortController();
  const {signal} = aborter;

  try {
    const lists = await Promise.allSettled(getDateUrls().map(b => fetchDirectoryFiles(b, signal)));
    let files = [];
    for (const res of lists) {
      if (res.status === 'fulfilled') files = files.concat(res.value);
    }
    files = files
      .filter(f => parseDateFromFilename(f.filename))
      .sort((a,b) => parseDateFromFilename(b.filename) - parseDateFromFilename(a.filename))
      .slice(0, 50);

    const idKey = files.map(f => f.filename).join(',');
    if (idKey === lastRenderedIds) return;

    const limit = 6;
    const out = [];
    let i = 0;

    async function worker() {
      while (i < files.length) {
        const idx = i++;
        const f = files[idx];
        try {
          const r = await fetch(f.url, {signal});
          if (!r.ok) continue;
          const json = await r.json();
          const raw = json?.transcript?.transcript || 'No transcript available';
          const noAudio = /Thanks\s*for\s*watching|Thank\s*you\s*for\s*watching/gi.test(raw);
          const safe = noAudio ? '-- FIRE TONE OR NO AUDIO --' : raw;

          const ds = f.filename.split('_')[1];
          const ts = f.filename.split('_')[2].slice(0, 6);
          const utc = new Date(Date.UTC(
            +ds.slice(0,4), +ds.slice(4,6)-1, +ds.slice(6,8),
            +ts.slice(0,2), +ts.slice(2,4),   +ts.slice(4,6)
          ));

          const base = f.url.substring(0, f.url.lastIndexOf('/') + 1);
          const low = safe.toLowerCase();
          out[idx] = {
            time:           timeFmt.format(utc),
            transcriptHtml: highlightText(safe),
            mp3Link:        `${base}${f.filename.replace('.json', '.mp3')}`,
            color:          keywordsRed.find(k=>low.includes(k)) ? 'red'
                          : keywordsYellow.find(k=>low.includes(k)) ? 'yellow'
                          : keywordsOrange.find(k=>low.includes(k)) ? 'orange' : '',
          };
        } catch { /* ignore per-file errors */ }
      }
    }

    await Promise.all(Array.from({length: limit}, worker));
    const items = out.filter(Boolean);
    if (items.length) {
      renderTranscripts(items);
      lastRenderedIds = idKey;
      updateLastUpdated();
    }
  } finally {
    inFlight = false;
  }
}

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function renderTranscripts(items) {
  const container   = document.getElementById('transcripts');
  const audioPlayer = document.getElementById('audioPlayer');
  const audioSource = document.getElementById('audioSource');
  if (!container) return;

  const frag = document.createDocumentFragment();
  for (const {time, transcriptHtml, mp3Link, color} of items) {
    const div = document.createElement('div');
    div.className = 'transcript';
    if (color === 'red')         div.classList.add('highlight-red');
    else if (color === 'yellow') div.classList.add('highlight-yellow');
    else if (color === 'orange') div.classList.add('highlight-orange');

    const timeSpan = document.createElement('span');
    timeSpan.className = 'tx-time';
    timeSpan.textContent = `${time}: `;
    div.appendChild(timeSpan);

    const textSpan = document.createElement('span');
    textSpan.innerHTML = transcriptHtml;
    div.appendChild(textSpan);

    const listen = document.createElement('a');
    listen.href = '#';
    listen.textContent = '▶ Listen';
    listen.className = 'listen-btn';
    listen.addEventListener('click', e => {
      e.preventDefault();
      if (!audioPlayer || !audioSource) return;
      audioSource.src = mp3Link;
      audioPlayer.load();
      audioPlayer.play().catch(() => {});
    });
    div.appendChild(listen);

    const copyIcon = document.createElement('span');
    copyIcon.textContent = '📋';
    copyIcon.className = 'copy-icon';

    const tooltip = document.createElement('span');
    tooltip.className = 'tooltip';
    tooltip.textContent = 'Copied!';
    copyIcon.appendChild(tooltip);

    copyIcon.addEventListener('click', () => {
      const plain = transcriptHtml.replace(/<[^>]+>/g, '');
      navigator.clipboard.writeText(plain).then(() => {
        tooltip.style.visibility = 'visible';
        tooltip.style.opacity = '1';
        setTimeout(() => {
          tooltip.style.visibility = 'hidden';
          tooltip.style.opacity = '0';
        }, 1500);
      }).catch(() => {});
    });

    div.appendChild(copyIcon);
    frag.appendChild(div);
  }
  container.replaceChildren(frag);
}

async function runPoll() {
  await fetchTranscriptsOnce();
  if (!document.hidden) {
    pollTimer = setTimeout(runPoll, POLL_MS);
  }
}

runPoll();
