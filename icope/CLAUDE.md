# CLAUDE.md — ICOPE 長者功能評估系統

## 專案概述 / Overview

ICOPE 是一套針對長者設計的多維功能評估網頁應用，部署於 `https://heqinghealth.com/icope`。
需要授權碼才能使用，評估完成後記錄使用次數。

## 檔案結構 / File Structure

```
icope/
├── index.html              # 整個 SPA，所有頁面 card 都在此，含 CSS
├── license.js              # 授權閘門（在 script.js 之前載入）
├── script.js               # 主程式：頁面流程、語音辨識、TTS、評估邏輯
├── shared-storage.js       # SharedStorage 工具（題目答案跨函式存取）
├── libs/
│   ├── audioProcessFromBrowser.js  # SpeechRecognition 封裝（iOS/Android 差異處理）
│   ├── audioProcess.js             # 舊版麥克風處理（目前保留備用）
│   ├── motionDetection.js          # 裝置運動感測（行動功能題）
│   ├── service-worker.js           # PWA 離線快取
│   └── wav-encoder.js              # 音訊編碼工具
└── sounds/
    ├── 619.mp4             # 聽力題第一輪數字音檔
    ├── 257.mp4             # 聽力題第二輪數字音檔（619 失敗後播）
    └── correct.mp3         # 答對音效
```

## 後端 API / Backend APIs

後端：`https://bodygo-web-backend-anfsetcnf4g9g8cq.eastasia-01.azurewebsites.net`

| 端點 | 方法 | 說明 |
|------|------|------|
| `/api/icope/validate?code=XXX` | GET | 驗證授權碼，回傳 valid/expiryDate/reason |
| `/api/icope/use?code=XXX` | POST | 評估完成，UsedCount +1（原子操作，尊重 MaxUses） |

## 授權邏輯 / License Flow (`license.js`)

1. 讀 `localStorage['icope_license_v1']`（含 code、expiryDate、lastValidated）
2. 快取存在且未過期且距上次驗證 < 20 小時 → 直接放行
3. 需要 recheck → 先放行，背景向後端驗證；無效則 `clearCache()`
4. 無快取 → 顯示授權閘門；支援 URL hash 自動帶碼（`#CODE`）
5. `unlock(code, expiryDate)` 放行時同時寫入 `sessionStorage['icope_session_code']`（備用）

## 評估流程 / Assessment Flow (`script.js`)

```
首頁（授權）→ Q1 記憶力記住 → Q2 定向日期 → Q3 定向地點
→ Q4 記憶力提問 → Q5 行動功能 → Q6 營養 → Q7 視力
→ Q8 聽力（619 → 257 兩輪）→ Q9 憂鬱 → 結果頁
```

- 每頁對應 `PAGES` 陣列中的一個項目，`goToPage(i)` 切換
- `_pageToken` 機制防止跨頁 callback 洩漏
- 結果頁：`_setupResult()` → `_recordUse()` 送出使用次數

## iOS / Android 語音辨識差異 / SR Platform Differences

| | iOS Safari | Android Chrome |
|-|-----------|----------------|
| continuous | true（持續運行） | false（每段重啟） |
| start() 限制 | 必須在使用者手勢同步路徑中 | 無限制 |
| event.results | 跨題累積，需 `_iosResultBase` 切割 | 每次只含當次 |
| TTS 衝突 | 可能殺死 SR，onend 重啟 | onend 自動重啟 |

## 重要注意事項 / Key Notes

- **iOS SR 啟動**：`startRecognition()` 必須在 `_permBtnClick()` 或 `_startAssessment()` 的同步手勢路徑中呼叫，不可在 `await` 之後
- **iOS 音訊解鎖**：`_startAssessment()` 中對所有 `<audio>` 元素執行 `play().then(pause)` 解鎖 autoplay
- **iOS 截圖**：`<a download>` 無效，改用浮層顯示圖片讓使用者長按儲存
- **評估次數**：`_recordUse()` 優先讀 `localStorage`，找不到時用 `sessionStorage['icope_session_code']` 備用
- **聽力題兩輪**：619 失敗後自動進 257，重聽按鈕兩輪共用（`_hearConfig`）
