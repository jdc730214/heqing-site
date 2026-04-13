class AudioProcessFromBrowser {
  constructor() {
    this.speechRecognition = null;
    this.isRecognizing = false;
    this._resultOffset = 0;
    this._lastResultLength = 0;
  }

  // 初始化語音辨識引擎（只呼叫一次）
  initRecognition() {
    try {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        console.error('瀏覽器不支援 SpeechRecognition');
        return false;
      }

      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.lang = 'zh-TW';
      this.speechRecognition.interimResults = true;
      this.speechRecognition.continuous = true;

      this.speechRecognition.onresult = (event) => {
        this._lastResultLength = event.results.length;
        const newResults = Array.from(event.results).slice(this._resultOffset);

        const finalTranscript = newResults
          .filter(r => r.isFinal).map(r => r[0].transcript).join('');
        const interimTranscript = newResults
          .filter(r => !r.isFinal).map(r => r[0].transcript).join('');

        const transcript = finalTranscript + interimTranscript;
        const isFinal = interimTranscript === '' && finalTranscript !== '';

        document.dispatchEvent(new CustomEvent('audioProcessed', {
          detail: { transcript, isFinal },
        }));
      };

      this.speechRecognition.onerror = (error) => {
        // 'aborted' / 'no-speech' 是正常情況，忽略；其他才算錯誤
        if (error.error === 'aborted' || error.error === 'no-speech') return;
        console.warn('語音辨識錯誤:', error.error);
        document.dispatchEvent(new CustomEvent('audioProcessed', {
          detail: { error: error.error },
        }));
      };

      this.speechRecognition.onend = () => {
        if (this.isRecognizing) {
          // 引擎意外停止，重啟
          setTimeout(() => {
            if (this.isRecognizing) {
              // 重啟時 event.results 從 0 開始，offset 須對應清零
              this._resultOffset = 0;
              this._lastResultLength = 0;
              try { this.speechRecognition.start(); } catch (_) {}
            }
          }, 150);
        }
      };

      return true;
    } catch (e) {
      console.error('initRecognition 失敗:', e);
      return false;
    }
  }

  // 首次啟動辨識（授權後呼叫一次）
  startRecognition() {
    if (!this.speechRecognition) return;
    this.isRecognizing = true;
    this._resultOffset = 0;
    this._lastResultLength = 0;
    try { this.speechRecognition.start(); } catch (_) {}
  }

  // 停止辨識
  stopRecognition() {
    this.isRecognizing = false;
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch (_) {}
    }
  }

  /**
   * 每題開始時呼叫：把結果偏移量推進到最新位置，忽略上一題的辨識結果。
   * 不停止／重啟引擎（避免在 iOS 上 start() 失敗），確保辨識持續運行。
   * Every-question call: advance the result offset to skip prior question's
   * transcripts. Engine stays running — no stop/start race on iOS.
   */
  restartForQuestion(callback) {
    if (!this.speechRecognition) { if (callback) callback(); return; }

    // 把偏移量推進到目前最新結果的位置，新題只看之後的結果
    this._resultOffset = this._lastResultLength;

    // 若引擎已停止（意外），重新啟動
    if (!this.isRecognizing) {
      this.isRecognizing = true;
      this._resultOffset = 0;
      this._lastResultLength = 0;
      try { this.speechRecognition.start(); } catch (_) {}
    }

    if (callback) callback();
  }
}
