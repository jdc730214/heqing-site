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
   * 每題開始時呼叫：確保辨識正在運行，並清除舊題的偏移量。
   * callback 在辨識確認啟動後執行。
   */
  restartForQuestion(callback) {
    if (!this.speechRecognition) { if (callback) callback(); return; }

    const doStart = () => {
      this._resultOffset = 0;
      this._lastResultLength = 0;
      this.isRecognizing = true;
      try { this.speechRecognition.start(); } catch (_) {}
      if (callback) callback();
    };

    if (this.isRecognizing) {
      // 先停再啟，確保從全新狀態開始
      this.isRecognizing = false;
      try { this.speechRecognition.stop(); } catch (_) {}
      setTimeout(doStart, 200);
    } else {
      doStart();
    }
  }
}
