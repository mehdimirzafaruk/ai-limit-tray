const title=document.querySelector('#title'),remaining=document.querySelector('#remaining'),detail=document.querySelector('#detail'),bar=document.querySelector('#bar'),meter=document.querySelector('#meter'),card=document.querySelector('#card');
const fmt=value=>Number(value).toLocaleString('tr-TR');
function limitWarnings(chat){return ['primary','secondary'].map(key=>chat?.rateLimits?.[key]).filter(limit=>limit&&Number.isFinite(Number(limit.remainingPct))&&Number(limit.remainingPct)<=20).sort((a,b)=>Number(a.remainingPct)-Number(b.remainingPct))}
function compactLimitWarning(chat){const warnings=limitWarnings(chat);if(!warnings.length)return null;return `⚠ ${warnings.map(limit=>`${String(limit.label||'Limit').replace('5 saatlik','5 saat').replace('Haftalık','Hafta')} %${Math.max(0,Math.round(Number(limit.remainingPct)*10)/10)}`).join(' · ')} kaldı`}
function compactStatus(chat){if(!chat?.compacted)return null;const count=Math.max(1,Number(chat.compactionCount)||1);return `↻ Compact${count>1?` ×${count}`:''} uygulandı`}
function render(context){
  const chat=context?.active||context?.chats?.[0];
  if(!chat)return;
  const isClaude=String(chat.source||'').startsWith('claude');
  const quotaWarning=compactLimitWarning(chat);
  const compact=compactStatus(chat);
  const warnings=limitWarnings(chat);
  card.dataset.source=isClaude?'claude':'codex';
  card.dataset.quota=quotaWarning?(warnings.some(limit=>Number(limit.remainingPct)<=10)?'critical':'warn'):'ok';
  card.dataset.compacted=compact?'true':'false';
  title.textContent=chat.title||'İsimsiz sohbet';
  title.title=chat.title||'';
  if(chat.remainingPct==null||chat.usedTokens==null||chat.contextLimit==null){
    remaining.textContent='…';detail.textContent=[compact,quotaWarning].filter(Boolean).join(' · ')||chat.reason||'Context verisi bekleniyor';bar.style.width='0%';meter.setAttribute('aria-valuenow','0');card.dataset.level='waiting';return;
  }
  const left=Math.max(0,Math.round(chat.remainingPct*10)/10);
  remaining.textContent=`%${left} kaldı`;
  detail.textContent=[compact,quotaWarning].filter(Boolean).join(' · ')||`${chat.model||(isClaude?'Claude':'Codex')} · ${chat.estimated?'≈ ':''}${fmt(chat.usedTokens)} / ${fmt(chat.contextLimit)} token`;
  bar.style.width=`${left}%`;
  meter.setAttribute('aria-valuenow',String(left));
  card.dataset.level=left<15?'danger':left<35?'warn':'ok';
}
window.limits.state().then(state=>render(state.context));
window.limits.onContext(render);
