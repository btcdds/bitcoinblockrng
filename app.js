'use strict';
/* Bitcoin Block RNG — app.js (robust v3)
 * Focused fixes:
 *  - Begin button reliably starts the flow; if "Use commit" is checked and no commit exists,
 *    the first click generates a commit string and asks you to click Begin again (explicit message).
 *  - Tip/ETA/Since pills update immediately and every minute. If the chosen provider fails,
 *    it automatically falls back to the other one.
 *  - Copy Short/Long proof work; Long proof optionally includes decimal hashes when checkbox is checked and K≥2.
 *  - Defensive guards so one error does not break the whole UI.
 *
 * Notes:
 *  - This file is a full replacement. It preserves your UI IDs and intended behavior.
 *  - Providers used: mempool.space and blockstream.info (Esplora). CORS-friendly.
 *  - Deterministic number draws with rejection sampling to avoid modulo bias.
 */

(function(){
  // ---------- Helpers ----------
  const qs  = (s, r=document) => r.querySelector(s);
  const on  = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);

  function toast(msg){ const s = qs('#status'); if (s) s.textContent = msg || ''; }

  function clampInt(x, lo, hi){
    const v = Number.isFinite(x) ? Math.floor(x) : lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function fmtDuration(seconds){
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s/60);
    const r = s % 60;
    return (m?`${m}m `:'') + `${r}s`;
  }

  function showCopyFallback(text){
    const wrap = qs('#copyFallbackWrap');
    const ta   = qs('#copyFallback');
    if (!wrap || !ta) return;
    ta.value = text || '';
    wrap.classList.remove('hidden');
    ta.focus();
    ta.select();
    toast('Copy failed; use manual copy box.');
  }

  // ---------- State ----------
  let lastTipHeight = null;
  let lastTipTimestampSec = null; // unix seconds
  let uiTicker = null;
  let metaTimer = null;

  let committed = null;        // { tipAtCommit, startHeight, K, providerName, hashes[], done }
  let commitPrepared = false;
  let waitController = null;   // { cancelled: boolean }

  // Expose for other modules (copy handlers, etc.)
  window.__BBRNG_LAST = null;  // { shortProof, longProof, committed }

  // ---------- Providers ----------
  const providers = {
    mempool: {
      code: 'mp',
      tipHeight: async () => fetchText('https://mempool.space/api/blocks/tip/height'),
      hashByHeight: async (h) => fetchText('https://mempool.space/api/block-height/' + h),
      block: async (hash) => fetchJson('https://mempool.space/api/block/' + hash),
    },
    blockstream: {
      code: 'bs',
      tipHeight: async () => fetchText('https://blockstream.info/api/blocks/tip/height'),
      hashByHeight: async (h) => fetchText('https://blockstream.info/api/block-height/' + h),
      block: async (hash) => fetchJson('https://blockstream.info/api/block/' + hash),
    }
  };

  async function fetchJson(url){
    const r = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  async function fetchText(url){
    const r = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.text();
  }

  // ---------- Tip/ETA/Since UI ----------
  function setTipState(height, timestampSec){
    lastTipHeight = Number(height);
    lastTipTimestampSec = Number(timestampSec) || null;
    const tipEl = qs('#tip');
    if (tipEl && Number.isFinite(lastTipHeight)){
      tipEl.textContent = 'Block #' + lastTipHeight.toLocaleString();
    }
  }

  async function updateTipMeta(){
    const sel = qs('#provider');
    const pref = sel ? sel.value : 'mempool';
    const primary = providers[pref] || providers.mempool;
    const secondary = (primary === providers.mempool) ? providers.blockstream : providers.mempool;

    // Try primary then fallback
    let prov = primary;
    for (let attempt = 0; attempt < 2; attempt++){
      try{
        const tipRaw = await prov.tipHeight();
        const tipH = parseInt((tipRaw || '').toString().trim(), 10);
        if (!Number.isFinite(tipH)) throw new Error('Bad tip height');
        const lastHashRaw = await prov.hashByHeight(tipH);
        const lastHash = (lastHashRaw || '').toString().trim();
        const b = await prov.block(lastHash);
        // Most Esplora-like APIs return timestamp in seconds
        setTipState(tipH, b.timestamp || (b.time ? Math.floor(b.time/1000) : null));
        return true;
      }catch(e){
        // flip to secondary and retry once
        prov = secondary;
      }
    }
    return false;
  }

  function startUiTicker(){
    if (uiTicker) return;
    const etaEl = qs('#eta');
    const sinceEl = qs('#since');
    uiTicker = setInterval(() => {
      if (typeof lastTipTimestampSec === 'number' && Number.isFinite(lastTipTimestampSec)){
        const now = Math.floor(Date.now()/1000);
        const since = Math.max(0, now - lastTipTimestampSec);
        if (sinceEl) sinceEl.textContent = 'Since last block: ' + fmtDuration(since);

        // Remaining blocks if we are in a waiting phase
        const remaining = (committed && !committed.done) ? committed.hashes.reduce((n,h) => n + (h?0:1), 0) : 0;
        const target = remaining * 600; // ~10 min per block
        const diff = target - since;
        if (etaEl){
          etaEl.textContent = remaining > 0
            ? ('ETA: ' + (diff <= 0 ? ('Overdue by ' + fmtDuration(-diff)) : fmtDuration(diff)))
            : 'ETA: --';
        }
      }
    }, 1000);
  }

  // ---------- Commit string helpers ----------
  function canonicalString({ prov, t, s, k, min, max, n }){
    // Stable, lowercased keys
    return `prov=${prov}|tip=${t}|start=${s}|k=${k}|min=${min}|max=${max}|n=${n}`;
  }
  // CRC-32 for a short integrity check (poly 0xEDB88320)
  function crc32(str){
    let c = ~0 >>> 0;
    for (let i=0;i<str.length;i++){
      c ^= str.charCodeAt(i);
      for (let j=0;j<8;j++){
        c = (c>>>1) ^ (0xEDB88320 & (-(c&1)));
      }
    }
    return (~c) >>> 0;
  }

  // ---------- Crypto & RNG ----------
  function hexToBytes(hex){
    const m = (hex || '').replace(/^0x/i,'').match(/.{1,2}/g) || [];
    return new Uint8Array(m.map(b => parseInt(b,16)));
  }
  async function sha256Bytes(bytes){
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
  }
  function bytesToHex(bytes){
    return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // Deterministic draw with rejection sampling to avoid modulo bias.
  // Seed = SHA256( concat(K block hashes as bytes) || "draw:" || drawIndex )
  async function drawInRange(hashes, min, max, drawIndex){
    const range = (max - min + 1);
    if (range <= 0) throw new Error('Bad range');
    // Prepare seed material
    const concat = hashes.map(h => hexToBytes(h)).reduce((acc,cur)=>{
      const tmp = new Uint8Array(acc.length + cur.length);
      tmp.set(acc,0); tmp.set(cur, acc.length);
      return tmp;
    }, new Uint8Array());
    const salt = new TextEncoder().encode('draw:' + drawIndex);
    const seed = new Uint8Array(concat.length + salt.length);
    seed.set(concat,0); seed.set(salt, concat.length);

    // Expand to 8 bytes (64-bit) from SHA256 output
    // Use rejection sampling against the largest multiple <= 2^64-1
    while(true){
      const h = await sha256Bytes(seed);
      // Next seed = hash || salt (domain separation per iteration)
      const nextSeed = new Uint8Array(h.length + salt.length);
      nextSeed.set(h,0); nextSeed.set(salt,h.length);
      seed.set(nextSeed);

      // Take first 8 bytes as unsigned 64-bit
      let x = 0n;
      for (let i=0;i<8;i++){ x = (x<<8n) | BigInt(h[i]); }
      const bigRange = BigInt(range);
      const max64 = (1n<<64n) - 1n;
      const limit = (max64 // floor(max64 / bigRange) * bigRange - 1 then +1 window
                     - (max64 % bigRange));
      if (x < limit){
        const v = Number(x % bigRange) + min;
        return v;
      }
      // else: rejection, loop for another hash
    }
  }

  async function drawsFromK(min, max, count){
    const hashes = committed.hashes.slice(); // filled by waitForCommittedBlocks
    const results = [];
    for (let i=0;i<count;i++){
      results.push(await drawInRange(hashes, min, max, i));
    }
    return { draws: results, h0: hashes[0] };
  }

  // ---------- Waiting for K consecutive blocks ----------
  async function waitForCommittedBlocks(controller){
    const sel = qs('#provider');
    const prov = providers[committed.providerName || (sel ? sel.value : 'mempool')] || providers.mempool;
    let h = committed.startHeight;
    for (let i=0; i<committed.K; i++){
      if (controller.cancelled) return;
      // Poll until height h exists
      // Strategy: ask for hash at height until it returns 200
      let hash = null;
      while(!hash){
        if (controller.cancelled) return;
        try{
          const raw = await prov.hashByHeight(h);
          hash = (raw || '').toString().trim();
        }catch(e){
          hash = null;
        }
        if (!hash) await new Promise(r => setTimeout(r, 5000));
      }
      committed.hashes[i] = hash;
      // For ETA pill: each new block arrival resets lastTipTimestampSec
      try {
        const b = await prov.block(hash);
        const tipH = h; // we just got this height
        setTipState(tipH, b.timestamp || (b.time ? Math.floor(b.time/1000) : null));
      } catch(e){ /* non-fatal */ }
      h++;
    }
  }

  // ---------- Rendering ----------
  function renderResults({ draws, h0, min, max, count }){
    const hashesEl = qs('#hashes');
    const numbersEl = qs('#numbers');
    const committedInfo = qs('#committedInfo');

    // Hash list
    if (hashesEl){
      const lis = committed.hashes.map((h, i) =>
        `<li><strong>H${i}</strong>: <span class="mono">${h}</span></li>`
      ).join('');
      hashesEl.innerHTML = `<h4 style="margin:6px 0;">Block hashes</h4><ul class="mono">${lis}</ul>`;
    }

    // Numbers
    if (numbersEl){
      const spans = draws.map((n,i)=> `<span class="pill">${n}</span>`).join('');
      numbersEl.innerHTML = `<h4 style="margin:6px 0;">Random number${count>1?'s':''}</h4><div class="row">${spans}</div>`;
    }

    // Commit info
    if (committedInfo){
      const provCode = (providers[committed.providerName] || providers.mempool).code;
      const canon = canonicalString({
        prov: provCode,
        t: committed.tipAtCommit,
        s: committed.startHeight,
        k: committed.K,
        min, max, n: count
      });
      const crc = crc32(canon).toString(16).toUpperCase().padStart(8,'0').slice(0,4);
      committedInfo.innerHTML = `Commit: <span class="mono">BBRNG-commit ${canon}|crc=${crc}</span>`;
    }

    // Compose proofs for copy buttons
    const shortProof = `BBRNG v1|k=${committed.K}|min=${min}|max=${max}|n=${count}|H0=${h0}`;
    const longProof = [
      shortProof,
      `H=[${committed.hashes.join(',')}]`
    ].join('\n');

    window.__BBRNG_LAST = { shortProof, longProof, committed };
  }

  // ---------- Decimals row (Results) ----------
  function toggleDecimalsRow(){
    const row = qs('#decimalsRow');
    if (!row) return;
    const shouldShow = committed && committed.K >= 2;
    row.classList.toggle('hidden', !shouldShow);
  }

  function toDecimalListFromHex(hexList){
    if (!Array.isArray(hexList)) return [];
    const out = [];
    for (const hx of hexList){
      if (!hx || typeof hx !== 'string') continue;
      const clean = hx.trim().replace(/^0x/i,'');
      try { out.push(BigInt('0x' + clean).toString(10)); } catch(_){}
    }
    return out;
  }

  // ---------- Wire up UI ----------
  document.addEventListener('DOMContentLoaded', () => {
    try{
      // Sections
      const landing   = qs('#landing');
      const generator = qs('#generator');
      const results   = qs('#results');

      // Goto button
      const gotoBtn = qs('#gotoGenerator');
      on(gotoBtn, 'click', () => {
        if (landing) landing.classList.add('hidden');
        if (generator) generator.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      // Copy Commit button (only visible after commit prepared)
      const copyCommitBtn = qs('#copy-commit');
      on(copyCommitBtn, 'click', async () => {
        try{
          const ta = qs('#commit-string');
          if (!ta || !ta.value) return;
          await navigator.clipboard.writeText(ta.value);
          toast('Commit copied.');
        }catch(e){ showCopyFallback(qs('#commit-string')?.value || ''); }
      });

      // Begin flow
      const beginBtn = qs('#begin');
      const stopBtn  = qs('#stop');
      on(beginBtn, 'click', async () => {
        // Read inputs
        const count = clampInt(parseInt(qs('#count')?.value,10), 1, 10);
        const min   = parseInt(qs('#min')?.value,10);
        const max   = parseInt(qs('#max')?.value,10);
        const K     = clampInt(parseInt(qs('#kblocks')?.value,10), 1, 5);
        const providerName = qs('#provider')?.value || 'mempool';
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min){ toast('Invalid range'); return; }
        if ((max - min) > 1e12){ toast('Range too large (≤1e12)'); return; }

        // Phase A: commit prep (only once)
        const useCommit = qs('#use-commit');
        if (useCommit && useCommit.checked && !commitPrepared){
          try{
            const prov = providers[providerName] || providers.mempool;
            const tipRaw = await prov.tipHeight();
            const tipH = parseInt((tipRaw||'').toString().trim(), 10);
            committed = {
              tipAtCommit: tipH,
              startHeight: tipH + 1,
              K, providerName,
              hashes: new Array(K).fill(null),
              done: false
            };
            const provCode = (providers[providerName] || providers.mempool).code;
            const canon = canonicalString({ prov:provCode, t:committed.tipAtCommit, s:committed.startHeight, k:K, min, max, n:count });
            const crc = crc32(canon).toString(16).toUpperCase().padStart(8,'0').slice(0,4);
            const commitStr = `BBRNG-commit ${canon}|crc=${crc}`;

            const commitTA = qs('#commit-string');
            const commitHint = qs('#commit-hint');
            const nostrLinks = qs('#nostr-links');
            if (commitTA){ commitTA.value = commitStr; commitTA.classList.remove('hidden'); }
            if (commitHint){
              commitHint.style.display='block';
              commitHint.innerHTML = `Post the commit line above <em>publicly</em> (e.g., Nostr) <strong>before</strong> block <strong>#${committed.startHeight.toLocaleString()}</strong> is mined. Then click <em>Begin</em> again.`;
            }
            const searchLink = qs('#search-nostrband');
            if (nostrLinks){ nostrLinks.classList.remove('hidden'); nostrLinks.style.display='flex'; }
            if (searchLink){
              const q = encodeURIComponent(commitStr);
              searchLink.href = `https://nostr.band/?q=${q}`;
            }
            if (copyCommitBtn) copyCommitBtn.classList.remove('hidden');

            commitPrepared = true;
            toast('Commit created. Copy it, post it, then press Begin again.');
            return; // wait for user to press Begin again
          }catch(e){
            toast('Could not prepare commit: ' + (e?.message || e));
            return;
          }
        }

        // Phase B: Wait for blocks then draw
        beginBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        waitController = { cancelled:false };

        // Pause meta polling while actively waiting
        if (metaTimer){ clearInterval(metaTimer); metaTimer = null; }

        try{
          if (!committed || committed.K !== K || committed.providerName !== providerName){
            // If no commit was prepared or K/provider changed, set defaults now (no public timestamp)
            const tipRaw = await (providers[providerName] || providers.mempool).tipHeight();
            const tipH = parseInt((tipRaw||'').toString().trim(), 10);
            committed = { tipAtCommit: tipH, startHeight: tipH+1, K, providerName, hashes:new Array(K).fill(null), done:false };
          }

          await waitForCommittedBlocks(waitController);
          if (waitController.cancelled){
            toast('Stopped.');
            beginBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            if (!metaTimer) metaTimer = setInterval(updateTipMeta, 60000);
            return;
          }
          const count2 = clampInt(parseInt(qs('#count')?.value,10), 1, 10); // re-read in case user changed
          const min2 = parseInt(qs('#min')?.value,10);
          const max2 = parseInt(qs('#max')?.value,10);
          const { draws, h0 } = await drawsFromK(min2, max2, count2);
          renderResults({ draws, h0, min:min2, max:max2, count:count2 });
          toggleDecimalsRow();

          // navigate to results
          if (generator) generator.classList.add('hidden');
          if (results) results.classList.remove('hidden');

          beginBtn.disabled = false;
          if (stopBtn) stopBtn.disabled = true;
          committed.done = true;
          commitPrepared = false;
          toast('');
          if (!metaTimer) metaTimer = setInterval(updateTipMeta, 60000);
        }catch(e){
          toast('Error: ' + (e?.message || e));
          beginBtn.disabled = false;
          if (stopBtn) stopBtn.disabled = true;
          if (!metaTimer) metaTimer = setInterval(updateTipMeta, 60000);
        }
      });

      on(stopBtn, 'click', () => { if (waitController) waitController.cancelled = true; });

      // Copy Short / Long
      const copyShortBtn = qs('#copyShort');
      const copyLongBtn  = qs('#copyLong');
      on(copyShortBtn, 'click', async () => {
        const last = window.__BBRNG_LAST;
        if (!last || !last.shortProof){ toast('No short proof yet.'); return; }
        const refInput = qs('#note-url');
        const ref = refInput && refInput.value ? refInput.value.trim() : '';
        const payload = ref ? `${last.shortProof}|ref=${ref}` : last.shortProof;
        try{
          await navigator.clipboard.writeText(payload);
          toast('Short proof copied.');
        }catch(e){ showCopyFallback(payload); }
      });
      on(copyLongBtn, 'click', async () => {
        const last = window.__BBRNG_LAST;
        if (!last || !last.longProof){ toast('No long proof yet.'); return; }
        let payload = last.longProof;
        // Optional decimals row (K>=2 and checkbox checked)
        const includeDecimals = qs('#include-decimals-results');
        if (includeDecimals && includeDecimals.checked && last.committed && Array.isArray(last.committed.hashes)){
          const decs = toDecimalListFromHex(last.committed.hashes);
          if (decs.length) payload += `\nH_dec=[${decs.join(',')}]`;
        }
        const refInput = qs('#note-url');
        const ref = refInput && refInput.value ? refInput.value.trim() : '';
        if (ref) payload += `\nref=${ref}`;
        try{
          await navigator.clipboard.writeText(payload);
          toast('Long proof copied.');
        }catch(e){ showCopyFallback(payload); }
      });

      // Verify Short (basic format check that the line is present)
      const verifyShortBox = qs('#verifyShortBox');
      const verifyBtn = qs('#verifyBtn');
      const verifyStatus = qs('#verifyStatus');
      on(verifyBtn, 'click', () => {
        const s = (verifyShortBox?.value || '').trim();
        if (!s){ verifyStatus.textContent = 'Paste a short proof first.'; return; }
        const m = s.match(/BBRNG v1\|[^\n\r]+/);
        if (m) verifyStatus.textContent = 'Looks like a valid short proof line.';
        else verifyStatus.textContent = 'Could not find a valid short proof line.';
      });

      // Initial tip meta + ticker
      (async function boot(){
        try{ await updateTipMeta(); }catch(e){}
        if (!metaTimer) metaTimer = setInterval(updateTipMeta, 60000);
        startUiTicker();
      })();

      // Default Results decimals row hidden at start
      toggleDecimalsRow();
    }catch(initErr){
      console.error('Init error', initErr);
      toast('App failed to initialize. See console for details.');
    }
  });
})();