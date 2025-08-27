'use strict';
(function(){
  const qs = (s)=>document.querySelector(s);

  // Navigation hookup
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('gotoGenerator');
    if (btn) {
      btn.addEventListener('click', () => {
        const landing = document.getElementById('landing');
        const generator = document.getElementById('generator');
        if (landing && generator) {
          landing.classList.add('hidden');
          generator.classList.remove('hidden');
        }
      });
    }
  });

  // Elements
  const beginBtn = qs('#begin');
  const stopBtn  = qs('#stop');
  const statusEl = qs('#status');
  const tipEl    = qs('#tip');
  const etaEl    = qs('#eta');
  const sinceEl  = qs('#since');

  const useCommit = qs('#use-commit');
  const copyCommitBtn = qs('#copy-commit');
  const commitTA = qs('#commit-string');
  const commitHint = qs('#commit-hint');
  const nostrLinks = qs('#nostr-links');
  const searchNostrBand = qs('#search-nostrband');

  const resultsSec = qs('#results');
  const generatorSec = qs('#generator');
  const committedInfo = qs('#committedInfo');
  const hashesEl = qs('#hashes');
  const numbersEl = qs('#numbers');

  const verifyShortBox = qs('#verifyShortBox');
  const verifyBtn = qs('#verifyBtn');
  const verifyStatus = qs('#verifyStatus');
  const noteUrl = qs('#note-url');
  const copyShortBtn = qs('#copyShort');
  const copyLongBtn = qs('#copyLong');

  // Providers
  const providers = {
    mempool: {
      tipHeight: async ()=> fetchText('https://mempool.space/api/blocks/tip/height'),
      hashByHeight: async (h)=> fetchText('https://mempool.space/api/block-height/' + h),
      block: async (hash)=> fetchJson('https://mempool.space/api/block/' + hash),
    },
    blockstream: {
      tipHeight: async ()=> fetchText('https://blockstream.info/api/blocks/tip/height'),
      hashByHeight: async (h)=> fetchText('https://blockstream.info/api/block-height/' + h),
      block: async (hash)=> fetchJson('https://blockstream.info/api/block/' + hash),
    }
  };
  async function fetchJson(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(url+': HTTP '+r.status); return r.json(); }
  async function fetchText(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(url+': HTTP '+r.status); return r.text(); }

  // State
  let lastTipHeight = null;
  let lastTipTimestampSec = null;
  let uiTicker = null;
  let metaTimer = null;

  let committed = null; // { tipAtCommit, startHeight, K, providerName, hashes:[], done:false }
  let commitPrepared = false;
  let waitController = null;

  // Helpers
  function fmtDuration(s){ s=Math.max(0, Math.floor(s)); const m=Math.floor(s/60), r=s%60; return m>0? (m+'m '+r+'s') : (r+'s'); }
  function startUiTicker(){ if(uiTicker) return; uiTicker=setInterval(()=>{
    if(typeof lastTipTimestampSec==='number'){
      const now=Math.floor(Date.now()/1000);
      const since= Math.max(0, now - lastTipTimestampSec);
      sinceEl.textContent = 'Since last block: ' + fmtDuration(since);
      const remaining = (committed && !committed.done) ? committed.hashes.reduce((n,h)=> n + (h?0:1), 0) : 0;
      const target = remaining * 600; const diff = target - since;
      etaEl.textContent = remaining>0 ? ('ETA: ' + (diff<=0? ('Overdue by '+fmtDuration(-diff)) : fmtDuration(diff))) : 'ETA: --';
    }
  }, 1000); }
  function setTipState(height, timestampSec){
    const nowSec=Math.floor(Date.now()/1000);
    lastTipHeight=Number(height);
    lastTipTimestampSec=Math.min(Number(timestampSec)||0, nowSec);
    tipEl.textContent='Block: #'+lastTipHeight.toLocaleString();
  }

  async function updateTipMeta(){
    const prov = providers[qs('#provider').value];
    try{
      const hRaw=await prov.tipHeight();
      const tipH=parseInt(hRaw,10);
      const lastHash=await prov.hashByHeight(tipH);
      const b=await prov.block(lastHash.trim());
      setTipState(tipH, b.timestamp);
    }catch(e){ /* ignore */ }
  }
  (async function(){ try{ await updateTipMeta(); }catch(_){ } metaTimer=setInterval(updateTipMeta,60000); startUiTicker(); })();

  // Crypto helpers
  function hexToBytes(hex){ const m=hex.match(/.{1,2}/g)||[]; return new Uint8Array(m.map(b=>parseInt(b,16))); }
  async function sha256Bytes(bytes){ const digest=await crypto.subtle.digest('SHA-256', bytes); return new Uint8Array(digest); }
  function bytesToHex(bytes){ return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join(''); }
  function bigIntFromHex(hex){ return BigInt('0x'+hex); }
  async function deriveSeedFromHashesBE(hashes){
    const parts=hashes.map(h=>hexToBytes(h.trim()));
    const totalLen=parts.reduce((a,b)=>a+b.length,0);
    const concat=new Uint8Array(totalLen);
    let o=0; for(const p of parts){ concat.set(p,o); o+=p.length; }
    const h0=await sha256Bytes(concat);
    return bytesToHex(h0);
  }
  function mapToRangeUniform256(uniformHex, min, max){
    const range=BigInt(max-min+1);
    const M=1n<<256n;
    const threshold=M-(M%range);
    const X=bigIntFromHex(uniformHex);
    if(X>=threshold) return null; // reject & re-hash
    const off=X%range;
    return Number(BigInt(min)+off);
  }
  async function nextHex(hex){ const b=await sha256Bytes(hexToBytes(hex)); return bytesToHex(b); }

  // Canonical + CRC (include tip height t)
  function canonicalString(params){
    const { prov, t, s, k, min, max, n, nums } = params;
    return `v=1|p=${prov}|t=${t}|s=${s}|k=${k}|min=${min}|max=${max}|n=${n}|nums=${(nums||[]).join(',')}`;
  }
  const CRC_TABLE = (()=>{ let c,table=new Array(256); for(let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); table[n]=c>>>0; } return table; })();
  function crc32(str){ let c=0^(-1); for(let i=0;i<str.length;i++) c=(c>>>8)^CRC_TABLE[(c^str.charCodeAt(i))&0xFF]; return (c^(-1))>>>0; }

  // Copy commit
  if (copyCommitBtn) copyCommitBtn.addEventListener('click', async ()=>{
    if(!commitTA.value) return;
    try{ await navigator.clipboard.writeText(commitTA.value); toast('Commit copied'); }
    catch(e){ toast('Copy failed'); }
  });

  // Begin flow
  if (beginBtn) beginBtn.addEventListener('click', async ()=>{
    const count = clampInt(parseInt(qs('#count').value,10),1,10);
    const min = parseInt(qs('#min').value,10);
    const max = parseInt(qs('#max').value,10);
    const K   = clampInt(parseInt(qs('#kblocks').value,10),1,5);
    const providerName = qs('#provider').value;
    if(!Number.isFinite(min)||!Number.isFinite(max)||max<min){ toast('Invalid range'); return; }
    if((max-min)>1e12){ toast('Range too large (≤1e12)'); return; }

    // Phase A: commit prep
    if(useCommit.checked && !commitPrepared){
      try{
        const prov = providers[providerName];
        const tipRaw = await prov.tipHeight();
        const tipH = parseInt(tipRaw,10);
        committed = { tipAtCommit: tipH, startHeight: tipH+1, K, providerName, hashes:new Array(K).fill(null), done:false };
        const provCode = providerName==='mempool'?'mp':'bs';
        const canon = canonicalString({ prov:provCode, t:committed.tipAtCommit, s:committed.startHeight, k:K, min, max, n:count, nums:[] });
        const crc = crc32(canon).toString(16).toUpperCase().padStart(8,'0').slice(0,4);
        const commitStr = `BBRNG-commit ${canon}|crc=${crc}`;
        commitTA.value = commitStr;
        commitPrepared = true;
        commitHint.style.display='block';
        commitHint.innerHTML = `Post this <strong>before block #${(committed.startHeight).toLocaleString()}</strong> exists (current block: <strong>#${(committed.tipAtCommit).toLocaleString()}</strong>). Then press <em>Begin</em> to start waiting.`;
        copyCommitBtn.classList.remove('hidden');
        commitTA.classList.remove('hidden');
        // reveal helper links only after commit is generated
        nostrLinks.classList.remove('hidden');
        nostrLinks.style.display='flex';
        // update nostr.band search link
        const q = encodeURIComponent(commitStr);
        if (searchNostrBand) searchNostrBand.href = `https://nostr.band/?q=${q}`;
        toast('Commit created. Copy and post to Nostr, then press Begin.');
        return; // pause until user clicks Begin again
      }catch(e){ toast('Commit failed: '+e.message); return; }
    }

    // Phase B: start waiting
    if(!committed || committed.done){
      try{
        const prov = providers[providerName];
        const tipRaw = await prov.tipHeight();
        const tipH = parseInt(tipRaw,10);
        committed = { tipAtCommit: tipH, startHeight: tipH+1, K, providerName, hashes:new Array(K).fill(null), done:false };
      }catch(e){ toast('Commit failed: '+e.message); return; }
    }

    beginBtn.disabled=true; stopBtn.disabled=false; waitController={cancelled:false};
    // pause meta polling while actively waiting
    if(metaTimer){ clearInterval(metaTimer); metaTimer=null; }

    try{
      await waitForCommittedBlocks(waitController);
      if(waitController.cancelled){
        toast('Stopped.');
        beginBtn.disabled=false; stopBtn.disabled=true;
        if(!metaTimer) metaTimer=setInterval(updateTipMeta,60000);
        return;
      }
      const count2 = clampInt(parseInt(qs('#count').value,10),1,10); // re-read in case user changed
      const min2 = parseInt(qs('#min').value,10);
      const max2 = parseInt(qs('#max').value,10);
      const { draws, h0 } = await drawsFromK(min2,max2,count2);
      renderResults({ draws, h0, min:min2, max:max2, count:count2 });
      // navigate to results
      generatorSec.classList.add('hidden');
      resultsSec.classList.remove('hidden');
      beginBtn.disabled=false; stopBtn.disabled=true; committed.done=true; commitPrepared=false; toast('');
      if(!metaTimer) metaTimer=setInterval(updateTipMeta,60000);
    }catch(e){ toast('Error: '+e.message); beginBtn.disabled=false; stopBtn.disabled=true; if(!metaTimer) metaTimer=setInterval(updateTipMeta,60000); }
  });

  if (stopBtn) stopBtn.addEventListener('click', ()=>{ if(waitController){ waitController.cancelled=true; }});

  async function waitForCommittedBlocks(controller){
    const prov = providers[qs('#provider').value];
    // Ensure tip meta is fresh for ticking UI
    try{ await updateTipMeta(); }catch(_){ }
    const endH = committed.startHeight + committed.K - 1;
    // fill already-mined
    for(let h=committed.startHeight; h<=endH; h++){
      if(controller?.cancelled) return;
      if(!committed.hashes[h-committed.startHeight]){
        try{
          const tipRaw = await prov.tipHeight();
          const tip = parseInt(tipRaw,10);
          if(tip>=h){
            const hash=(await prov.hashByHeight(h)).trim();
            committed.hashes[h-committed.startHeight]=hash;
            try{ const b=await prov.block(hash); setTipState(h,b.timestamp);}catch(_){ }
          }
        }catch(_){ }
      }
    }
    while(true){
      if(controller?.cancelled) return;
      let missing=[]; for(let i=0;i<committed.K;i++) if(!committed.hashes[i]) missing.push(committed.startHeight+i);
      if(missing.length===0) return; // done
      // wait up to 10s but allow fast cancel checks without API calls
      for(let i=0;i<40;i++){ if(controller?.cancelled) return; await sleep(250); }
      try{
        const tipRaw = await prov.tipHeight();
        const tip = parseInt(tipRaw,10);
        for(const h of missing){
          if(controller?.cancelled) return;
          if(tip>=h){
            const hash=(await prov.hashByHeight(h)).trim();
            committed.hashes[h-committed.startHeight]=hash;
            try{ const b=await prov.block(hash); setTipState(h,b.timestamp);}catch(_){ }
          }
        }
      }catch(_){ }
    }
  }

  async function drawsFromK(min,max,count){
    const h0 = await deriveSeedFromHashesBE(committed.hashes);
    let h = h0; const results=[];
    for(let i=0;i<count;i++){
      let rej=0;
      while(true){
        const mapped=mapToRangeUniform256(h,min,max);
        if(mapped!==null){
          results.push({ value:mapped, base16:'0x'+h, base10: BigInt('0x'+h).toString(10), rejections:rej });
          break;
        }
        h=await nextHex(h);
        rej++;
      }
      h=await nextHex(h);
    }
    return { draws:results, h0 };
  }

  function renderResults({ draws, h0, min, max, count }){
    const providerName = qs('#provider').value; const provCode = providerName==='mempool'?'mp':'bs';
    const nums = draws.map(d=>d.value);
    committedInfo.innerHTML = `Committed: block <span class="mono">#${committed.tipAtCommit.toLocaleString()}</span> → start <span class="mono">#${committed.startHeight.toLocaleString()}</span>, K=${committed.K}, provider=${providerName}`;
    hashesEl.innerHTML = '<div class="muted">Block hashes (BE):</div>' + committed.hashes.map((h,idx)=>`<div class="hash-line">H${idx+1} @ #${(committed.startHeight+idx).toLocaleString()}: ${h}</div>`).join('');
    numbersEl.innerHTML =
      '<div>Range: <span class="mono">['+min+','+max+']</span></div>' +
      '<ol style="margin-top:6px;">' +
      draws.map((d,i)=>`<li>Draw ${i+1}: <span class="mono">${d.value}</span><br><span class="muted">H[${i}] (hex accepted):</span> <span class="mono nowrap small">${d.base16}</span><br><span class="muted">H[${i}] (dec accepted):</span> <span class="mono small">${d.base10}</span><br><span class="muted">Rejections before accept:</span> <span class="mono small">${d.rejections}</span></li>`).join('') + '</ol>';

    // Human-readable formula explanation (transparency)
    const N = (max - min + 1);
    const formulaNote = `
      <div class="small muted" style="margin-top:8px;">
        <strong>How the number was chosen:</strong>
        Let N = ${N}. We convert the 256-bit hash H to a number X.
        If X is in the fair range, result = min + (X mod N).
        If not, we re-hash and try again so there’s no bias.
      </div>`;
    numbersEl.insertAdjacentHTML('beforeend', formulaNote);

    // Explanation of the "fair range"
const fairRangeNote = `
  <div class="small muted" style="margin-top:4px;">
    <strong>What does "fair range" mean?</strong>
    We only accept values of X that fall below a threshold multiple of N,
    so each outcome is equally likely. If X is above that threshold,
    it would create bias — so we reject it and hash again.
  </div>`;
numbersEl.insertAdjacentHTML('beforeend', fairRangeNote);

    // proofs (with t). Include formula in long proof
    const canon = canonicalString({ prov:provCode, t:committed.tipAtCommit, s:committed.startHeight, k:committed.K, min, max, n:count, nums });
    const crc = crc32(canon).toString(16).toUpperCase().padStart(8,'0').slice(0,4);
    const shortProof = `BBRNG v1|p=${provCode}|t=${committed.tipAtCommit}|s=${committed.startHeight}|k=${committed.K}|r=${min}-${max}|n=${count}|x=[${nums.join(',')}]|crc=${crc}`;
    const longProof  = `BBRNG v1
prov=${provCode} t=${committed.tipAtCommit} start=${committed.startHeight} k=${committed.K} range=[${min},${max}] n=${count}
H@${committed.startHeight}..${committed.startHeight+committed.K-1}=
${committed.hashes.map(h=>`  ${h}`).join('\n')}
H0= 0x${h0}
nums=[${nums.join(',')}]
formula: N = max-min+1; result_i = min + (X_i mod N) (with rejection sampling to avoid bias)
crc=${crc}`;

    if (copyShortBtn) copyShortBtn.onclick = async ()=>{
      const ref = (noteUrl.value||'').trim();
      const payload = ref ? `${shortProof}|ref=${ref}` : shortProof;
      try{ await navigator.clipboard.writeText(payload); toast('Short proof copied'); }catch(e){ showCopyFallback(payload); }
    };
    if (copyLongBtn) copyLongBtn.onclick = async ()=>{
      const ref = (noteUrl.value||'').trim();
      const payload = ref ? `${longProof}\nref=${ref}` : longProof;
      try{ await navigator.clipboard.writeText(payload); toast('Long proof copied'); }catch(e){ showCopyFallback(payload); }
    };

    if (verifyBtn) verifyBtn.onclick = ()=>{
      const s = (verifyShortBox.value||'').trim();
      verifyStatus.textContent = verifyShortProof(s) ? 'Short proof format/CRC looks valid.' : 'Invalid or tampered short proof.';
    };

    // store for verifier closure
    window.__BBRNG_LAST = { shortProof, longProof };
  }

  function verifyShortProof(s){
    if(!s) return false;
    s = s.trim().replace(/^"|"$/g,'');
    // If user pasted a long block, try to extract the short line
    if(!/^BBRNG v1\|/.test(s)){
      const m = s.match(/BBRNG v1\|[^\n\r]+/);
      if(m) s = m[0].trim(); else return false;
    }
    const parts = Object.create(null);
    for(const seg of s.split('|').slice(1)){
      const ix = seg.indexOf('=');
      if(ix===-1) continue;
      const k = seg.slice(0,ix).trim();
      const v = seg.slice(ix+1).trim();
      parts[k] = v;
    }
    if(!parts.p||!parts.t||!parts.s||!parts.k||!parts.r||!parts.n||!parts.x||!parts.crc) return false;
    const rg = (parts.r||'').split('-');
    if(rg.length!==2) return false;
    const nums=(parts.x||'').replace(/^\[|\]$/g,'').split(',').filter(Boolean).map(x=>parseInt(x,10));
    const canon = canonicalString({ prov:parts.p, t:parseInt(parts.t,10), s:parseInt(parts.s,10), k:parseInt(parts.k,10), min:parseInt(rg[0],10), max:parseInt(rg[1],10), n:parseInt(parts.n,10), nums });
    const crc = crc32(canon).toString(16).toUpperCase().padStart(8,'0').slice(0,4);
    return crc === (parts.crc||'').toUpperCase();
  }

  function toast(t){ statusEl.textContent = t || ''; }
  function showCopyFallback(text){
    const wrap = qs('#copyFallbackWrap');
    const ta = qs('#copyFallback');
    if (!wrap || !ta) return;
    ta.value = text;
    wrap.classList.remove('hidden');
    ta.focus(); ta.select();
    toast('Copy failed by browser; showing manual copy area.');
  }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function clampInt(x,lo,hi){ if(!Number.isFinite(x)) return lo; return Math.max(lo, Math.min(hi,x)); }
})();
