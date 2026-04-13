export class AudioProcess {
  constructor({ backendUrl, countdownElement, outputElement }) {
    this.backendUrl =
      "https://holdlifeicopeservice-atfpdhbbcjdtfgam.japaneast-01.azurewebsites.net/api/SpeachRecognize/recognize"; // 語音辨識後端 URL
    this.countdownElement = countdownElement; // 顯示倒數的 DOM 元素
    this.outputElement = outputElement; // 顯示輸出的 DOM 元素
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)(); // 初始化 AudioContext
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.mediaStream = null; // 新增：儲存從主頁獲取的 mediaStream
  }

  // WAV 編碼方法
  async encodeWAV(audioChunks) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext ||
          window.webkitAudioContext)(); // 初始化 AudioContext
        if (!this.audioContext) {
          throw new Error("AudioContext 尚未初始化");
          const event = new CustomEvent("audioProcessed", {
            detail: { error: "AudioContext 尚未初始化" },
          });
          document.dispatchEvent(event);
        }
      }
      if (!audioChunks || audioChunks.length === 0) {
        throw new Error("錄音數據為空，無法進行編碼");
        const event = new CustomEvent("audioProcessed", {
          detail: { error: "錄音數據為空，無法進行編碼" },
        });
        document.dispatchEvent(event);
      }

      const audioBlob = new Blob(audioChunks);
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      const wavData = await WavEncoder.encode({
        sampleRate: audioBuffer.sampleRate,
        channelData: [audioBuffer.getChannelData(0)],
      });

      return new Blob([wavData], { type: "audio/wav" });
    } catch (error) {
      console.error("編碼 WAV 文件時出現錯誤：", error);
      throw error;
    }
  }
  async initMediaStream() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      console.log("成功設置 mediaStream");
    } catch (error) {
      alert("需授權使用麥克風才能檢測！");
    }
  }
  // 初始化錄音
  async initRecorder() {
    try {
      // 確保初始化 mediaStream
      await this.initMediaStream();

      if (!this.mediaStream) {
        const event = new CustomEvent("audioProcessed", {
          detail: { error: "設備無法成功啟用麥克風！" },
        });
        document.dispatchEvent(event);
        throw new Error("尚未獲取 mediaStream，無法初始化錄音");
      }

      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      // 設置錄音數據事件
      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      // 設置錄音結束事件
      this.mediaRecorder.onstop = async () => {
        try {
          if (this.audioChunks.length === 0) {
            throw new Error("錄音數據為空");
          }
          const wavBlob = await this.encodeWAV(this.audioChunks);
          this.outputElement.textContent = "辨識中...";
          await this.uploadAudio(wavBlob);
        } catch (error) {
          console.error("音訊處理失敗：", error);
          this.outputElement.textContent = "音訊處理失敗，請檢查控制台日誌。";
          const event = new CustomEvent("audioProcessed", {
            detail: { error: "音訊處理失敗，請檢查控制台日誌" },
          });
          document.dispatchEvent(event);
        }
      };
    } catch (error) {
      console.error("初始化錄音時發生錯誤：", error);
    }
  }

  // 開始錄音
  startRecording() {
    if (!this.mediaRecorder) {
      console.error("錄音設備尚未初始化");
      return;
    }
    this.audioChunks = [];
    this.mediaRecorder.start();
    this.isRecording = true;
    console.log("錄音開始");
  }

  // 停止錄音
  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      console.log("錄音結束");
    }
  }
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 上傳音訊到後端
  async uploadAudio(audioBlob) {
    const formData = new FormData();
    formData.append("file", audioBlob);

    let attempts = 0; // 嘗試次數
    const maxAttempts = 3; // 最大嘗試次數

    while (attempts < maxAttempts) {
      try {
        await this.delay(1000); // 等待 1 秒
        attempts++;
        console.log(`語音辨識嘗試第 ${attempts} 次`);

        const response = await fetch(this.backendUrl, {
          method: "POST",
          body: formData,
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP 錯誤：${response.status}，訊息：${errorText}`);
        }

        const contentType = response.headers.get("content-type");
        let transcript = "";

        if (contentType && contentType.includes("application/json")) {
          const responseData = await response.json();
          console.log("回應 JSON：", responseData);
          transcript = responseData.transcript;
          this.outputElement.textContent = "你說的是: " + transcript;
        } else {
          const responseText = await response.text();
          console.log("回應文字：", responseText);
          transcript = responseText;
          this.outputElement.textContent = "語音辨識成功：" + transcript;
        }

        // **觸發自定義事件，回傳辨識結果**
        const event = new CustomEvent("audioProcessed", {
          detail: { transcript },
        });
        document.dispatchEvent(event);

        // 辨識成功後退出迴圈
        return;
      } catch (error) {
        console.error(`語音辨識第 ${attempts} 次失敗：`, error);

        if (attempts >= maxAttempts) {
          console.error("語音辨識多次失敗，放棄重試。");
          this.outputElement.textContent = "語音辨識失敗，請稍後再試。";

          // **觸發自定義事件，回傳錯誤訊息**
          const event = new CustomEvent("audioProcessed", {
            detail: { error: "語音辨識多次失敗" },
          });
          document.dispatchEvent(event);
          return;
        }
      }
    }
  }

  // 倒數計時
  startCountdown(duration) {
    let timer = duration;
    const interval = setInterval(() => {
      const minutes = Math.floor(timer / 60);
      const seconds = timer % 60;
      this.countdownElement.textContent =
        "倒數" + `${minutes}:${seconds.toString().padStart(2, "0")}` + "秒";

      if (--timer <= 0) {
        clearInterval(interval);
        this.countdownElement.textContent = "倒數結束！";
        this.stopRecording();
      }
    }, 1000);
  }
}
