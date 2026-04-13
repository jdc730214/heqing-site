/**
 * AudioProcessFromBrowser — 語音辨識封裝
 *
 * 平台差異處理：
 *
 * ── Android Chrome ──────────────────────────────────────────────────
 *   問題：TTS 播放期間 Android 會強制停止 SR 引擎；在 TTS 仍在播放時
 *         呼叫 start() 可能靜默失敗（不拋例外、不觸發 onend），導致
 *         引擎卡在 isRecognizing=true 但實際未運行的狀態。
 *   策略：continuous: false（每段語音結束後由 onend 自動重啟）；
 *         每題建立全新 SR 物件確保乾淨狀態；_destroyCurrent() nullify
 *         所有 handler 防止幽靈 callback。
 *
 * ── iOS Safari / WKWebView ──────────────────────────────────────────
 *   問題：start() 必須在使用者手勢（同步呼叫路徑）中執行，任何 await
 *         都會打斷手勢鏈導致 not-allowed 錯誤。換題時若重新 stop()+
 *         start()，因不在手勢路徑中，iOS 會拒絕。
 *   策略：continuous: true（引擎持續運行，不需要重啟）；
 *         restartForQuestion() 在 iOS 僅切換 callback，不重建引擎；
 *         初始 start() 必須由 script.js 在同步手勢 handler 中呼叫。
 */

const _isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
    // iOS: continuous=true — 引擎持續運行，不需要在換題時有手勢才能重啟
    // Android: continuous=false — 每段語音結束後由 onend 自動重啟，在 Android 各版本更穩定
    sr.continuous     = _isIOS ? true : false;

    // 追蹤最後一個尚未定案的 interim 結果（用於 onend flush）
    let _pendingInterim = '';

    sr.onresult = (event) => {
      const finalTx   = Array.from(event.results).filter(r =>  r.isFinal).map(r => r[0].transcript).join('');
      const interimTx = Array.from(event.results).filter(r => !r.isFinal).map(r => r[0].transcript).join('');
      const transcript = finalTx + interimTx;
      if (!transcript) return;

      // 記錄最後 interim；一旦有 final 就清掉（已定案，不需 flush）
      if (!_isIOS) _pendingInterim = finalTx ? '' : interimTx;

      document.dispatchEvent(new CustomEvent('audioProcessed', {
        detail: { transcript, isFinal: !!finalTx && !interimTx },
      }));
    };

    sr.onerror = (err) => {
      // aborted / no-speech 屬正常，略過
      if (err.error === 'aborted' || err.error === 'no-speech') return;
      // not-allowed: 麥克風權限被拒 — 通知 script.js 更新 badge
      if (err.error === 'not-allowed') {
        document.dispatchEvent(new CustomEvent('srPermissionDenied'));
        return;
      }
      console.warn('語音辨識錯誤:', err.error);
    };

    sr.onend = () => {
      // Android：單字短音有時出現為 interim 但信心不足、不產生 final 就結束。
      // 在重啟前把最後的 interim 強制送出，讓累積器能抓到這個字。
      if (!_isIOS && _pendingInterim) {
        const flushed = _pendingInterim;
        _pendingInterim = '';
        document.dispatchEvent(new CustomEvent('audioProcessed', {
          detail: { transcript: flushed, isFinal: true },
        }));
      }

      // 引擎意外停止時自動重啟（等 100ms 讓舊引擎完全釋放）
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
   */
  initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.error('此瀏覽器不支援 SpeechRecognition'); return false; }
    return true;
  }

  /**
   * 建立引擎並啟動。
   * ⚠️ iOS：此方法必須在使用者手勢的同步呼叫路徑中執行（不可在 await 之後）。
   *    script.js 的 _permBtnClick() 確保這一點。
   * Android：在 _initPermissions() async 流程中呼叫亦可（Android 無手勢限制）。
   */
  startRecognition() {
    this._destroyCurrent();
    const sr = this._buildEngine();
    if (!sr) return;
    this.speechRecognition = sr;
    this.isRecognizing     = true;
    try { sr.start(); } catch (_) {}
  }

  /** 停止辨識（評估結束時呼叫）*/
  stopRecognition() {
    this._destroyCurrent();
  }

  /**
   * 頁面從背景回來後呼叫：若引擎已被瀏覽器暫停/終止，重建並重啟。
   * visibilitychange=visible 由使用者點亮螢幕或切回分頁觸發（視為手勢），
   * 因此 iOS 應允許此路徑呼叫 start()。
   */
  reviveIfDead() {
    if (!this.isRecognizing) return; // 本來就不應運行，不做任何事
    // 銷毀可能已死的引擎，重建一個全新的乾淨實例並啟動
    this._destroyCurrent();
    this.isRecognizing = true; // _destroyCurrent 會設為 false，手動還原意圖
    const sr = this._buildEngine();
    if (!sr) return;
    this.speechRecognition = sr;
    try { sr.start(); } catch (_) {}
  }

  /**
   * 換題時呼叫。
   *
   * iOS：引擎保持運行，僅呼叫 callback。
   *      script.js 的 _startRecognition() 已透過 removeEventListener /
   *      addEventListener 確保新題只收到新的辨識結果。
   *      （在 iOS 上停止引擎後，若無手勢則無法重啟。）
   *
   * Android/Desktop：銷毀舊引擎，150ms 後建立全新引擎並啟動。
   *      150ms 緩衝讓舊引擎（可能正被 Android 強制停止中）完全釋放。
   */
  restartForQuestion(callback) {
    if (_isIOS) {
      // iOS: 引擎持續運行，不做 stop/start，直接呼叫 callback
      if (callback) callback();
      return;
    }
    // Android/Desktop: 全新物件確保乾淨啟動
    this._destroyCurrent();
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
