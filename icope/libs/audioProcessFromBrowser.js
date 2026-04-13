/**
 * AudioProcessFromBrowser — 語音辨識封裝
 *
 * 設計原則（Android Chrome 相容性）：
 *  1. 每題都建立全新的 SpeechRecognition 物件。
 *     Android Chrome 在 TTS 播放期間會強制停止 SR 引擎，
 *     若在 TTS 仍在播放時呼叫 start() 可能靜默失敗（不拋例外、不觸發 onend），
 *     導致引擎卡在 isRecognizing=true 但實際未運行的狀態。
 *     使用全新物件確保每次 start() 都是乾淨狀態。
 *  2. continuous: false — 每個語音段落結束後由 onend 自動重啟，
 *     比 continuous:true 在 Android 各版本上更相容。
 *  3. 每題開始時先 destroy 舊物件（nullify handlers 防止幽靈 callback），
 *     150ms 後啟動新物件，給舊引擎足夠時間完全停止。
 */
class AudioProcessFromBrowser {
  constructor() {
    this.speechRecognition = null;
    this.isRecognizing     = false;
  }

  /** 建立全新引擎實例 */
  _buildEngine() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const sr = new SR();
    sr.lang           = 'zh-TW';
    sr.interimResults = true;
    sr.continuous     = false;   // 比 continuous:true 在 Android 更穩定

    sr.onresult = (event) => {
      const finalTx   = Array.from(event.results).filter(r =>  r.isFinal).map(r => r[0].transcript).join('');
      const interimTx = Array.from(event.results).filter(r => !r.isFinal).map(r => r[0].transcript).join('');
      const transcript = finalTx + interimTx;
      if (!transcript) return;
      document.dispatchEvent(new CustomEvent('audioProcessed', {
        detail: { transcript, isFinal: !!finalTx && !interimTx },
      }));
    };

    sr.onerror = (err) => {
      // aborted / no-speech 屬正常，略過
      if (err.error === 'aborted' || err.error === 'no-speech') return;
      console.warn('語音辨識錯誤:', err.error);
    };

    sr.onend = () => {
      // 引擎結束後自動重啟（等 100ms 讓舊引擎完全釋放）
      // 只在 isRecognizing=true 且仍是同一個 sr 物件時重啟，
      // 避免題目換頁後的幽靈重啟
      if (this.isRecognizing && this.speechRecognition === sr) {
        setTimeout(() => {
          if (this.isRecognizing && this.speechRecognition === sr) {
            try { sr.start(); } catch (_) {}
          }
        }, 100);
      }
    };

    return sr;
  }

  /** 銷毀目前引擎，nullify 所有 handler 防止幽靈 callback */
  _destroyCurrent() {
    this.isRecognizing = false;
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch (_) {}
      this.speechRecognition.onresult = null;
      this.speechRecognition.onerror  = null;
      this.speechRecognition.onend    = null;
      this.speechRecognition = null;
    }
  }

  // ── 公開 API ─────────────────────────────────────────────────────

  /**
   * 檢查瀏覽器是否支援 SpeechRecognition。
   * 不在此啟動引擎（避免在授權流程前佔用麥克風）。
   */
  initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.error('此瀏覽器不支援 SpeechRecognition'); return false; }
    return true;
  }

  /**
   * 授權後呼叫一次：建立引擎並啟動（取得麥克風授權、預熱）。
   * 這個引擎在第一題的 restartForQuestion() 時會被取代。
   */
  startRecognition() {
    this._destroyCurrent();
    const sr = this._buildEngine();
    if (!sr) return;
    this.speechRecognition = sr;
    this.isRecognizing     = true;
    try { sr.start(); } catch (_) {}
  }

  /** 停止辨識（離開語音題或評估結束時呼叫）*/
  stopRecognition() {
    this._destroyCurrent();
  }

  /**
   * 每題開始前呼叫：銷毀舊引擎，150ms 後建立全新引擎並啟動。
   * 150ms 緩衝讓舊引擎（可能正被 Android 強制停止中）完全釋放。
   * callback 在新引擎啟動後執行。
   */
  restartForQuestion(callback) {
    this._destroyCurrent();   // isRecognizing = false, 舊物件 nullified
    setTimeout(() => {
      const sr = this._buildEngine();
      if (!sr) { if (callback) callback(); return; }
      this.speechRecognition = sr;
      this.isRecognizing     = true;
      try { sr.start(); } catch (_) {}
      if (callback) callback();
    }, 150);
  }
}
