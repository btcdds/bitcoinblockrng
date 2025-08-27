'use strict';
/**
 * Bitcoin Block RNG — cleaned app.js
 *
 * Fixes/Features:
 * - Robust navigation: attaches after DOMContentLoaded with try/catch.
 * - Guards all eager startup blocks to prevent a single error from breaking the UI.
 * - Central state cache: window.__BBRNG_LAST = { shortProof, longProof, committed }.
 * - Copy handlers resilient to missing data.
 * - Results: "Include decimal form…" row (#decimalsRow with checkbox #include-decimals-results)
 *   is shown only when K >= 2 and included in Long Proof if checked.
 * - Public helpers: window.bbrngSetProofs(...) and window.bbrngToggleDecimalsRow(K)
 *   so your generation code can integrate without refactors.
 *
 * Expected element IDs (present if you want the respective features to work):
 *   Navigation:   #gotoGenerator, #landing, #generator
 *   Status:       #status
 *   Results:      #decimalsRow, #include-decimals-results
 *   Copy:         #copyShort, #copyLong, #noteUrl
 *   Manual Copy:  #copyFallbackWrap, #copyFallback
 */

(function(){
  // ----------------- Small utilities -----------------
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const on  = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

  function toast(msg){
    const statusEl = qs('#status');
    if (statusEl) statusEl.textContent = msg || '';
  }

  function showCopyFallback(text){
    const wrap = qs('#copyFallbackWrap');
    const ta   = qs('#copyFallback');
    if (!wrap || !ta) return;
    ta.value = text;
    wrap.classList.remove('hidden');
    ta.focus(); ta.select();
    toast('Copy failed; manual copy area shown.');
  }

  // Central, durable state for proofs + inputs produced by the generator.
  function setLastState(obj){
    if (!obj || typeof obj !== 'object') return;
    const cur = (window.__BBRNG_LAST || {});
    window.__BBRNG_LAST = Object.assign({}, cur, obj);
  }

  function getLastState(){ return window.__BBRNG_LAST || null; }

  // ------------- Decimals row show/hide + builder -------------
  function toggleDecimalsRow(kBlocks){
    const row = qs('#decimalsRow');
    if (!row) return;
    if (Number.isFinite(kBlocks) && kBlocks >= 2) row.classList.remove('hidden');
    else row.classList.add('hidden');
  }

  // Build decimal array from hex hash list (safe BigInt parse)

  function toDecimalListFromHex(hexList){
    if (!Array.isArray(hexList)) return [];
    const out = [];
    for (const hx of hexList){
      if (!hx || typeof hx !== 'string') continue;
      const clean = hx.trim().replace(/^0x/i, '');
      try {
        out.push(BigInt('0x' + clean).toString(10));
      } catch (_) {
        // Skip malformed entries
      }
    }
    return out;
  }

  // Expose helpers so generation code can call them directly.
  window.bbrngToggleDecimalsRow = toggleDecimalsRow;
  window.bbrngSetProofs = function({ shortProof, longProof, committed }){
    setLastState({ shortProof, longProof, committed });
    if (committed && Number.isFinite(committed.K)) toggleDecimalsRow(committed.K);
  };

  // ------------- Navigation + event wiring -------------
  document.addEventListener('DOMContentLoaded', () => {
    try {
      // Navigation: Landing -> Generator
      const gotoBtn   = qs('#gotoGenerator');
      const landing   = qs('#landing');
      const generator = qs('#generator');
      if (gotoBtn && landing && generator){
        on(gotoBtn, 'click', () => {
          landing.classList.add('hidden');
          generator.classList.remove('hidden');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }

      // Optional: also allow hash routing (#generator)
      if (location.hash === '#generator' && landing && generator){
        landing.classList.add('hidden');
        generator.classList.remove('hidden');
      }

      // Copy buttons
      const copyShortBtn = qs('#copyShort');
      const copyLongBtn  = qs('#copyLong');
      const noteUrl      = qs('#noteUrl'); // optional

      if (copyShortBtn){
        on(copyShortBtn, 'click', async () => {
          const last = getLastState();
          if (!last || !last.shortProof){
            toast('No short proof available yet.');
            return;
          }
          const ref = noteUrl && noteUrl.value ? noteUrl.value.trim() : '';
          const payload = ref ? `${last.shortProof}|ref=${ref}` : last.shortProof;
          try {
            await navigator.clipboard.writeText(payload);
            toast('Short proof copied.');
          } catch {
            showCopyFallback(payload);
          }
        });
      }

      if (copyLongBtn){
        on(copyLongBtn, 'click', async () => {
          const last = getLastState();
          if (!last || !last.longProof){
            toast('No long proof available yet.');
            return;
          }
          let payload = last.longProof;

          // If the "include decimal" checkbox exists and is checked, append H_dec=[...]
          const includeDecimals = qs('#include-decimals-results');
          if (includeDecimals && includeDecimals.checked){
            const hashes = last.committed && Array.isArray(last.committed.hashes)
              ? last.committed.hashes : [];
            const decs = toDecimalListFromHex(hashes);
            if (decs.length){
              payload += `\nH_dec=[${decs.join(',')}]`;
            }
          }

          const noteUrl = qs('#noteUrl');
          const ref = noteUrl && noteUrl.value ? noteUrl.value.trim() : '';
          if (ref) payload += `\nref=${ref}`;

          try {
            await navigator.clipboard.writeText(payload);
            toast('Long proof copied.');
          } catch {
            showCopyFallback(payload);
          }
        });
      }

      // Listen for a custom event from your generator code to receive proofs
      // Usage from generator: document.dispatchEvent(new CustomEvent('bbrng:generated', { detail: { shortProof, longProof, committed } }));
      on(document, 'bbrng:generated', (ev) => {
        const d = ev && ev.detail || {};
        window.bbrngSetProofs(d);
      });

      // In case the app sets committed.K later, you can call window.bbrngToggleDecimalsRow(K)
      // For first load, default to hiding the row unless K >= 2 is already known somewhere:
      toggleDecimalsRow(0);

      // ====== OPTIONAL: Guard any eager startup logic to avoid breaking the UI ======
      try {
        // Place any of your existing “immediate start” calls here,
        // wrapped so a failure doesn't prevent event handlers from attaching.
        // Example:
        // startUiTicker();
        // updateTipMeta();
      } catch (e) {
        console.error('Eager startup failed:', e);
      }

    } catch (err) {
      console.error('App init failed:', err);
      toast('App failed to initialize. See console for details.');
    }
  });

})();