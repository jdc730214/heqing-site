'use strict';
/* ═══════════════════════════════════════════════════════════════════
   ICOPE 評估系統 — script.js  (完整重寫版)
   架構：每頁為獨立 async 函式 + token guard 防 callback 洩漏
═══════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────
// 0.  全域常數與 DOM 節點
// ─────────────────────────────────────────────
const synth = window.speechSynthesis;

// _isIOS は audioProcessFromBrowser.js (先に読込) で宣言済み — ここでは使い回す
// _isIOS is declared in audioProcessFromBrowser.js (loaded first) — reused here

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const DOM = {
  pageLabel:    document.getElementById('page-label'),
  deck:         document.querySelector('.deck'),
  nxtbtn:       document.getElementById('nxtbtn'),
  cntWrap:      document.getElementById('countdown-wrap'),
  cntRing:      document.getElementById('progress-ring'),
  cntNum:       document.getElementById('countdown-number'),
  correctOl:    document.getElementById('correct-overlay'),
  earIcon:      document.getElementById('ear-icon'),
  whiteBox:     document.getElementById('white-box'),
  audioViz:     document.getElementById('audio-viz'),
  qText:        document.getElementById('q-text'),
  qHint:        document.getElementById('q-hint'),
  btnReListen:  document.getElementById('btn-ReListen'),
  btnMotion:    document.getElementById('btn-montionStart'),
  motionCount:  document.getElementById('montionCount'),
  motionTime:   document.getElementById('montionTime'),
  ynList:       document.getElementById('yn-list'),
  ynVoiceRow:   document.getElementById('yn-voice-row'),
  permStartBtn: document.getElementById('permStartBtn'),
};

// ─────────────────────────────────────────────
// 1.  PAGE DEFINITIONS
// ─────────────────────────────────────────────
const PAGES = [
  { id: 'card-home',   key: '長者功能評估系統',           type: 'home'   },
  { id: 'card-voice',  key: 'A.認知功能 — 記憶力（記住）', type: 'voice'  },
  { id: 'card-voice',  key: 'A.認知功能 — 定向力（日期）', type: 'voice'  },
  { id: 'card-voice',  key: 'A.認知功能 — 定向力（地點）', type: 'voice'  },
  { id: 'card-voice',  key: 'A.認知功能 — 記憶力（提問）', type: 'voice'  },
  { id: 'card-motion', key: 'B. 行動功能',                 type: 'motion' },
  { id: 'card-yesno',  key: 'C. 營養狀況',                 type: 'yesno'  },
  { id: 'card-yesno',  key: 'D. 視力狀況',                 type: 'yesno'  },
  { id: 'card-voice',  key: 'E. 聽力狀況',                 type: 'voice'  },
  { id: 'card-yesno',  key: 'F. 憂鬱狀況',                 type: 'yesno'  },
  { id: 'card-result', key: 'ICOPE — 測試結果',            type: 'result' },
];

// ─────────────────────────────────────────────
// 2.  NAVIGATION STATE
// ─────────────────────────────────────────────
let _pageIndex  = 0;
let _pageToken  = 0;   // 每次換頁遞增，所有 async callback 用它來判斷是否已失效
let _cntTimer   = null;
let _cntTotal   = 0;
let _cntCurrent = 0;
let _ttsGen     = 0;   // 每次 synth.cancel() 前遞增，防 onend callback 洩漏

// ─────────────────────────────────────────────
// 3.  BUTTON CLICK SOUND  (按鍵音)
// ─────────────────────────────────────────────
let _clickCtx = null;

function _playClickSound() {
  try {
    if (!_clickCtx || _clickCtx.state === 'closed') {
      _clickCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = _clickCtx;
    if (ctx.state === 'suspended') ctx.resume();

    // 短促頻率下掃的「叩」聲 / Short frequency-sweep "tap" tone
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch (_) {}
}

// 捕獲階段監聽所有 <button> 點擊（含 license.js 的授權確認按鈕）
document.addEventListener('click', (e) => {
  if (e.target.closest('button')) _playClickSound();
}, true);

// ─────────────────────────────────────────────
// 4.  CORE NAVIGATION
// ─────────────────────────────────────────────
function goToNext() { goToPage(_pageIndex + 1); }

function goToPage(index) {
  if (index < 0 || index >= PAGES.length) return;

  // 1. 使所有舊 callback 失效
  _pageToken++;
  _ttsGen++;
  synth.cancel();
  _stopCountdown();
  _stopRecognition();
  _hideEar();
  _hideNxt();
  _clearWhiteBox();
  DOM.btnReListen.style.display = 'none';
  DOM.ynVoiceRow.style.display = 'none';

  const prevPage = PAGES[_pageIndex];
  const nextPage = PAGES[index];

  // 首頁時讓 app-shell 背景與 home card 漸層一致
  const shell = document.querySelector('.app-shell');
  if (index === 0) shell.classList.add('is-home');
  else shell.classList.remove('is-home');

  // 2. 卡片動畫
  _animateCards(prevPage.id, nextPage.id, () => {
    _pageIndex = index;
    DOM.pageLabel.textContent = nextPage.key;
    _setupPage(index, _pageToken);
  });
}

function _animateCards(outId, inId, done) {
  const outEl = document.getElementById(outId);
  const inEl  = document.getElementById(inId);

  if (outEl === inEl) {
    // 同一張卡（e.g. 連續語音題）：複製殘影做離場
    const ghost = outEl.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.classList.remove('active');
    ghost.classList.add('exit');
    ghost.style.pointerEvents = 'none';
    outEl.parentNode.insertBefore(ghost, outEl);
    outEl.classList.remove('active');
    setTimeout(() => ghost.remove(), 400);
  } else {
    if (outEl) {
      outEl.classList.add('exit');
      outEl.classList.remove('active');
      setTimeout(() => outEl.classList.remove('exit'), 400);
    }
  }

  // 新卡進場（延遲 40ms 錯開）
  setTimeout(() => {
    inEl.classList.remove('enter', 'active');
    void inEl.offsetWidth;
    inEl.classList.add('active', 'enter');
    setTimeout(() => { inEl.classList.remove('enter'); done(); }, 420);
  }, 40);
}

// ─────────────────────────────────────────────
// 5.  PAGE SETUP DISPATCHER
// ─────────────────────────────────────────────
function _setupPage(index, token) {
  const guard = () => token === _pageToken;
  switch (index) {
    case 0:  _setupHome(guard);    break;
    case 1:  _setupVoiceMem1(guard); break;
    case 2:  _setupVoiceDate(guard); break;
    case 3:  _setupVoiceCity(guard); break;
    case 4:  _setupVoiceMem2(guard); break;
    case 5:  _setupMotion(guard);  break;
    case 6:  _setupYesNo6(guard);  break;
    case 7:  _setupYesNo7(guard);  break;
    case 8:  _setupVoiceHear(guard); break;
    case 9:  _setupYesNo9(guard);  break;
    case 10: _setupResult(guard);  break;
  }
}

// ─────────────────────────────────────────────
// 5.  TTS  (Promise-based, 可取消)
// ─────────────────────────────────────────────
function _speak(text, rate = 0.9, guard = () => true) {
  return new Promise((resolve, reject) => {
    if (!guard()) { reject('cancelled'); return; }
    const myGen = ++_ttsGen;
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = 'zh-TW';
    u.rate  = rate;

    let _called = false;
    const done = () => {
      if (_called) return;  // 防雙重觸發
      _called = true;
      clearTimeout(fallback);
      _hideTTSViz();
      if (myGen === _ttsGen && guard()) resolve();
      else reject('cancelled');
    };
    u.onend   = done;
    u.onerror = done;  // 發生錯誤也要繼續，不能卡住

    // 保底 timeout：若 onend 意外不觸發（Chrome 已知 bug），最多等語音長度 + 3 秒
    const estMs = Math.max(3000, (text.length / rate) * 200);
    const fallback = setTimeout(done, estMs);

    isStopRecognition = true;
    _showTTSViz();
    synth.speak(u);
  });
}

// ─────────────────────────────────────────────
// 6.  AUDIO FILE PLAYBACK  (Promise-based)
// ─────────────────────────────────────────────
function _playAudio(id, guard = () => true) {
  return new Promise((resolve, reject) => {
    if (!guard()) { reject('cancelled'); return; }
    const el = document.getElementById(id);
    if (!el) { reject('no element'); return; }
    el.currentTime = 0;
    const doPlay = () => {
      el.play().catch(reject);
      el.addEventListener('ended', () => {
        if (guard()) resolve(); else reject('cancelled');
      }, { once: true });
    };
    if (el.readyState >= 2) {
      doPlay();
    } else {
      el.load();
      // canplaythrough 有時不觸發，加 3s 保底
      const fallback = setTimeout(doPlay, 3000);
      el.addEventListener('canplaythrough', () => {
        clearTimeout(fallback);
        doPlay();
      }, { once: true });
    }
  });
}

// ─────────────────────────────────────────────
// 7.  COUNTDOWN
// ─────────────────────────────────────────────
function _startCountdown(sec, guard, onEnd) {
  _stopCountdown();
  if (!guard()) return;
  _cntTotal   = sec;
  _cntCurrent = sec;
  DOM.cntNum.textContent = sec;
  DOM.cntWrap.classList.add('visible');
  _updateRing(sec, sec);

  _cntTimer = setInterval(() => {
    if (!guard()) { _stopCountdown(); return; }
    _cntCurrent--;
    _updateRing(_cntCurrent, _cntTotal);
    DOM.cntNum.textContent = _cntCurrent;
    if (_cntCurrent <= 0) {
      _stopCountdown();
      if (guard() && onEnd) onEnd();
    }
  }, 1000);
}

function _stopCountdown() {
  if (_cntTimer) { clearInterval(_cntTimer); _cntTimer = null; }
  DOM.cntWrap.classList.remove('visible');
}

function _updateRing(cur, total) {
  const deg = (cur / total) * 360;
  DOM.cntRing.style.background =
    `conic-gradient(var(--primary-light) ${deg}deg, #CFD8DC ${deg}deg)`;
}

// ─────────────────────────────────────────────
// 8.  NEXT BUTTON
// ─────────────────────────────────────────────
function _showNxt() { DOM.nxtbtn.classList.add('visible'); }
function _hideNxt() { DOM.nxtbtn.classList.remove('visible'); }
DOM.nxtbtn.addEventListener('click', goToNext);

// ─────────────────────────────────────────────
// 9.  SPEECH RECOGNITION
// ─────────────────────────────────────────────
let audioProcessorFromBrowser = null;
let isStopRecognition = true;
let _recHandler = null;

function _stopRecognition() {
  isStopRecognition = true;
  if (_recHandler) {
    document.removeEventListener('audioProcessed', _recHandler);
    _recHandler = null;
  }
  // iOS：換題時保留引擎繼續運行，不銷毀。
  //   原因：iOS 重啟 SR 需要使用者手勢；換頁是從 setTimeout 回呼觸發，
  //   不在手勢路徑中，呼叫 start() 會靜默失敗。
  //   isStopRecognition=true 已確保此題結果不會被下一題的 handler 接收。
  // Android/Desktop：每次都銷毀，下題重新建立乾淨物件。
  if (!_isIOS && audioProcessorFromBrowser) audioProcessorFromBrowser.stopRecognition();
}

/** 評估結束或離開頁面時呼叫，不論平台都完全銷毀引擎 */
function _hardStopRecognition() {
  isStopRecognition = true;
  if (_recHandler) {
    document.removeEventListener('audioProcessed', _recHandler);
    _recHandler = null;
  }
  if (audioProcessorFromBrowser) audioProcessorFromBrowser.stopRecognition();
}

function _startRecognition(guard, onResult) {
  if (!audioProcessorFromBrowser) return;
  // 移除舊 handler
  if (_recHandler) {
    document.removeEventListener('audioProcessed', _recHandler);
    _recHandler = null;
  }
  isStopRecognition = true;   // 新引擎啟動前先鎖定，避免舊引擎殘留結果漏進來

  _recHandler = (e) => {
    if (!guard() || isStopRecognition) return;
    const { transcript } = e.detail;
    if (!transcript) return;
    onResult(transcript);
  };
  document.addEventListener('audioProcessed', _recHandler);

  // 每題都建立全新的 SpeechRecognition 物件（Android 相容性關鍵）：
  // TTS 播放時 Android 會強制停止舊引擎，若舊物件卡在錯誤狀態
  // 直接 start() 會靜默失敗。新物件保證乾淨啟動。
  audioProcessorFromBrowser.restartForQuestion(() => {
    if (!guard()) return;
    isStopRecognition = false;
    _showEar();
  });
}

// ─────────────────────────────────────────────
// 10.  TRANSCRIPT HELPERS
// ─────────────────────────────────────────────
function _normalize(t) {
  // 中文位數 → 移除百十，剩單字
  t = t
    .replace(/([零一二三四五六七八九])百([零一二三四五六七八九])十([零一二三四五六七八九])/g, (_, a, b, c) => a+b+c)
    .replace(/([零一二三四五六七八九])百零([零一二三四五六七八九])/g, (_, a, b) => a+'零'+b)
    .replace(/([零一二三四五六七八九])百/g, (_, a) => a+'零零')
    .replace(/([零一二三四五六七八九])十([零一二三四五六七八九])/g, (_, a, b) => a+b)
    .replace(/十([零一二三四五六七八九])/g, (_, b) => '一'+b)
    .replace(/([零一二三四五六七八九])十/g, (_, a) => a+'零');
  // 中文數字 → 阿拉伯
  const map = { 零:'0',一:'1',二:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9' };
  t = t.replace(/[零一二三四五六七八九]/g, c => map[c]);
  return t.trim();
}

function _applySimilar(t, sim) {
  for (const [correct, list] of Object.entries(sim)) {
    t = t.replace(new RegExp(list.join('|'), 'g'), correct);
  }
  return t;
}

function _highlight(t, keywords) {
  if (!keywords.length) return t;
  const pat = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return t.replace(new RegExp(pat, 'g'), m => `<span class="kw-match">${m}</span>`);
}

function _updateWhiteBox(html) {
  let p = DOM.whiteBox.querySelector('p.cur');
  if (!p) { p = document.createElement('p'); p.className = 'cur'; DOM.whiteBox.appendChild(p); }
  p.innerHTML = html;
}

function _clearWhiteBox() { DOM.whiteBox.innerHTML = ''; }

// ─────────────────────────────────────────────
// 11.  AUDIO VISUALIZER
// ─────────────────────────────────────────────
const VIZ_SCALES = [1.2, 1.6, 2.0, 2.2, 2.0, 1.6, 1.2];
const VIZ_DURS   = [.44,.40,.36,.48,.38,.42,.46];

function _showTTSViz() {
  const bars = $$('.viz-bar', DOM.audioViz);
  bars.forEach((b, i) => {
    b.classList.add('tts-wave');
    b.style.setProperty('--scale', VIZ_SCALES[i]);
    b.style.setProperty('--dur',   VIZ_DURS[i] + 's');
    b.style.animationDelay = (i * 0.06) + 's';
  });
}

function _hideTTSViz() {
  $$('.viz-bar', DOM.audioViz).forEach(b => {
    b.classList.remove('tts-wave');
    b.style.transform = 'scaleY(0.15)';
  });
}

// ─────────────────────────────────────────────
// 12.  EAR ICON
// ─────────────────────────────────────────────
function _showEar() { DOM.earIcon.style.display = 'block'; }
function _hideEar()  { DOM.earIcon.style.display = 'none';  }

// ─────────────────────────────────────────────
// 13.  CORRECT OVERLAY
// ─────────────────────────────────────────────
function _showCorrect() {
  DOM.correctOl.classList.add('show');
  setTimeout(() => DOM.correctOl.classList.remove('show'), 1400);
}

// ─────────────────────────────────────────────
// 14.  TYPEWRITER EFFECT
// ─────────────────────────────────────────────
function _typewrite(el, text, ms = 80) {
  if (el._tw) clearTimeout(el._tw);
  el.textContent = '';
  let i = 0;
  (function next() {
    if (i < text.length) {
      el.textContent += text[i++];
      const isPunct = /[，。！？、：；\n]/.test(text[i-1]);
      el._tw = setTimeout(next, isPunct ? ms * 2.5 : ms);
    }
  })();
}

// ─────────────────────────────────────────────
// 15.  PERMISSION INIT  (首頁授權)
// ─────────────────────────────────────────────
const _permState = { sensor: false, location: false, mic: false };
let userInCity = ''; // GPS 取得的縣市
let _globalStream = null;
let _globalAudioCtx = null;

// ── Screen Wake Lock ─────────────────────────────────────────────────
// 評估期間防止螢幕自動變暗（Chrome Android 84+ / Safari iOS 16.4+）
let _wakeLock = null;

async function _requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (_wakeLock) return; // 已持有
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (_) { /* 不支援或拒絕時靜默略過 */ }
}

function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
}

// 頁面從背景回來時：重新取得 Wake Lock + 復活已死的 SR 引擎
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  // 1. Wake Lock 被瀏覽器在背景時自動釋放，重新申請
  await _requestWakeLock();
  // 2. 若 SR 應運行但引擎已被暫停，重建並重啟
  //    visibilitychange=visible 由使用者手勢（點亮螢幕/切回分頁）觸發，
  //    iOS 應允許此路徑呼叫 start()。
  if (audioProcessorFromBrowser && !isStopRecognition) {
    audioProcessorFromBrowser.reviveIfDead();
  }
});

function _setBadge(id, cls, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'perm-badge ' + cls;
  el.textContent = text;
}

function _checkAllPerms() {
  const { sensor, location, mic } = _permState;
  if (sensor && location && mic) {
    DOM.permStartBtn.textContent = '開始評估 ▶';
    DOM.permStartBtn.disabled = false;
    DOM.permStartBtn.onclick = _startAssessment;
  }
}

async function _initPermissions() {
  DOM.permStartBtn.disabled = true;
  DOM.permStartBtn.textContent = '授權中…';

  // Sensor
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      _permState.sensor = r === 'granted';
    } else { _permState.sensor = true; }
  } catch { _permState.sensor = false; }
  _setBadge('perm-sensor', _permState.sensor ? 'ok' : 'fail', _permState.sensor ? '已授權' : '未授權');

  // Location
  try {
    await new Promise((res) => {
      navigator.geolocation.getCurrentPosition(pos => {
        _permState.location = true;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-TW`)
          .then(r => r.json())
          .then(data => {
            const addr = data.address || {};
            userInCity = addr.county || addr.city || addr.state || '';
            console.log('GPS 縣市:', userInCity);
          })
          .catch(() => {});
        res();
      }, () => { _permState.location = false; res(); });
    });
  } catch { _permState.location = false; }
  _setBadge('perm-location', _permState.location ? 'ok' : 'fail', _permState.location ? '已授權' : '未授權');

  // Microphone + SpeechRecognition pre-warm
  try {
    if (!_isIOS) {
      // Android/Desktop: 用 getUserMedia 預先取得麥克風授權，再釋放 stream，
      // 接著由 SpeechRecognition 自行取用麥克風。
      // iOS 不做此步驟：SR 自行處理麥克風授權；
      //   且 getUserMedia 與已在運行的 SR 競用麥克風可能造成衝突。
      _globalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _globalStream.getTracks().forEach(t => t.stop());
      _globalStream = null;
    }
    _globalAudioCtx = new (window.AudioContext || window['webkitAudioContext'])();
    if (!audioProcessorFromBrowser) {
      // iOS: 引擎已由 _permBtnClick() 在同步手勢路徑中建立並啟動，此處跳過。
      // Android/Desktop: 在此建立引擎（非 iOS 無手勢限制）。
      audioProcessorFromBrowser = new AudioProcessFromBrowser();
      const ok = audioProcessorFromBrowser.initRecognition();
      if (ok) {
        audioProcessorFromBrowser.startRecognition();
        isStopRecognition = true;
      }
    }
    _permState.mic = true;
  } catch { _permState.mic = false; }
  _setBadge('perm-mic', _permState.mic ? 'ok' : 'fail', _permState.mic ? '已授權' : '未授權');

  _checkAllPerms();
  if (!(_permState.sensor && _permState.location && _permState.mic)) {
    DOM.permStartBtn.textContent = '重試授權';
    DOM.permStartBtn.disabled = false;
    DOM.permStartBtn.onclick = _permBtnClick;
  }
}

/**
 * 授權按鈕的統一入口。
 * iOS 需要在手勢的同步路徑中呼叫 SR.start()；任何 await 都會打斷手勢鏈
 * 導致 not-allowed。因此在進入 async 的 _initPermissions() 之前，
 * 先同步建立並啟動 SR 引擎（iOS only）。
 */
function _permBtnClick() {
  if (_isIOS) {
    // ① TTS 解鎖：iOS 要求第一次 speak() 必須在手勢同步路徑中呼叫，
    //   之後 setTimeout 裡的 speak() 才能正常播放。
    //   用無聲 utterance 在此建立 TTS session。
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch (_) {}

    // ② AudioContext 解鎖：Web Audio API 在 iOS 也需在手勢中 resume
    try {
      if (_clickCtx && _clickCtx.state === 'suspended') _clickCtx.resume();
    } catch (_) {}

    // ③ SR 啟動：iOS 要求 start() 在手勢同步路徑中（任何 await 後就失效）
    if (!audioProcessorFromBrowser) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        audioProcessorFromBrowser = new AudioProcessFromBrowser();
        if (audioProcessorFromBrowser.initRecognition()) {
          audioProcessorFromBrowser.startRecognition();  // 同步，在手勢路徑中 ✓
          isStopRecognition = true;
        }
      }
    }
  }
  _initPermissions();
}

DOM.permStartBtn.onclick = _permBtnClick;

// iOS 靜音模式提醒：硬體靜音鍵會完全停用 Web Audio 與 TTS，網頁端無法繞過
// 在授權面板底部插入提示文字
if (_isIOS) {
  const panel = document.querySelector('.perm-panel');
  if (panel) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.73rem;color:#c44;margin-top:0.6rem;text-align:left;line-height:1.4;';
    note.textContent = '⚠️ iOS 裝置：若聽不到聲音，請確認手機側面的靜音開關已關閉。';
    panel.appendChild(note);
  }
}

function _startAssessment() {
  DOM.permStartBtn.disabled = true;
  // 清除上一次的答案，避免舊資料殘留到結果頁
  SharedStorage.clear();
  // 申請螢幕常亮（評估期間不讓螢幕變暗）
  _requestWakeLock();
  // iOS：在此手勢路徑中再次確保 TTS / AudioContext 已解鎖。
  // 第一題的 speak() 從 setTimeout 觸發，不在手勢中；
  // 此處（"開始評估" 按鈕 click）的 unlock 讓 iOS 接受後續非手勢 speak()。
  if (_isIOS) {
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch (_) {}
    try {
      if (_clickCtx && _clickCtx.state === 'suspended') _clickCtx.resume();
    } catch (_) {}
  }
  // 首頁 icon 飛散動畫後進入第一題
  _iconBurst(() => goToPage(1));
}

// ─────────────────────────────────────────────
// 16.  HOME — ICON BURST ANIMATION
// ─────────────────────────────────────────────
function _iconBurst(done) {
  const orbits = [1,2,3,4,5,6].map(i => document.getElementById(`io${i}`));
  // 最大展開半徑 = app shell 實際寬度的 28%（直徑不超過 56%），最小 120px
  const shellW = document.querySelector('.app-shell').offsetWidth;
  const R = Math.max(120, shellW * 0.28);
  orbits.forEach((el, i) => {
    const angle = (360 / 6) * i;
    el.style.transition = 'transform 0.7s cubic-bezier(0.4,0,0.2,1)';
    el.style.transform  = `translate(-50%,-50%) translate(${R * Math.cos(angle * Math.PI/180)}px, ${R * Math.sin(angle * Math.PI/180)}px)`;
  });
  setTimeout(() => {
    orbits.forEach((el) => {
      el.style.transition = 'transform 1s cubic-bezier(0.4,0,0.2,1)';
      el.style.transform  = 'translate(-50%,-50%)';
    });
    setTimeout(done, 800);
  }, 900);
}

// Init icon positions (close-in at centre)
(function _initIcons() {
  [1,2,3,4,5,6].forEach((n, i) => {
    const el = document.getElementById(`io${n}`);
    const R = 48, angle = (360/6) * i;  // idle orbit radius
    el.style.transform = `translate(-50%,-50%) translate(${R * Math.cos(angle * Math.PI/180)}px, ${R * Math.sin(angle * Math.PI/180)}px)`;
    el.style.top = '50%'; el.style.left = '50%';
  });
})();

// ─────────────────────────────────────────────
// 17.  PAGE SETUPS
// ─────────────────────────────────────────────

/* ── 共用語音題設定 ── */
async function _voicePage({ guard, question, hint, say, keywords, similar, saveKey, checkFn, playAudioId = null, showReListen = false }) {
  DOM.btnReListen.style.display = 'none';
  _typewrite(DOM.qText, question, 90);
  _typewrite(DOM.qHint, hint, 60);

  try {
    await _speak(say, 0.9, guard);
    if (!guard()) return;

    if (playAudioId) {
      await _playAudio(playAudioId, guard);
      if (!guard()) return;
      if (showReListen) DOM.btnReListen.style.display = 'flex';
    }

    _startRecognition(guard, (raw) => {
      const t = _applySimilar(_normalize(raw), similar);
      _updateWhiteBox(_highlight(t, keywords));

      // 判斷答對（checkFn 存在用 checkFn，否則用 keywords 全匹配；兩者至少有一個才能自動跳）
      const isCorrect = checkFn ? checkFn(t) : keywords.every(k => new RegExp(k).test(t));
      if (isCorrect && (checkFn || keywords.length > 0)) {
        // 立刻鎖定辨識，防止後續 interim 結果蓋掉白板
        isStopRecognition = true;
        _hideEar();
        _stopCountdown();
        // 等瀏覽器渲染完白板文字這一幀，再顯示綠勾跳題
        requestAnimationFrame(() => {
          if (!guard()) return;
          const a3 = document.getElementById('audio3');
          if (a3) a3.play().catch(() => {});
          _showCorrect();
          if (saveKey) SharedStorage.set(saveKey, { value: t, result: true });
          setTimeout(() => { if (guard()) goToNext(); }, 1500);
        });
      } else {
        if (saveKey) SharedStorage.set(saveKey, { value: t, result: false });
      }
    });

    _startCountdown(30, guard, () => {
      if (!guard()) return;
      _stopRecognition();
      _hideEar();
      _showNxt();
    });

  } catch (_) { /* cancelled */ }
}

/* 0. 首頁 */
function _setupHome(_guard) {
  // 首頁由 permission panel 自己控制，不需要額外初始化
}

/* 1. 記憶力：記住 */
function _setupVoiceMem1(guard) {
  _voicePage({
    guard,
    question: '請跟著唸這三項物品並記住：鉛筆、汽車、書。',
    hint:     '在倒數秒完數結束之前記下來。',
    say:      '請跟著唸這三項物品並記住：鉛筆、汽車、書。',
    keywords: [],  // 這題只要記住，不辨識答案
    similar:  {},
    saveKey:  null,
    checkFn:  () => false, // 不自動跳
  });
}

/* 2. 定向力：日期 */
function _setupVoiceDate(guard) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const d = today.getDate();

  // 儲存正確答案
  SharedStorage.set('q2_q', { value: `${y}年${m}月${d}日` });

  _voicePage({
    guard,
    question: '請說出今天西元幾年幾月幾日。',
    hint:     '說出西元年、月、日',
    say:      '請說出今天西元幾年幾月幾日。',
    keywords: [],
    similar:  {},
    saveKey:  'q2_a',
    checkFn:  (t) => {
      const ys = String(y);
      const ms = String(m);
      const ds = String(d);
      // 年：4位數，不易碰撞，直接比對
      const hasY = t.includes(ys);
      // 月：(?<![0-9]) 前瞻確保數字前不是另一個數字
      //   避免「11月」被月份=1誤判、「13日」被日期=3誤判
      const hasM = new RegExp('(?<![0-9])' + ms + '[月份]').test(t);
      // 日：同上，前瞻防止子數字碰撞
      const hasD = new RegExp('(?<![0-9])' + ds + '[日號]').test(t);

      // 至少說對 2 個部分（允許省略其中一個部分）
      const correct = [hasY, hasM, hasD].filter(Boolean).length;
      if (correct < 2) return false;

      // 若有說年份（數字+年）但不是今年 → 錯
      const wrongYear  = !hasY && /\d{4}年/.test(t);
      // 若有說月份（數字+月/份）但不是今月（同樣加前瞻）→ 錯
      const wrongMonth = !hasM && new RegExp('(?<![0-9])\\d+[月份]').test(t);
      // 若有說日期（數字+日/號）但不是今日（同樣加前瞻）→ 錯
      const wrongDay   = !hasD && new RegExp('(?<![0-9])\\d+[日號]').test(t);

      return !(wrongYear || wrongMonth || wrongDay);
    },
  });
}

/* 3. 定向力：縣市 */
function _setupVoiceCity(guard) {
  const city = userInCity || '縣市';
  SharedStorage.set('q3_q', { value: city });

  _voicePage({
    guard,
    question: '請說出你現在在哪個縣市。',
    hint:     '例如：新北市、台中市',
    say:      '請說出你現在在哪個縣市。',
    keywords: city ? [city.replace(/[市縣]/g, '')] : [],
    similar:  {},
    saveKey:  'q3_a',
    checkFn:  (t) => city ? t.includes(city.replace(/[市縣]/g, '')) : false,
  });
}

/* 4. 記憶力：提問 */
function _setupVoiceMem2(guard) {
  _voicePage({
    guard,
    question: '請說出一開始要你記住的三項東西。',
    hint:     '請說出您記住的三項物品名稱',
    say:      '請說出一開始要你記住的三項東西。',
    keywords: ['鉛筆', '汽車', '書'],
    similar: {
      '鉛筆': ['鉛比', '鉛必', '前筆', '簽筆', '千筆', '鉛比', '年筆', '前比', '簽比'],
      '汽車': ['棄車', '其車', '七車', '氣車', '起車', '騎車'],
      '書':   ['數', '鼠', '樹', '熟', '述', '疏'],
    },
    saveKey: 'q1_a',
    checkFn: null, // 用預設 every keyword
  });
}

/* 5. 行動功能 */
let _motionDetector = null;
let _udCount = 0, _udTime = 0;

function _setupMotion(guard) {
  DOM.motionCount.textContent = '0';
  DOM.motionTime.textContent  = '--';
  _udCount = 0; _udTime = 0;
  DOM.btnMotion.style.display = 'none';
  _hideNxt();

  _speak('準備好椅子放在身體後方，連續坐站 5 次，按下開始按鈕後開始動作。', 0.9, guard)
    .then(() => {
      if (!guard()) return;
      DOM.btnMotion.style.display = 'flex';
    })
    .catch(() => {});
}

DOM.btnMotion.addEventListener('click', function() {
  if (_pageIndex !== 5) return;
  DOM.btnMotion.style.display = 'none';
  const pageGuard = (() => { const t = _pageToken; return () => t === _pageToken; })();

  if (_motionDetector) { _motionDetector.stopDetection(); _motionDetector = null; }
  _motionDetector = new MotionDetection({
    maxCount:      5,      // 目標 5 次坐站（站→坐→站 = 1 次）
    upperThresh:   1.2,    // 偵測站起的 Y 軸閾值 (m/s²)
    lowerThresh:   0.5,    // 回靜止的閾值
    minIntervalMs: 800,    // 連續兩次計數最短間隔
    emaAlpha:      0.3,
    timeoutSec:    300,
    onPeakCount: (count) => {
      if (!pageGuard()) return;
      _udCount = count;
      DOM.motionCount.textContent = count;
      _speak(String(count), 1, () => true);
    },
    onComplete: ({ totalTime, count, isTimeout }) => {
      if (!pageGuard()) return;
      _udCount = count;
      _udTime  = parseFloat(totalTime) || 0;
      DOM.motionCount.textContent = count;
      DOM.motionTime.textContent  = _udTime;
      _stopCountdown();
      const msg = isTimeout ? '時間到！' : '測試完成！';
      _speak(msg, 1, () => true).then(() => {
        _saveMotionResult();
        _showNxt();
      }).catch(() => {});
      if (_motionDetector) { _motionDetector.stopDetection(); _motionDetector = null; }
    },
  });
  _motionDetector.startDetection();
  _startCountdown(300, pageGuard, () => {
    // 300s 逾時 fallback（onComplete 的 isTimeout 已處理，此處補保險）
    if (!_motionDetector) return;
    _udTime = 300;
    _saveMotionResult();
    _showNxt();
  });
});

function _saveMotionResult() {
  const pass = _udCount >= 5 && _udTime < 12;
  SharedStorage.set('q4_a_q1', { value: _udCount, result: _udCount >= 5 });
  SharedStorage.set('q4_a_q2', { value: _udTime,  result: pass });
}

/* 6. 營養狀況 */
function _setupYesNo6(guard) {
  _setupYesNoPage(guard, [
    '1. 過去三個月您的體重是否在無意間減輕 3 公斤以上？',
    '2. 過去三個月是否食慾不振？',
  ], 'q5_a');
}

/* 7. 視力狀況 */
function _setupYesNo7(guard) {
  _setupYesNoPage(guard, [
    '您的眼睛看遠、看近或閱讀是否有困難？',
  ], 'q6_a');
}

/* 9. 憂鬱狀況 */
function _setupYesNo9(guard) {
  _setupYesNoPage(guard, [
    '1. 過去兩週你是否感到厭煩、心煩，或沒有希望？',
    '2. 過去兩週你是否減少很多活動和感興趣的事？',
  ], 'q8_a');
}

/* ── 共用是/否題設定 ── */
function _setupYesNoPage(guard, questions, saveKey) {
  _hideNxt();
  const answers = {};

  // 建立 rows
  DOM.ynList.innerHTML = '';
  questions.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'yn-row';
    row.dataset.qi = i;
    row.innerHTML = `
      <p class="yn-q">${q}</p>
      <div class="yn-btns">
        <button class="yn-btn no-btn">否</button>
        <button class="yn-btn yes-btn">是</button>
      </div>`;
    DOM.ynList.appendChild(row);

    row.querySelector('.yes-btn').addEventListener('click', () => {
      _ynAnswer(row, i, '是', answers, questions.length, saveKey, guard);
    });
    row.querySelector('.no-btn').addEventListener('click', () => {
      _ynAnswer(row, i, '否', answers, questions.length, saveKey, guard);
    });
  });

  // 唸一句提示，不逐題朗讀
  _speak('看完題目請自行點選是或否。', 0.9, guard).catch(() => {});
}

function _ynAnswer(row, qi, val, answers, total, saveKey, guard) {
  if (!guard()) return;
  answers[qi] = val;
  // 更新按鈕樣式
  row.querySelectorAll('.yn-btn').forEach(b => b.classList.remove('yes-active', 'no-active'));
  row.querySelector(val === '是' ? '.yes-btn' : '.no-btn').classList.add(val === '是' ? 'yes-active' : 'no-active');
  row.classList.remove('answered-yes', 'answered-no');
  row.classList.add(val === '是' ? 'answered-yes' : 'answered-no');

  // 全部回答完畢才顯示下一步
  if (Object.keys(answers).length >= total) {
    // 整理 {q1: 是, q2: 否}
    const result = {};
    for (let i = 0; i < total; i++) result[`q${i+1}`] = answers[i];
    SharedStorage.set(saveKey, { value: result, result: null });
    _stopRecognition();
    DOM.ynVoiceRow.style.display = 'none';
    _showNxt();
  }
}

/* 8. 聽力狀況 */
function _setupVoiceHear(guard) {
  _voicePage({
    guard,
    question: '請唸出你聽到的數字。',
    hint:     '專心聆聽音檔，唸出聽到的數字',
    say:      '請唸出你聽到的數字。',
    keywords: ['619'],
    similar:  {
      '619': ['6與9','61球','六羽球','六一九','六百一十九','六百十九','6一9','六19','六一玖','六壹九'],
    },
    saveKey: 'q7_a',
    // 619：數字本身或「六」「一」「九」分開說都算對
    checkFn: (t) => t.includes('619') || /六.{0,2}一.{0,2}九/.test(t),
    playAudioId: 'audio1',
    showReListen: true,
  });
}

// 重新聆聽按鈕
DOM.btnReListen.addEventListener('click', async () => {
  if (_pageIndex !== 8) return;
  const guard = (() => { const t = _pageToken; return () => t === _pageToken; })();
  isStopRecognition = true;
  _stopCountdown();
  try {
    await _playAudio('audio4', guard);
    if (!guard()) return;
    _startRecognition(guard, (raw) => {
      const t = _applySimilar(_normalize(raw), { '619': ['6與9','61球','六羽球','六一九','六百一十九','六百十九','6一9','六19','六一玖','六壹九'] });
      _updateWhiteBox(_highlight(t, ['619']));
      if (t.includes('619') || /六.{0,2}一.{0,2}九/.test(t)) {
        isStopRecognition = true;
        _hideEar();
        _stopCountdown();
        const a3 = document.getElementById('audio3'); if (a3) a3.play().catch(() => {});
        _showCorrect();
        SharedStorage.set('q7_a', { value: t, result: true });
        setTimeout(() => { if (guard()) goToNext(); }, 1500);
      } else {
        SharedStorage.set('q7_a', { value: t, result: false });
      }
    });
    _startCountdown(30, guard, () => {
      if (!guard()) return;
      _stopRecognition();
      _hideEar();
      _showNxt();
    });
  } catch (_) {}
});

/* 10. 結果頁 */
const USE_URL = 'https://bodygo-web-backend-anfsetcnf4g9g8cq.eastasia-01.azurewebsites.net/api/icope/use'

async function _recordUse() {
  try {
    const cache = JSON.parse(localStorage.getItem('icope_license_v1') || 'null')
    if (!cache?.code) return
    const res = await fetch(`${USE_URL}?code=${encodeURIComponent(cache.code)}`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    if (!data.success) {
      console.warn('ICOPE use record failed:', data.reason)
    }
  } catch (e) {
    // 離線或網路問題：靜默忽略，不影響結果顯示
    console.warn('ICOPE use record error:', e)
  }
}

function _setupResult(_guard) {
  _hideNxt();
  DOM.btnReListen.style.display = 'none';
  // 評估完成：完全銷毀 SR 引擎（iOS 也包含）
  _hardStopRecognition();
  // 評估完成，釋放螢幕常亮鎖（結果頁不需要繼續佔用）
  _releaseWakeLock();
  // 評估完成，記錄一次使用次數（非同步，不阻塞結果顯示）
  _recordUse();

  const today = new Date();
  document.getElementById('result-date').textContent =
    `${today.getFullYear()} 年 ${today.getMonth()+1} 月 ${today.getDate()} 日`;

  // ── A 認知 ──
  const q1 = SharedStorage.get('q1_a');
  const q2 = SharedStorage.get('q2_a');
  const q3 = SharedStorage.get('q3_a');
  const q2q = SharedStorage.get('q2_q');
  const q3q = SharedStorage.get('q3_q');

  document.getElementById('res-q1a').textContent = q1?.value || '--';
  document.getElementById('res-q2a').textContent = q2?.value ? `${q2.value}（正確：${q2q?.value||'?'}）` : '--';
  document.getElementById('res-q3a').textContent = q3?.value ? `${q3.value}（正確：${q3q?.value||'?'}）` : '--';

  const cogPass = (q1?.result && q2?.result && q3?.result);
  const cogWarn = (!cogPass) && (q1?.result || q2?.result || q3?.result);
  _setBadgeEl('res-A-badge', cogPass ? 'pass' : (cogWarn ? 'warn' : 'fail'), cogPass ? '正常' : '需追蹤');

  // ── B 行動 ──
  const q4c = SharedStorage.get('q4_a_q1');
  const q4t = SharedStorage.get('q4_a_q2');
  document.getElementById('res-q4count').textContent = q4c?.value !== undefined ? `${q4c.value} 次` : '--';
  document.getElementById('res-q4time').textContent  = q4t?.value !== undefined ? `${q4t.value} 秒` : '--';
  _setBadgeEl('res-B-badge', q4t?.result ? 'pass' : 'warn', q4t?.result ? '正常' : '需追蹤');

  // ── C 營養 ──
  const q5 = SharedStorage.get('q5_a');
  document.getElementById('res-q5-1').textContent = q5?.value?.q1 || '--';
  document.getElementById('res-q5-2').textContent = q5?.value?.q2 || '--';
  const nutPass = q5?.value?.q1 === '否' && q5?.value?.q2 === '否';
  _setBadgeEl('res-C-badge', nutPass ? 'pass' : 'warn', nutPass ? '正常' : '需追蹤');

  // ── D 視力 ──
  const q6 = SharedStorage.get('q6_a');
  document.getElementById('res-q6-1').textContent = q6?.value?.q1 || '--';
  _setBadgeEl('res-D-badge', q6?.value?.q1 === '否' ? 'pass' : 'warn', q6?.value?.q1 === '否' ? '正常' : '需追蹤');

  // ── E 聽力 ──
  const q7 = SharedStorage.get('q7_a');
  document.getElementById('res-q7a').textContent = q7?.value || '--';
  _setBadgeEl('res-E-badge', q7?.result ? 'pass' : 'warn', q7?.result ? '正常' : '需追蹤');

  // ── F 憂鬱 ──
  const q8 = SharedStorage.get('q8_a');
  document.getElementById('res-q8-1').textContent = q8?.value?.q1 || '--';
  document.getElementById('res-q8-2').textContent = q8?.value?.q2 || '--';
  const depPass = q8?.value?.q1 === '否' && q8?.value?.q2 === '否';
  _setBadgeEl('res-F-badge', depPass ? 'pass' : 'warn', depPass ? '正常' : '需追蹤');
}

function _setBadgeEl(id, cls, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'result-badge ' + cls;
  el.textContent = text;
}

// Save screenshot — capture full result card (not just visible viewport)
document.getElementById('saveBtn').addEventListener('click', () => {
  const card = document.getElementById('card-result');
  const deck = document.querySelector('.deck');
  const fullH = card.scrollHeight;
  const fullW = card.offsetWidth;

  // Temporarily expand clipping parents so html2canvas sees full content
  const prev = {
    deckOverflow: deck.style.overflow,
    cardBottom:   card.style.bottom,
    cardHeight:   card.style.height,
    cardMaxH:     card.style.maxHeight,
    cardOverflow: card.style.overflow,
  };
  deck.style.overflow  = 'visible';
  card.style.bottom    = 'auto';          // release inset:0 bottom constraint
  card.style.height    = fullH + 'px';
  card.style.maxHeight = 'none';
  card.style.overflow  = 'visible';

  requestAnimationFrame(() => {
    html2canvas(card, {
      useCORS: true,
      scrollY: 0,
      scrollX: 0,
      width:  fullW,
      height: fullH,
    }).then(canvas => {
      // Restore styles
      deck.style.overflow  = prev.deckOverflow;
      card.style.bottom    = prev.cardBottom;
      card.style.height    = prev.cardHeight;
      card.style.maxHeight = prev.cardMaxH;
      card.style.overflow  = prev.cardOverflow;

      const a = document.createElement('a');
      a.download = `ICOPE_${new Date().toLocaleDateString('zh-TW')}.png`;
      a.href = canvas.toDataURL('image/jpeg', 0.92);
      a.click();
    }).catch(() => {
      // Restore on error too
      deck.style.overflow  = prev.deckOverflow;
      card.style.bottom    = prev.cardBottom;
      card.style.height    = prev.cardHeight;
      card.style.maxHeight = prev.cardMaxH;
      card.style.overflow  = prev.cardOverflow;
    });
  });
});

// ─────────────────────────────────────────────
// 18.  INIT  (頁面載入時執行)
// ─────────────────────────────────────────────
// 設定初始頁面 label
DOM.pageLabel.textContent = PAGES[0].key;
