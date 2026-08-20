const SAMPLE = `[00:00] Host: Welcome back to the show. Today we're talking about why most side projects never ship. I've launched twelve products in the last five years, and I want to break down the actual pattern I see killing projects before they reach users.

[00:45] Host: The number one killer isn't lack of skill, it's scope creep disguised as polish. You tell yourself you're "not ready to launch" but really you're avoiding the fear of putting something imperfect in front of people.

[02:10] Host: Second pattern: building for an audience of one — yourself. I did this with my first three apps. I built exactly what I wanted, never talked to a single user, and then wondered why nobody signed up.

[03:30] Host: Third: no forcing function. If there's no deadline, no public commitment, no money on the line, the project just... drifts. I now tell three friends the exact ship date before I write a line of code. Public pressure works.

[05:00] Host: My rule now is a two week rule. If I can't get a rough, ugly version in front of five real users within two weeks, the idea is too big and I break it down further.

[06:15] Host: Let's talk about the fix. Start by writing the landing page copy before you write any code. If you can't explain the value in three sentences, the product isn't clear enough yet.

[07:40] Host: Second fix: talk to five potential users before building anything. Not a survey — an actual fifteen minute call. You'll kill half your ideas this way, which is the point.

[09:00] Host: That's the show. If this helped, share it with a friend who's stuck on a side project. See you next week.`;

const WORKER_URL = "https://castforge.rajukumar98763017.workers.dev/";
const TRANSCRIBE_URL = "https://castforge.rajukumar98763017.workers.dev/transcribe";
const FEEDBACK_URL = "https://castforge.rajukumar98763017.workers.dev/feedback";
const MAX_FILE_MB = 25;

let currentMode = 'audio';
let transcribedText = '';
let selectedLanguage = 'auto';
let lastSocialPosts = [];

// ---------- Theme (light/dark) ----------

(function initTheme(){
  const saved = localStorage.getItem('castforge_theme');
  if(saved === 'light'){
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

function toggleTheme(){
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if(isLight){
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('castforge_theme', 'dark');
    document.getElementById('themeToggle').innerText = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('castforge_theme', 'light');
    document.getElementById('themeToggle').innerText = '☀️';
  }
}

// Set correct icon on load
document.addEventListener('DOMContentLoaded', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const btn = document.getElementById('themeToggle');
  if(btn) btn.innerText = isLight ? '☀️' : '🌙';
});

// ---------- Setup ----------

// Detect Instagram / Facebook in-app browsers where file upload is blocked
(function detectInAppBrowser(){
  const ua = navigator.userAgent || "";
  const isInApp = /Instagram|FBAN|FBAV|FB_IAB/i.test(ua);
  if(isInApp){
    document.getElementById('inappBanner').classList.add('active');
  }
})();

// ---------- UI helpers ----------

function setLanguage(lang){
  selectedLanguage = lang;
  document.querySelectorAll('.lang-chip').forEach(c=>c.classList.toggle('active', c.dataset.lang===lang));
}

function switchMode(mode){
  currentMode = mode;
  document.getElementById('modeAudioBtn').classList.toggle('active', mode==='audio');
  document.getElementById('modeTextBtn').classList.toggle('active', mode==='text');
  document.getElementById('audioMode').style.display = mode==='audio' ? 'block' : 'none';
  document.getElementById('textMode').style.display = mode==='text' ? 'block' : 'none';
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active', c.id==='tab-'+name));
}

function loadSample(){ document.getElementById('transcript').value = SAMPLE; }

function copyOut(id){
  const text = document.getElementById(id).innerText;
  navigator.clipboard.writeText(text);
  event.target.innerText = 'Copied ✓';
  setTimeout(()=>{ event.target.innerText = event.target.innerText.replace('Copied ✓', 'Copy'); }, 1200);
}

function copyAllSocial(){
  const posts = Array.from(document.querySelectorAll('#out-social .social-post')).map(el => {
    const clone = el.cloneNode(true);
    const numSpan = clone.querySelector('.num');
    if(numSpan) numSpan.remove();
    return clone.innerText.trim();
  });
  navigator.clipboard.writeText(posts.join('\n\n'));
  event.target.innerText = 'Copied ✓';
  setTimeout(()=>{ event.target.innerText = 'Copy all posts'; }, 1200);
}

// ---------- API calls ----------

async function callTranscribeAPI(file){
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('language', selectedLanguage);
  const response = await fetch(TRANSCRIBE_URL, { method: 'POST', body: formData });
  const data = await response.json();
  if(data.error){
    if(response.status === 429){ throw new Error("You've hit today's free limit — please try again tomorrow."); }
    throw new Error(data.error);
  }
  return data.text;
}

async function transcribeWithRetry(file, attempts=2){
  let lastErr;
  for(let i=0; i<attempts; i++){
    try{
      return await callTranscribeAPI(file);
    } catch(err){
      lastErr = err;
      if(err.message.includes("today's free limit")) throw err;
      if(i < attempts-1){ await new Promise(r=>setTimeout(r, 1200)); }
    }
  }
  throw lastErr;
}

async function callGenerateAPI(prompt){
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  });
  const data = await response.json();
  if(data.error){
    if(response.status === 429){ throw new Error("You've hit today's free limit — please try again tomorrow."); }
    throw new Error(data.error);
  }
  let raw = data.content;
  raw = raw.trim().replace(/^```json/,'').replace(/^```/,'').replace(/```$/,'').trim();
  return JSON.parse(raw);
}

async function generateWithRetry(prompt, attempts=2){
  let lastErr;
  for(let i=0; i<attempts; i++){
    try{
      return await callGenerateAPI(prompt);
    } catch(err){
      lastErr = err;
      if(err.message.includes("today's free limit")) throw err;
      if(i < attempts-1){ await new Promise(r=>setTimeout(r, 1200)); }
    }
  }
  throw lastErr;
}

// ---------- Audio upload flow ----------

function canCompressInBrowser(){
  return !!(window.AudioContext || window.webkitAudioContext) && typeof lamejs !== 'undefined';
}

async function compressAudioFile(file, onProgress){
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const arrayBuffer = await file.arrayBuffer();
  const decodeCtx = new AudioContextClass();
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  decodeCtx.close();

  // Downmix to mono + resample to 16kHz — plenty for speech transcription, much smaller file.
  // This step is NOT real-time — it's fast offline rendering regardless of episode length.
  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetRate), targetRate);
  const offlineSource = offlineCtx.createBufferSource();
  offlineSource.buffer = audioBuffer;
  offlineSource.connect(offlineCtx.destination);
  offlineSource.start();
  const renderedBuffer = await offlineCtx.startRendering();
  if(onProgress) onProgress(30);

  // Convert Float32 PCM samples (-1..1) to Int16 PCM, which the MP3 encoder expects
  const floatSamples = renderedBuffer.getChannelData(0);
  const int16Samples = new Int16Array(floatSamples.length);
  for(let i=0; i<floatSamples.length; i++){
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  if(onProgress) onProgress(45);

  // Encode to MP3 — pure computation, also not tied to real-time playback duration
  const mp3encoder = new lamejs.Mp3Encoder(1, targetRate, 32); // mono, 16kHz, 32kbps — fine for speech
  const blockSize = 1152;
  const mp3Chunks = [];
  const totalBlocks = Math.ceil(int16Samples.length / blockSize);
  for(let i=0; i<int16Samples.length; i += blockSize){
    const chunk = int16Samples.subarray(i, i + blockSize);
    const encoded = mp3encoder.encodeBuffer(chunk);
    if(encoded.length > 0) mp3Chunks.push(encoded);
    if(onProgress && (i / blockSize) % 200 === 0){
      const pct = 45 + Math.round((i / blockSize / totalBlocks) * 50);
      onProgress(Math.min(95, pct));
    }
  }
  const finalChunk = mp3encoder.flush();
  if(finalChunk.length > 0) mp3Chunks.push(finalChunk);
  if(onProgress) onProgress(100);

  const blob = new Blob(mp3Chunks, { type: 'audio/mp3' });
  return new File(
    [blob],
    file.name.replace(/\.[^.]+$/, '') + '-compressed.mp3',
    { type: 'audio/mp3' }
  );
}

function showLargeFileHelp(sizeMB){
  const errorBox = document.getElementById('errorBox');
  errorBox.innerHTML = `
    <strong>That file is ${sizeMB.toFixed(1)}MB — the limit is ${MAX_FILE_MB}MB.</strong>
    <div style="margin-top:8px; font-size:12.5px; line-height:1.6;">
      Full episodes are often too big at high quality. Quick fixes:
      <br>• If it's a <strong>video</strong>, most phones let you export/share it as "audio only" or lower quality — this alone usually cuts size by 80%+.
      <br>• Use a free converter like <a href="https://www.freeconvert.com/mp3-compressor" target="_blank" rel="noopener" style="color:var(--accent)">freeconvert.com/mp3-compressor</a> — set bitrate to 64kbps mono, re-upload here.
      <br>• Or trim to just the segment you want repurposed — shorter clips work great too.
    </div>
  `;
  errorBox.classList.add('active');
}

async function handleAudioSelect(event){
  let file = event.target.files[0];
  if(!file) return;

  const dropzone = document.getElementById('dropzone');
  const dropzoneText = document.getElementById('dropzoneText');
  const errorBox = document.getElementById('errorBox');
  errorBox.classList.remove('active');
  transcribedText = '';

  const sizeMB = file.size / (1024*1024);
  if(sizeMB > MAX_FILE_MB){
    if(!canCompressInBrowser()){
      showLargeFileHelp(sizeMB);
      return;
    }

    dropzoneText.innerHTML = `🎙️ Compressing ${escapeHtml(file.name)}…<br><span class="dropzone-sub">0%</span>`;
    dropzone.classList.add('has-file');

    try{
      const compressed = await compressAudioFile(file, (pct) => {
        dropzoneText.innerHTML = `🎙️ Compressing ${escapeHtml(file.name)}…<br><span class="dropzone-sub">${pct}% — usually takes under a minute</span>`;
      });
      const compressedMB = compressed.size / (1024*1024);
      if(compressedMB > MAX_FILE_MB){
        showLargeFileHelp(compressedMB);
        dropzone.classList.remove('has-file');
        return;
      }
      file = compressed; // proceed with the compressed version below
    } catch(err){
      showLargeFileHelp(sizeMB);
      dropzone.classList.remove('has-file');
      return;
    }
  }

  dropzoneText.innerHTML = '🎧 ' + escapeHtml(file.name);
  dropzone.classList.add('has-file');

  document.getElementById('transcribeWave').classList.add('active');
  document.getElementById('transcribeStatus').classList.add('active');

  try{
    transcribedText = await transcribeWithRetry(file);
    dropzoneText.innerHTML = '✅ ' + escapeHtml(file.name) + '<br><span class="dropzone-sub">Transcribed — ready to generate</span>';
  } catch(err){
    if(err.message.includes("today's free limit")){
      errorBox.innerText = err.message;
      errorBox.classList.add('active');
      openInterest();
    } else {
      errorBox.innerText = "Couldn't transcribe that file — tap to try again.";
      errorBox.classList.add('active');
    }
    dropzoneText.innerHTML = '⚠️ ' + escapeHtml(file.name) + '<br><span class="dropzone-sub">Transcription failed, tap to retry</span>';
    dropzone.classList.remove('has-file');
  } finally {
    document.getElementById('transcribeWave').classList.remove('active');
    document.getElementById('transcribeStatus').classList.remove('active');
  }
}

const INTEREST_URL = "https://castforge.rajukumar98763017.workers.dev/interest";

function openInterest(){
  document.getElementById('interestStatus').innerText = '';
  document.getElementById('interestModal').classList.add('active');
}
function closeInterest(){
  document.getElementById('interestModal').classList.remove('active');
}
async function submitInterest(){
  const email = document.getElementById('interestEmail').value.trim();
  const statusEl = document.getElementById('interestStatus');
  if(!email || !email.includes('@')){
    statusEl.style.color = '#ff8080';
    statusEl.innerText = 'Please enter a valid email.';
    return;
  }
  statusEl.style.color = 'var(--accent)';
  statusEl.innerText = 'Saving…';
  try{
    const response = await fetch(INTEREST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    if(!response.ok) throw new Error('failed');
    statusEl.innerText = "You're on the list! 🎉";
    setTimeout(closeInterest, 1400);
  } catch(err){
    statusEl.style.color = '#ff8080';
    statusEl.innerText = "Couldn't save — please try again.";
  }
}

function openPrivacy(){
  document.getElementById('privacyModal').classList.add('active');
}
function closePrivacy(){
  document.getElementById('privacyModal').classList.remove('active');
}

function openFeedback(){
  document.getElementById('feedbackStatus').innerText = '';
  document.getElementById('feedbackModal').classList.add('active');
}
function closeFeedback(){
  document.getElementById('feedbackModal').classList.remove('active');
}
async function submitFeedback(){
  const text = document.getElementById('feedbackText').value.trim();
  const statusEl = document.getElementById('feedbackStatus');
  if(!text){
    statusEl.style.color = '#ff8080';
    statusEl.innerText = 'Please write something first.';
    return;
  }
  statusEl.style.color = 'var(--accent)';
  statusEl.innerText = 'Sending…';
  try{
    const response = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: text })
    });
    if(!response.ok) throw new Error('failed');
    statusEl.innerText = 'Thank you! 🙏';
    document.getElementById('feedbackText').value = '';
    setTimeout(closeFeedback, 1200);
  } catch(err){
    statusEl.style.color = '#ff8080';
    statusEl.innerText = "Couldn't send — please try again.";
  }
}

// ---------- History (saved locally on this device) ----------

const HISTORY_KEY = 'castforge_history';
const MAX_HISTORY = 5;

function saveToHistory(transcript, parsed){
  try{
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const title = transcript.slice(0, 60).replace(/\s+/g,' ').trim() + (transcript.length > 60 ? '…' : '');
    history.unshift({
      id: Date.now(),
      title: title,
      date: new Date().toLocaleString(),
      data: parsed
    });
    while(history.length > MAX_HISTORY) history.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch(e){ /* localStorage unavailable — silently skip, non-critical */ }
}

function getHistory(){
  try{
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch(e){ return []; }
}

function openHistory(){
  const history = getHistory();
  const listEl = document.getElementById('historyList');
  if(history.length === 0){
    listEl.innerHTML = '<div class="history-empty">No saved generations yet — they\'ll show up here after you generate content.</div>';
  } else {
    listEl.innerHTML = history.map(item => `
      <div class="history-item" onclick="loadFromHistory(${item.id})">
        <button class="history-delete" onclick="event.stopPropagation(); deleteFromHistory(${item.id})">✕</button>
        <div class="history-item-title">${escapeHtml(item.title)}</div>
        <div class="history-item-meta">${escapeHtml(item.date)}</div>
      </div>
    `).join('');
  }
  document.getElementById('historyModal').classList.add('active');
}

function closeHistory(){
  document.getElementById('historyModal').classList.remove('active');
}

function loadFromHistory(id){
  const history = getHistory();
  const item = history.find(h => h.id === id);
  if(!item) return;
  renderResults(item.data);
  closeHistory();
  document.getElementById('results').scrollIntoView({behavior:'smooth', block:'start'});
}

function deleteFromHistory(id){
  const history = getHistory().filter(h => h.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  openHistory(); // refresh the list
}

function renderResults(parsed){
  document.getElementById('out-notes').innerText = parsed.show_notes;
  document.getElementById('out-takeaways').innerText = parsed.takeaways;
  document.getElementById('out-blog').innerText = parsed.blog_outline;
  document.getElementById('out-youtube').innerText = parsed.youtube_description || '';
  document.getElementById('out-linkedin').innerText = parsed.linkedin_post || '';

  lastSocialPosts = parsed.social_posts;
  const socialEl = document.getElementById('out-social');
  socialEl.innerHTML = parsed.social_posts.map((p,i)=>
    `<div class="social-post" contenteditable="true"><span class="num" contenteditable="false">${i+1}.</span>${escapeHtml(p)}</div>`
  ).join('');

  document.getElementById('results').classList.add('active');
}
