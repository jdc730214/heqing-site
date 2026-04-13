/* ═══════════════════════════════════════════════════════════════════
   MotionDetection — 坐站偵測 v2
   演算法：雙閾值狀態機 + EMA 濾波 + 峰值計數
   ─────────────────────────────────────────────────────────────────
   原理：
     每次「坐→站」或「站→坐」各產生一次加速度峰值。
     5 次坐站 = 10 個半次峰值。
     偵測所有峰值，每 2 個算 1 次，共 10 個峰值 = 5 次完成。

   狀態機（Schmidt trigger 遲滯）：
     STILL  → MOVING：filtered mag 上升超過 UPPER_THRESH
     MOVING → STILL ：filtered mag 下降低於 LOWER_THRESH
     STILL → MOVING 轉換 = 計一個峰值（需距上次峰值 >= MIN_INTERVAL_MS）

   優勢：
     - 對手機擺放方向無要求（使用合向量大小）
     - 低活動量長者同樣可偵測（閾值 0.8 m/s²，遠高於雜訊 ~0.1）
     - 行動緩慢者每半次可達 3–5 秒，完全不影響偵測
═══════════════════════════════════════════════════════════════════ */

class MotionDetection {
  /**
   * @param {object} opts
   * @param {number} [opts.maxCount=5]           目標坐站次數
   * @param {number} [opts.upperThresh=0.8]      進入 MOVING 的閾值 (m/s²)
   * @param {number} [opts.lowerThresh=0.3]      回到 STILL 的閾值 (m/s²)
   * @param {number} [opts.minIntervalMs=600]    同一峰值最短間隔 (ms)
   * @param {number} [opts.emaAlpha=0.25]        EMA 平滑係數 (0~1，越大越快)
   * @param {number} [opts.timeoutSec=300]       最長等待秒數
   * @param {function} [opts.onPeakCount]        每次偵測到峰值時呼叫 (peakCount, repCount)
   * @param {function} [opts.onComplete]         完成時呼叫 ({ totalTime, repCount })
   */
  constructor({
    maxCount     = 5,
    upperThresh  = 0.8,
    lowerThresh  = 0.3,
    minIntervalMs = 600,
    emaAlpha     = 0.25,
    timeoutSec   = 300,
    onPeakCount  = null,
    onComplete   = null,
  } = {}) {
    this.maxCount      = maxCount;
    this.upperThresh   = upperThresh;
    this.lowerThresh   = lowerThresh;
    this.minIntervalMs = minIntervalMs;
    this.emaAlpha      = emaAlpha;
    this.timeoutSec    = timeoutSec;
    this.onPeakCount   = onPeakCount;
    this.onComplete    = onComplete;

    // 狀態
    this._state        = 'STILL'; // 'STILL' | 'MOVING'
    this._peakCount    = 0;       // 半次計數（坐→站、站→坐各 +1）
    this._lastPeakTime = 0;       // 上次峰值時間 (performance.now)
    this._startTime    = null;
    this._ema          = 0;       // EMA 濾波值
    this._timerId      = null;

    this._handler = this._onMotion.bind(this);
  }

  // ── 公開 API ──────────────────────────────────────────────────

  async requestPermission() {
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return true; // Android / 桌機不需要授權
  }

  async startDetection() {
    const ok = await this.requestPermission();
    if (!ok) {
      alert('未取得感測器授權，無法進行動作偵測。');
      return;
    }

    // 重置狀態
    this._state        = 'STILL';
    this._peakCount    = 0;
    this._lastPeakTime = 0;
    this._ema          = 0;
    this._startTime    = performance.now();

    if (!window.DeviceMotionEvent) {
      alert('此裝置不支援加速度計。');
      return;
    }

    window.addEventListener('devicemotion', this._handler);

    // 逾時保護
    this._timerId = setTimeout(() => {
      this._finish(true);
    }, this.timeoutSec * 1000);
  }

  stopDetection() {
    window.removeEventListener('devicemotion', this._handler);
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
  }

  /** 目前已完成的次數（0–maxCount） */
  get repCount() { return Math.floor(this._peakCount / 2); }

  /** 目前半次計數 */
  get peakCount() { return this._peakCount; }

  // ── 內部 ──────────────────────────────────────────────────────

  _onMotion(event) {
    const mag = this._magnitude(event);
    // EMA 低通濾波（α 越大反應越快，越小雜訊越少）
    this._ema = this.emaAlpha * mag + (1 - this.emaAlpha) * this._ema;

    const now = performance.now();

    if (this._state === 'STILL') {
      // 上升超過上閾 → 進入 MOVING，計一個峰值
      if (this._ema > this.upperThresh) {
        const dt = now - this._lastPeakTime;
        if (dt >= this.minIntervalMs) {
          this._peakCount++;
          this._lastPeakTime = now;
          this._state = 'MOVING';

          const reps = this.repCount;
          if (this.onPeakCount) this.onPeakCount(this._peakCount, reps);

          // 達到目標（10 個峰值 = 5 次坐站）
          if (this._peakCount >= this.maxCount * 2) {
            this._finish(false);
          }
        } else {
          // 冷卻期內仍轉換到 MOVING，避免卡在 STILL
          this._state = 'MOVING';
        }
      }
    } else {
      // MOVING → 下降低於下閾 → 回到 STILL，等待下一個峰值
      if (this._ema < this.lowerThresh) {
        this._state = 'STILL';
      }
    }
  }

  _finish(isTimeout) {
    this.stopDetection();
    const totalTime = ((performance.now() - this._startTime) / 1000).toFixed(2);
    if (this.onComplete) {
      this.onComplete({ totalTime: parseFloat(totalTime), repCount: this.repCount, isTimeout });
    }
    // 向後相容：同時發射 CustomEvent（script.js 監聽用）
    document.dispatchEvent(new CustomEvent('motionComplete', {
      detail: { totalTime, count: this.repCount, isTimeout }
    }));
  }

  /**
   * 計算合向量大小 (m/s²)。
   * 優先使用 acceleration（已去除重力），靜止時 ≈ 0，無需校準。
   * 若裝置不提供 acceleration，改用 accelerationIncludingGravity 減去 9.8。
   */
  _magnitude(event) {
    let ax, ay, az;
    const a = event.acceleration;
    if (a && (a.x !== null || a.y !== null || a.z !== null)) {
      ax = a.x || 0; ay = a.y || 0; az = a.z || 0;
    } else {
      const g = event.accelerationIncludingGravity || {};
      const gx = g.x || 0, gy = g.y || 0, gz = g.z || 0;
      const gMag = Math.sqrt(gx*gx + gy*gy + gz*gz);
      // 減去重力大小，取絕對值
      return Math.abs(gMag - 9.81);
    }
    return Math.sqrt(ax*ax + ay*ay + az*az);
  }
}
