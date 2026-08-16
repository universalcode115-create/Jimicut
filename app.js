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
const MAX_FILE_MB = 25;

let currentMode = 'audio';
let transcribedText = '';
let selectedLanguage = 'auto';
let lastSocialPosts = [];

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

async function handleAudioSelect(event){
  const file = event.target.files[0];
  if(!file) return;

  const dropzone = document.getElementById('dropzone');
  const dropzoneText = document.getElementById('dropzoneText');
  const errorBox = document.getElementById('errorBox');
  errorBox.classList.remove('active');
  transcribedText = '';

  const sizeMB = file.size / (1024*1024);
  if(sizeMB > MAX_FILE_MB){
    errorBox.innerText = `That file is ${sizeMB.toFixed(1)}MB — please use a file under ${MAX_FILE_MB}MB (try a shorter clip or a compressed audio format).`;
    errorBox.classList.add('active');
    return;
  }

  dropzoneText.innerHTML = '🎧 ' + escapeHtml(file.name);
  dropzone.classList.add('has-file');

  document.getElementById('transcribeWave').classList.add('active');
  document.getElementById('transcribeStatus').classList.add('active');

  try{
    transcribedText = await transcribeWithRetry(file);
    dropzoneText.innerHTML = '✅ ' + escapeHtml(file.name) + '<br><span class="dropzone-sub">Transcribed — ready to generate</span>';
  } catch(err){
    errorBox.innerText = err.message.includes("today's free limit")
      ? err.message
      : "Couldn't transcribe that file — tap to try again.";
    errorBox.classList.add('active');
    dropzoneText.innerHTML = '⚠️ ' + escapeHtml(file.name) + '<br><span class="dropzone-sub">Transcription failed, tap to retry</span>';
    dropzone.classList.remove('has-file');
  } finally {
    document.getElementById('transcribeWave').classList.remove('active');
    document.getElementById('transcribeStatus').classList.remove('active');
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

  lastSocialPosts = parsed.social_posts;
  const socialEl = document.getElementById('out-social');
  socialEl.innerHTML = parsed.social_posts.map((p,i)=>
    `<div class="social-post" contenteditable="true"><span class="num" contenteditable="false">${i+1}.</span>${escapeHtml(p)}</div>`
  ).join('');

  document.getElementById('results').classList.add('active');
}

// ---------- Content generation flow ----------

function buildPrompt(transcript){
  return `You are CastForge, an AI that turns podcast transcripts into ready-to-publish content. Given the transcript below, produce EXACTLY this JSON structure and nothing else — no markdown fences, no preamble:

IMPORTANT LANGUAGE RULE: Write ALL output in the same language the speaker actually used in the transcript. If the transcript is in Hindi, write the output in Hindi using Devanagari script (देवनागरी) — never Urdu script. If the transcript is in English, write in English. If mixed/Hinglish, match that natural mixed style. Do not translate to a different language than the source.

{
  "show_notes": "A well-formatted show notes section with an episode summary paragraph and a bulleted list of topics discussed with rough timestamps if present in the transcript. Use \\n for line breaks.",
  "takeaways": "Exactly 5 key takeaways as a numbered list. Use \\n for line breaks.",
  "social_posts": ["post 1 full text", "... exactly 10 COMPLETE, ready-to-publish social media posts — NOT ideas or suggestions, actual finished posts someone could copy and paste right now. Each post must include a specific hook line pulled from real content in the transcript (a stat, a quote, a contrarian take, a story beat), then 1-3 sentences of substance, then a closing line (question, CTA, or punchy takeaway). Under 280 characters each. Vary the style across the 10: 2-3 as bold one-line statements, 2-3 as mini-stories/anecdotes from the transcript, 2 as questions to spark replies, 2 as numbered-list/quick-tip style, 1 as a contrarian or surprising take. No hashtag spam, no generic filler like 'Check out this episode' — every post must reference a specific, real detail from the transcript."],
  "blog_outline": "A blog post outline with a title, an intro hook, 4-6 H2 section headers with 1-2 line descriptions each, and a conclusion CTA. Use \\n for line breaks."
}

Transcript:
${transcript}`;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function generateContent(){
  const transcript = currentMode === 'audio' ? transcribedText.trim() : document.getElementById('transcript').value.trim();
  const errorBox = document.getElementById('errorBox');
  errorBox.classList.remove('active');

  if(!transcript){
    errorBox.innerText = currentMode === 'audio'
      ? 'Please upload an audio file and wait for transcription to finish.'
      : 'Paste a transcript first, or click "Use a sample transcript".';
    errorBox.classList.add('active');
    return;
  }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerText = 'Generating…';
  document.getElementById('waveform').classList.add('active');
  document.getElementById('statusText').classList.add('active');
  document.getElementById('results').classList.remove('active');

  const prompt = buildPrompt(transcript);

  try{
    const parsed = await generateWithRetry(prompt);

    renderResults(parsed);
    saveToHistory(transcript, parsed);

    document.getElementById('results').scrollIntoView({behavior:'smooth', block:'start'});
  } catch(err){
    errorBox.innerText = err.message.includes("today's free limit")
      ? err.message
      : 'Something went wrong — please try again in a moment.';
    errorBox.classList.add('active');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Generate content →';
    document.getElementById('waveform').classList.remove('active');
    document.getElementById('statusText').classList.remove('active');
  }
    }
      
