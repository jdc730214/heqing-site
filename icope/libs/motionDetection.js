/* ═══════════════════════════════════════════════════════════════════
   MotionDetection — 坐站偵測 v4
   ─────────────────────────────────────────────────────────────────
   核心邏輯：站→坐→站 算 1 次（完整坐站循環才計數）
   ─────────────────────────────────────────────────────────────────
   演算法：
     1. 校準（前 20 幀 ≈ 0.33 秒）：由 accelerationIncludingGravity.y
        判斷手機正放（gravityY < 0）或倒置（gravityY > 0），決定 upSign。
     2. 取 acceleration.y（已去除重力）* upSign → 正值 = 向上運動。
        若裝置不提供 acceleration，退回合向量大小（方向中性）。
     3. EMA 濾波後，進入狀態機：
           STILL → FALLING（向下超閾）：偵測到坐下，設 _hasSatDown = true
           STILL → RISING（向上超閾）：偵測到站起
             └ 若 _hasSatDown == true：計 +1，重置 _hasSatDown
             └ 若 _hasSatDown == false：初始站姿，忽略
           RISING / FALLING → STILL：信號回落至下閾後恢復靜止
     4. 兩次計數之間最短間隔 = minIntervalMs（預設 800ms）。
     5. 達到 maxCount 或 timeout 時觸發 onComplete。

   為什麼這樣設計：
     - 使用者從站姿開始：第一個向上信號不計（_hasSatDown = false）
     - 坐下後再站起：才算 1 次（站→坐→站 = 1 次）
     - 行動緩慢長者也能正確偵測，不會因速度差異造成多計或漏計
═══════════════════════════════════════════════════════════════════ */

class MotionDetection {
  /**
   * @param {object} opts
   * @param {number} [opts.maxCount=5]           目標次數
   * @param {number} [opts.upperThresh=1.2]      偵測站起的閾值 (m/s²)
   * @param {number} [opts.lowerThresh=0.5]      回靜止的閾值 (m/s²)
   * @param {number} [opts.minIntervalMs=800]    兩次站起最短間隔 (ms)
   * @param {number} [opts.emaAlpha=0.3]         EMA 係數
   * @param {number} [opts.timeoutSec=300]       逾時秒數
   * @param {function} [opts.onPeakCount]        每次站起時呼叫 (count)
   * @param {function} [opts.onComplete]         完成時呼叫 ({ totalTime, count, isTimeout })
   */
  constructor({
    maxCount      = 5,
    upperThresh   = 1.2,
    lowerThresh   = 0.5,
    minIntervalMs = 800,
    emaAlpha      = 0.3,
    timeoutSec    = 300,
    onPeakCount   = null,
    onComplete    = null,
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
    this._count        = 0;
    this._state        = 'STILL';   // 'STILL' | 'RISING' | 'FALLING'
    this._lastCountTime = 0;
    this._ema          = 0;
    this._startTime    = null;
    this._timerId      = null;
    this._hasSatDown   = false;     // 需先偵測到坐下，再計站起（站→坐→站＝1次）

    // 校準
    this._calibSamples = [];
    this._calibrated   = false;
    this._upSign       = 1;         // +1 正面朝上，-1 倒置
    this._useMagnitude = false;     // fallback：無 acceleration 時用合向量

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
      } catch { return false; }
    }
    return true;
  }

  async startDetection() {
    const ok = await this.requestPermission();
    if (!ok) { alert('未取得感測器授權，無法進行動作偵測。'); return; }
    if (!window.DeviceMotionEvent) { alert('此裝置不支援加速度計。'); return; }

    this._count         = 0;
    this._state         = 'STILL';
    this._lastCountTime = 0;
    this._ema           = 0;
    this._hasSatDown    = false;
    this._calibSamples  = [];
    this._calibrated    = false;
    this._startTime     = performance.now();

    window.addEventListener('devicemotion', this._handler);

    this._timerId = setTimeout(() => this._finish(true), this.timeoutSec * 1000);
  }

  stopDetection() {
    window.removeEventListener('devicemotion', this._handler);
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
  }

  get count() { return this._count; }

  // ── 內部 ──────────────────────────────────────────────────────

  _onMotion(event) {
    // ── 校準期（前 20 幀）：判斷手機朝向 ──
    if (!this._calibrated) {
      const g = event.accelerationIncludingGravity;
      if (g && g.y !== null) {
        this._calibSamples.push(g.y || 0);
        if (this._calibSamples.length >= 20) {
          const sorted = [...this._calibSamples].sort((a, b) => a - b);
          const medianY = sorted[Math.floor(sorted.length / 2)];
          // gravityY < 0 → 正常直放（+Y 向螢幕上方 = 向上）
          this._upSign = medianY < 0 ? 1 : -1;
          this._calibrated = true;
        }
      }
      return; // 校準期間不計數
    }

    // ── 取垂直加速度 ──
    const vert = this._getVertAccel(event);

    // EMA 濾波
    this._ema = this.emaAlpha * vert + (1 - this.emaAlpha) * this._ema;

    const now = performance.now();

    // ── 狀態機（站→坐→站 = 1次）──
    if (this._state === 'STILL') {
      if (this._ema > this.upperThresh) {
        // 向上運動：偵測到站起
        this._state = 'RISING';
        if (this._hasSatDown) {
          // 完成一次坐站循環（先坐下過、現在站起）→ 計數
          const dt = now - this._lastCountTime;
          if (dt >= this.minIntervalMs) {
            this._hasSatDown    = false;
            this._count++;
            this._lastCountTime = now;
            if (this.onPeakCount) this.onPeakCount(this._count);
            if (this._count >= this.maxCount) { this._finish(false); return; }
          }
        }
        // 若未曾坐下，或仍在冷卻期：狀態切換到 RISING，等信號回落
      } else if (this._ema < -this.upperThresh) {
        // 向下運動：偵測到坐下，記錄已坐下
        this._state      = 'FALLING';
        this._hasSatDown = true;
      }
    } else {
      // RISING 或 FALLING：等信號回到安靜
      if (Math.abs(this._ema) < this.lowerThresh) {
        this._state = 'STILL';
      }
    }
  }

  /**
   * 取「向上」方向的加速度（正 = 向上）。
   * 優先使用 acceleration.y（已去除重力，最乾淨）。
   * 若不可用，fallback 為合向量大小（失去方向性，但仍能偵測動作）。
   */
  _getVertAccel(event) {
    const a = event.acceleration;
    if (a && a.y !== null && a.y !== undefined) {
      return (a.y || 0) * this._upSign;
    }

    // Fallback：合向量（無方向，僅偵測「有沒有在動」）
    const g = event.accelerationIncludingGravity || {};
    const gx = g.x || 0, gy = g.y || 0, gz = g.z || 0;
    const total = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // 去掉校準重力大小（約 9.81），取絕對偏差
    const baseline = 9.81;
    return Math.abs(total - baseline);
  }

  _finish(isTimeout) {
    this.stopDetection();
    const totalTime = ((performance.now() - this._startTime) / 1000).toFixed(2);
    if (this.onComplete) {
      this.onComplete({ totalTime: parseFloat(totalTime), count: this._count, isTimeout });
    }
    // 向後相容：也發射 CustomEvent
    document.dispatchEvent(new CustomEvent('motionComplete', {
      detail: { totalTime, count: this._count, isTimeout }
    }));
  }
}
