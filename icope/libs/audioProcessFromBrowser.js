class AudioProcessFromBrowser {
  constructor() {
    this.speechRecognition = null;
    this.isRecognizing = false;
    this._resultOffset = 0;      // 每題開始時重設，只取新增的辨識結果
    this._lastResultLength = 0;  // 在 onresult 內追蹤真實長度
  }

  // 新題開始時呼叫，把目前已累積的結果數記為起點
  resetOffset() {
    this._resultOffset = this._lastResultLength;
  }

  // 初始化語音辨識
  initRecognition() {
    try {
      const isIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);

      // 確認使用哪個語音辨識 API
      const SpeechRecognition = isIphone
        ? window.webkitSpeechRecognition
        : window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert("瀏覽器不支援 SpeechRecognition");
        console.error("瀏覽器不支援 SpeechRecognition");

        return false;
      }

      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.lang = "zh-TW"; // 設定語言為中文（繁體）
      this.speechRecognition.interimResults = true; // 即時結果
      this.speechRecognition.continuous = true; // 持續辨識

      // 成功辨識時的處理：只取 _resultOffset 之後的新結果，避免舊題答案污染新題
      this.speechRecognition.onresult = (event) => {
        // 記錄真實累積長度，供 resetOffset() 使用
        this._lastResultLength = event.results.length;

        const newResults = Array.from(event.results).slice(this._resultOffset);

        // 分成「已確定」與「進行中」兩段
        const finalTranscript = newResults
          .filter(r => r.isFinal)
          .map(r => r[0].transcript)
          .join("");
        const interimTranscript = newResults
          .filter(r => !r.isFinal)
          .map(r => r[0].transcript)
          .join("");

        // 顯示用：合併成一條，但標記是否為 final
        const transcript = finalTranscript + interimTranscript;
        const isFinal = interimTranscript === "" && finalTranscript !== "";

        console.log("即時語音辨識結果：", transcript, isFinal ? "[final]" : "[interim]");

        const recognitionEvent = new CustomEvent("audioProcessed", {
          detail: { transcript, isFinal },
        });
        document.dispatchEvent(recognitionEvent);
      };

      // 辨識失敗或錯誤處理
      this.speechRecognition.onerror = (error) => {
        console.error("語音辨識失敗：", error);

        // 'aborted' 是主動停止造成的，不是真正的錯誤，忽略即可
        if (error.error === 'aborted') return;

        const errorEvent = new CustomEvent("audioProcessed", {
          detail: { error: "語音辨識失敗" },
        });
        document.dispatchEvent(errorEvent);
      };

      // 辨識意外結束（網路斷線、瀏覽器自動停止等）時自動重啟
      // 使用 setTimeout 避免在 file:// 協定下同步呼叫 start() 觸發新的權限視窗
      this.speechRecognition.onend = () => {
        if (this.isRecognizing) {
          console.log("語音辨識意外結束，延遲重啟...");
          // 重啟後 event.results 會從 0 重新開始，offset 必須清零
          this._resultOffset = 0;
          this._lastResultLength = 0;
          setTimeout(() => {
            if (this.isRecognizing) {
              try { this.speechRecognition.start(); } catch(_) {}
            }
          }, 300);
        } else {
          console.log("語音辨識已停止。");
        }
      };

      return true;
    } catch (error) {
      console.error("初始化語音辨識時發生錯誤：", error);

      // 回傳初始化錯誤事件
      const errorEvent = new CustomEvent("audioProcessed", {
        detail: { error: "初始化語音辨識失敗" },
      });
      document.dispatchEvent(errorEvent);
      return false;
    }
  }

  // 開始語音辨識
  startRecognition() {
    if (!this.speechRecognition) {
      console.error("語音辨識尚未初始化");
      return;
    }

    this.isRecognizing = true;
    this.speechRecognition.start();
    console.log("即時語音辨識開始");
  }

  // 停止語音辨識
  stopRecognition() {
    if (this.speechRecognition) {
      this.isRecognizing = false;
      this.speechRecognition.stop();
      console.log("即時語音辨識結束");
    }
  }
}
