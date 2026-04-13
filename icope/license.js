'use strict';
/* ═══════════════════════════════════════════════════════════════════
   ICOPE License Gate — license.js
   載入順序：在 script.js 之前執行
   邏輯：
     1. 讀 localStorage 快取（code + expiryDate + lastValidated）
     2. 若今天已驗證過 → 直接放行（離線可用）
     3. 否則呼叫後端 /icope/validate 確認
     4. 後端失敗（離線）→ 信任本地 expiryDate
     5. 已過期或無效 → 顯示授權碼輸入閘
═══════════════════════════════════════════════════════════════════ */

const VALIDATE_URL = 'https://bodygo-web-backend-anfsetcnf4g9g8cq.eastasia-01.azurewebsites.net/api/icope/validate'
const LS_KEY = 'icope_license_v1'
const RECHECK_HOURS = 20  // 每 20 小時重新向後端確認一次

;(async function () {
  const gate = document.getElementById('license-gate')

  // ── 讀取快取 ────────────────────────────────────────────────────
  function loadCache() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null }
    catch { return null }
  }
  function saveCache(code, expiryDate) {
    localStorage.setItem(LS_KEY, JSON.stringify({
      code, expiryDate,
      lastValidated: new Date().toISOString()
    }))
  }
  function clearCache() { localStorage.removeItem(LS_KEY) }

  function todayStr() { return new Date().toISOString().slice(0, 10) }
  function isNotExpired(expiryDate) { return expiryDate >= todayStr() }
  function hoursSince(isoStr) {
    return (Date.now() - new Date(isoStr).getTime()) / 3600000
  }

  // ── 呼叫後端驗證 ─────────────────────────────────────────────────
  async function remoteValidate(code) {
    const res = await fetch(`${VALIDATE_URL}?code=${encodeURIComponent(code)}`)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()  // { valid, expiryDate, daysLeft, reason }
  }

  // ── 放行：隱藏閘門 ───────────────────────────────────────────────
  function unlock(expiryDate) {
    showStatus(`授權有效，到期日：${expiryDate}`, 'ok')
    setTimeout(() => gate.classList.add('hidden'), 800)
  }

  // ── 顯示閘門狀態文字 ─────────────────────────────────────────────
  function showStatus(msg, type) {
    const el = document.getElementById('lg-status')
    el.textContent = msg
    el.className = 'lg-status ' + (type || '')
    el.style.display = 'block'
  }
  function hideStatus() {
    document.getElementById('lg-status').style.display = 'none'
  }

  // ── 主流程 ───────────────────────────────────────────────────────
  const cache = loadCache()

  if (cache && isNotExpired(cache.expiryDate)) {
    const needRecheck = !cache.lastValidated || hoursSince(cache.lastValidated) > RECHECK_HOURS

    if (!needRecheck) {
      // 快取新鮮，直接放行
      unlock(cache.expiryDate)
      return
    }

    // 需要重新確認，但先放行畫面（背景驗證）
    unlock(cache.expiryDate)
    try {
      const data = await remoteValidate(cache.code)
      if (data.valid) {
        saveCache(cache.code, data.expiryDate)
      } else {
        // 後端說無效（停用、刪除、次數耗盡）→ 清快取，下次開啟需重新輸入
        clearCache()
      }
    } catch {
      // 離線：沿用快取，不清除
    }
    return
  }

  // 快取過期或不存在 → 顯示授權閘
  gate.classList.remove('hidden')

  // ── 輸入框邏輯 ───────────────────────────────────────────────────
  const input = document.getElementById('lg-input')
  const btn   = document.getElementById('lg-btn')

  async function doValidate() {
    const code = input.value.trim().toUpperCase()
    if (!code) return

    btn.disabled = true
    btn.textContent = '驗證中…'
    hideStatus()

    try {
      const data = await remoteValidate(code)
      if (data.valid) {
        saveCache(code, data.expiryDate)
        unlock(data.expiryDate)
      } else {
        const msg = data.reason === 'EXPIRED'
          ? `此授權碼已於 ${data.expiryDate} 到期`
          : data.reason === 'DISABLED'
          ? '此授權碼已被停用，請聯絡管理員'
          : data.reason === 'EXCEEDED'
          ? `此授權碼的評估次數已用完（${data.usedCount}／${data.maxUses} 次），請聯絡管理員`
          : '授權碼無效，請確認後再試'
        showStatus(msg, 'error')
        input.select()
      }
    } catch {
      // 離線處理：若快取有資料但已過期，給明確提示
      if (cache) {
        showStatus('無法連線驗證，且本地授權已到期。請在有網路時重新確認。', 'error')
      } else {
        showStatus('無法連線至驗證伺服器，請確認網路後再試。', 'error')
      }
    }

    btn.disabled = false
    btn.textContent = '確認'
  }

  btn.addEventListener('click', doValidate)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doValidate() })

  // URL 帶碼自動登入
  // 優先讀路徑格式（不受 LINE 等 app 截斷 query string 影響）：
  //   https://heqinghealth.com/icope/XXXX-XXXX-XXXX
  // 也相容 query string 格式（備用）：
  //   https://heqinghealth.com/icope?code=XXXX-XXXX-XXXX
  const _pathSegs = window.location.pathname.split('/').filter(Boolean)
  const _pathCode = _pathSegs.length >= 2
    ? decodeURIComponent(_pathSegs[_pathSegs.length - 1])
    : null
  const urlCode = _pathCode || new URLSearchParams(window.location.search).get('code')

  if (urlCode) {
    input.value = urlCode.toUpperCase()
    doValidate()   // 自動驗證，不需使用者手動按確認
  } else {
    input.focus()
  }
})()
