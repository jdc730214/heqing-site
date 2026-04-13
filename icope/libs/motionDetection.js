class MotionDetection {
  constructor({ threshold = 1.2, duration = 250, maxCount = 5 }) {
    this.threshold = threshold;
    this.duration = duration;
    this.maxCount = maxCount;
    this.count = 0;
    this.lastState = "still";
    this.lastStateChangeTime = performance.now();
    this.startTime = null;
    this.endTime = null;
    this.magnitudeList = [];
    this.maxValue = -99999;
    this.timerId = null; // 保存計時器 ID
  }

  // 請求授權方法
  async requestPermission() {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        const response = await DeviceMotionEvent.requestPermission();
        if (response === "granted") {
          console.log("Permission granted!");
          return true; // 授權成功
        } else {
          alert("未授權，無法使用感測器。");
          return false;
        }
      } catch (error) {
        alert("未授權，無法使用感測器。");
        return false;
      }
    } else {
      console.log("不需要授權或裝置不支援。");
      return true; // 不需要授權的情況視為成功
    }
  }

  // 初始化動作偵測
  async startDetection() {
    const isPermissionGranted = await this.requestPermission();
    if (!isPermissionGranted) {
      console.warn("用戶未授權，無法啟動動作偵測。");
      return;
    }

    this.count = 0;
    this.lastState = "still";
    this.lastStateChangeTime = performance.now();
    this.startTime = performance.now();

    if (window.DeviceMotionEvent) {
      window.addEventListener("devicemotion", this.detectMotion);
      console.log("Motion detection started.");
    } else {
      alert("裝置不支援加速度計事件，無法偵測。");
    }

    this.timerId = setTimeout(() => {
      console.log("300 秒已過，執行其他操作。");
      const completeEvent = new CustomEvent("motionComplete", {
        detail: 300,
      });
      document.dispatchEvent(completeEvent);
      this.stopDetection();
    }, 300000); // 300 秒 = 300000 毫秒
  }

  // 停止動作偵測
  stopDetection() {
    window.removeEventListener("devicemotion", this.detectMotion);
    console.log("Motion detection stopped.");
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  // 偵測裝置動作
  detectMotion = (event) => {
    const ax = event.acceleration.x || 0;
    const ay = event.acceleration.y || 0;
    const az = event.acceleration.z || 0;
    const magnitude =
      Math.sqrt(ax * ax + ay * ay + az * az) * Math.sign(ax + ay + az);

    const currentTime = performance.now();
    const timeDifference = currentTime - this.lastStateChangeTime;

    this.magnitudeList.push(magnitude);
    if (this.magnitudeList.length > 50) this.magnitudeList.shift();

    const magnitudeAverage =
      this.magnitudeList.reduce((acc, curr) => acc + curr, 0) /
      this.magnitudeList.length;

    if (magnitudeAverage > this.maxValue) this.maxValue = magnitudeAverage;

    // 偵測開始動作
    if (
      magnitudeAverage > 0.1 &&
      this.lastState == "still" &&
      timeDifference > this.duration
    ) {
      const motionEvent = new CustomEvent("motionDetected", {
        detail: { count: this.count },
      });
      document.dispatchEvent(motionEvent);

      if (this.count >= this.maxCount) {
        this.endTime = performance.now();
        const totalTime = ((this.endTime - this.startTime) / 1000).toFixed(2);
        const completeEvent = new CustomEvent("motionComplete", {
          detail: { totalTime },
        });
        document.dispatchEvent(completeEvent);
        this.stopDetection();
      }
      this.count++;
      this.lastState = "moving";
      this.lastStateChangeTime = currentTime;
    }

    // 偵測靜止狀態
    if (
      magnitudeAverage <= -0.1 &&
      this.lastState == "moving" &&
      timeDifference > this.duration &&
      this.maxValue > 0
    ) {
      this.lastState = "still";
      this.lastStateChangeTime = currentTime;
      this.maxValue = -99999;
    }
  };
}
