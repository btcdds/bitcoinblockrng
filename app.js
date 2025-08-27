'use strict';
/**
 * Bitcoin Block RNG — cleaned app.js (v2)
 * Changes from v1: use explicit `catch (e)` blocks (no parameterless catch) to avoid
 * "missing catch or finally after try" parse errors in stricter JS engines.
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
      } catch (e) {
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
          } catch (e) {
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

          const refInput = qs('#noteUrl');
          const ref = refInput && refInput.value ? refInput.value.trim() : '';
          if (ref) payload += `\nref=${ref}`;

          try {
            await navigator.clipboard.writeText(payload);
            toast('Long proof copied.');
          } catch (e) {
            showCopyFallback(payload);
          }
        });
      }

      // Listen for a custom event from your generator code to receive proofs
      // Usage from generator: document.dispatchEvent(new CustomEvent('bbrng:generated', { detail: { shortProof, longProof, committed } }));
      on(document, 'bbrng:generated', (ev) => {
        const d = (ev && ev.detail) ? ev.detail : {};
        window.bbrngSetProofs(d);
      });

      // Default to hiding the decimals row until K is known
      toggleDecimalsRow(0);

      // ====== OPTIONAL: Guard any eager startup logic to avoid breaking the UI ======
      try {
        // Put immediate start calls here if needed, wrapped in try/catch.
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