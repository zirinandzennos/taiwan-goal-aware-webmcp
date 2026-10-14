# 台灣目標導向旅程（Taiwan Goal-aware Journey / WebMCP）

> **專案定位：競賽已結束，保留成果，改為「有空再繼續」的低優先級專案。**
>
> **唯一正式管理文件：本 `README.md`。** 程式、測試、快照及歷史技術文件保留原路徑；最新目標、決策、已驗證成果、問題及下一步只以本文件為準。Git Commit History 用來追溯歷史，不另建管理紀錄。
>
> **最近資料整理：2026-10-14（Asia/Taipei）。** 這是文件與來源核對，不代表當日重新執行程式、產品驗收或重新部署。

**English summary:** A goal-aware Taiwan journey-planning prototype with a deterministic Journey Engine, frozen official TDX timetables, shared webpage/WebMCP state, and simulated replanning. It is **not** a real-time navigation service. The WebMCP competition has ended; development is currently paused until the owner has spare time.

## 目錄

- [1. 目標與維護方式](#1-目標與維護方式)
- [2. 目前狀態](#2-目前狀態)
- [3. 已完成成果與重現證據](#3-已完成成果與重現證據)
- [4. 技術設計與已定規則](#4-技術設計與已定規則)
- [5. 資料與程式位置](#5-資料與程式位置)
- [6. 限制及尚未解決的問題](#6-限制及尚未解決的問題)
- [7. 有空重新啟動時的步驟](#7-有空重新啟動時的步驟)
- [8. 待使用者確認與長期方向](#8-待使用者確認與長期方向)
- [9. 來源界線與最近更新](#9-來源界線與最近更新)

## 1. 目標與維護方式

**核心問題不是「怎麼到某車站」，而是「依照當下條件，還能不能完成真正的行程目標」。**

例如：使用者從高雄出發，想在 Xpark 最後入場時間前進館。系統不只顯示高鐵抵達時間，還要處理進館步行、緩衝、交通銜接、費用、可行性；如果旅客途中位置或時間改變，就重新計算後續路線。

既有架構的分工：

1. **AI／網頁：** 理解與呈現旅客目的、限制及偏好；網頁維護當前這次旅程的狀態。
2. **Journey Engine：** 以可追溯的班表和規則計算實際可執行的候選路線、換乘時間、可行性和排序；不讓語言模型自行編造班次、時間或費用。
3. **WebMCP：** 讓支援 WebMCP 的代理讀取網頁已選條件並呼叫同一套引擎，不要求使用者重複填寫旅程資訊。

**2026-10-14 最新管理決定：** WebMCP Challenge 已截止，本專案不再為競賽提交、評審、錄影或截止日追工；**目前沒有進行中的開發派工或近期完成期限**。保留可用原型與研究，未來有空再決定是否改善。原有英文競賽材料僅作歷史參考，不再是待辦表。

## 2. 目前狀態

| 項目 | 現在能確定的狀態 |
| --- | --- |
| 競賽 | 已結束；轉為低優先級備用專案。不能把舊的投稿清單當作目前工作。 |
| 主要網頁 | 已有 TypeScript/Vite 原型，預設 **高鐵左營站 → Xpark**，展示日期 **2026-08-31 11:30**；只使用固定官方排定時刻快照。 |
| 規劃引擎 | 已實作候選班次、必要步行／換乘緩衝、目標期限檢查、Fastest／Balanced／Cheapest 排序及從新位置／時間重規劃。 |
| WebMCP | 最新程式碼有 **3 個唯讀工具**，共用網頁狀態；程式測試不等於已在正式公開網站完成 ChatGPT／代理端到端呼叫。 |
| 高雄車站多運具研究 | **高雄車站 → Xpark** 另有已保存的 MaaS/TDX 離線候選及最終證據，與左營站的主要網頁情境是**兩條不同工作線**。此資料**尚未進入主要網頁執行流程**。 |
| 公開展示 | 曾使用 [Netlify 展示網址](https://taiwan-goal-aware-webmcp.netlify.app/)。舊盤點在 **2026-10-12** 遇到 DNS／連線失敗；未獨立證實目前手機能正常開啟或部署的是哪個版本。不能逕稱網站全面故障。 |
| 測試 | GitHub 舊 README 記載 **156 項通過**；較新本機摘要記載 **185 項通過**，但未取得本機工作樹與 GitHub 的差異及可重現測試輸出。本次未重跑。 |
| 程式版本證據 | 2026-10-14 文件整理前，最後已核對的程式／資料提交是 [`ec716d93`（2026-08-31）](https://github.com/zirinandzennos/taiwan-goal-aware-webmcp/commit/ec716d93b5c67680e63c0dd64dab280654c07ae4)；10-14 之後的管理文件提交不代表程式功能升級。 |

**目前階段：展示原型及固定範圍研究成果已存在；公開部署、手機體驗和真實 WebMCP 呼叫尚待人類驗收。** 不是已可營運的即時交通服務。

## 3. 已完成成果與重現證據

### 3.1 固定官方高鐵時刻表與左營展示

- 資料來源：交通部 TDX 官方高鐵**排定時刻**，凍結區間 **2026-08-31 至 2026-09-06**，台灣時區 `Asia/Taipei`。
- [資料來源說明](docs/DATA_PROVENANCE.md)記錄：12 個節點、**1,141** 個有日期的列車班次、**9,481** 筆停靠時間；已產生靜態執行資料和 SHA-256 Manifest。
- 主要入館條件：以當時公開的 Xpark 週一最後入場規則計算，**2026-08-31 17:00** 為期限，另加上高鐵桃園站至場館約 **9 分鐘**的步行參考。營業時間可能臨時變動，因此這是**指定日期的規則展示**，不是對實際開館歷史的保證。
- 已記錄的黃金測例：左營 `11:30` 出發，規劃高鐵 **1634**，`11:35–13:09`；目標就緒 `13:18`；相較 `17:00` 最後入場有 **+222 分鐘**餘裕，狀態 `FEASIBLE`。
- 已記錄的**模擬**進度更新：將當前位置／時間改為**台南 2026-08-31 11:49**，重新規劃後不再把已離開的 1634 當作可搭乘班次，改找到 **0640，12:48–14:09**，展示的餘裕 **+162 分鐘**。這不是實際發生的延誤。
- 這些是既有測試／展示文件的**歷史預期結果**；2026-10-14 未重新執行播放器、網頁或代理驗收。

### 3.2 高雄車站 → Xpark 的離線研究（未併入網頁）

固定查詢時間：**2026-08-31 11:30**。離線 TDX MaaS 以 `gc=1`、`0.5`、`0` 各查 `top=10`，共取得 **30** 條回傳路線，正規化並去重後留 **10** 個候選；連接檢查未直接剔除候選。

驗證分為**原始資料層**和**追加證據／最終結論層**，不可混為同一種狀態：

| 驗證層級 | 結果 |
| --- | --- |
| 初步 Rail/Bus 驗證 | 28 段交通腿，20 段具精確 Rail 時刻；其他部分仍有身份／公車站點時間等 UNKNOWN。這是**中間結果**，不是整個專案最後結論。 |
| [最終 optimization proof](data/snapshots/2026-08-31_2026-09-06/optimization-proof.json) | 在該固定 10 候選的證據範圍內，**4 條確定可行、6 條證明不可行、0 條候選結果未解**。 |
| [正式推薦總結](data/snapshots/2026-08-31_2026-09-06/validation-summary.json) | **Fastest、Balanced、Cheapest 全部可正式產生**：Fastest 兩條並列，Balanced 唯一一條，Cheapest 四條並列。 |

公車 208A 固定站點出發時刻不符、特定高鐵服務不存在等，經另一層來源證據被判為無法執行。這表示**該日期、該固定候選集合**的疑點已收斂；**不表示**所有路線、所有日期都已取得完整即時班次或票價，也不表示線上介面已採用該研究。初步驗證階段的 `UNKNOWN` 應保留作為研究過程證據，但主文件的**最新最終結論**以上表為準。

### 3.3 工程基礎

- 同一網頁狀態供 Human UI 和 WebMCP 使用；WebMCP 不重複傳入旅程欄位。
- 有索引的 `TimetableStore.findNextDepartures()` 依站點及時間選班，不是把整張旅程答案寫死。
- 有 `planJourney()`、`replanJourney()`、換乘驗證、目標可行性判定和排序邏輯。
- 具備固定快照的下載、轉換、SQLite 索引驗證、匯出與 Manifest 檢查流程。
- 本機運作／CI 的舊測試有通過紀錄，但**當前版本的測試數量、端到端操作和上線品質都需另行驗證**。

## 4. 技術設計與已定規則

### 4.1 WebMCP 的三個介面（以現行程式為準）

| 工具名稱 | 用途 |
| --- | --- |
| `plan_taiwan_goal_aware_journey` | 根據**目前網頁狀態**取得 Fastest／Balanced／Cheapest；成本資料不完整時必須保留不能正式提供的理由。 |
| `check_taiwan_goal_feasibility` | 檢查所選真實目標在班表、期限及緩衝限制下是否可達成。 |
| `replan_taiwan_journey` | 從目前節點和目前時間重新計算**剩餘路線**，不假裝錯過的班次還能搭。 |

三者均在 [`src/webmcp/registerJourneyTool.ts`](src/webmcp/registerJourneyTool.ts) 透過 `document.modelContext.registerTool` 註冊，屬**唯讀**、**無重複旅程輸入參數**的 Site Tools；瀏覽器不支援時會顯示 WebMCP 不可用。舊競賽文件中「兩個工具」是先前版本敘述，**已被三工具程式碼取代**。

### 4.2 Journey Engine 的約束

- **先滿足硬限制，再比較偏好**：到達期限、允許交通種類、換乘條件等不能以漂亮分數掩蓋。
- **換乘可執行性**：`上一段抵達 + 該站／換乘的步行時間 + 必要換乘緩衝 = 下一段最早可搭時間`；班次不得早於最早可搭時間。證據中的固定轉乘緩衝以**一次**計算，避免重複扣除。
- **可行性四狀態**：`FEASIBLE`、`RISKY`、`IMPOSSIBLE`、`UNKNOWN`。缺少必要證據時用 `UNKNOWN`，不可猜測可行或把缺失金額當零。
- **Fastest** 看的是**目標完成時間**，不只是抵達車站。**Cheapest** 只對可比較的完整費用作正式推薦，否則回傳不能下結論。**Balanced** 使用可重現的固定權重 **35/20/15/10/10/10**：總時間／完整費用／步行／換乘次數／等待／銜接風險，以候選集合內 min-max 正規化；不是 AI 訓練的評分。
- **重規劃**：從當前位置與時間建立新的 `JourneyRequest`，交給同一套 `planJourney()`，而不是直接改舊行程上的幾個時間。
- **標準化時間軸**：`WALK`、`WAIT`、`BOARD`、`RIDE`、`ALIGHT`、`TRANSFER_WALK`、`GOAL_ACCESS`、`GOAL_COMPLETION`；每段記錄時間、費用覆蓋程度、資料品質和來源。缺少 GIS 路線幾何時不得自行虛構。
- **隱私與未知值**：`TravelerState` 以**單次旅程**為界；不需姓名、信箱、永久位置履歷或對話歷史。重要資訊使用帶來源的 `KnownUnknown`；不可透過 `AI_GUESSED` 假裝使用者已說明。
- **資料隔離**：瀏覽器只讀已匯出的公開靜態快照；TDX ID／Secret、存取權杖、原始供應商回應和 SQLite 工作資料不進公開庫，也不進前端。

### 4.3 來源界線

| 種類 | 可以如何使用 |
| --- | --- |
| **官方排定資料** | TDX THSR 七日固定時刻，以及離線 MaaS/Rail/Bus 驗證素材；是**排定計畫**，不是當時實際到站或即時行車狀態。 |
| **場館公布規則** | Xpark 最後入場與步行參考；只適用所展示的日期／規則快照，不能當成今日即時營業資訊。 |
| **模擬輸入** | 台南 11:49 的延誤／進度；目的在展示重新計算。 |
| **合成資料** | 只供測試或明確標示的次要 fixtures；不能宣稱是主要網頁的真實交通資訊。 |

歷史資料取得的教訓：早期想查 `2026-08-24` 及 `2026-08-27` 等過去日期，但 TDX 實際的每日時刻端點對歷史日期回應拒絕；因此當時改凍結 **2026-08-31 至 2026-09-06** 可取得的排定時刻，**沒有憑空補造歷史車次**。官方快照資料採政府開放資料授權條款第 1 版；專案程式碼採 [MIT](LICENSE)。重新抓資料前必須重新檢查供應商授權與可查日期。

## 5. 資料與程式位置

正式儲存庫：[`zirinandzennos/taiwan-goal-aware-webmcp`](https://github.com/zirinandzennos/taiwan-goal-aware-webmcp)；預設分支 `main`。

### 可操作的原型與核心程式

| 位置 | 用途 |
| --- | --- |
| [`index.html`](index.html)、[`src/app.ts`](src/app.ts)、[`src/app.css`](src/app.css) | 目前主要網頁入口／畫面；`src/main.ts` 只引入 `app.ts`，其餘舊 UI 是程式內註解歷史，不是目前介面。 |
| [`src/ui/state.ts`](src/ui/state.ts)、[`src/ui/journeyActions.ts`](src/ui/journeyActions.ts) | 目前旅程狀態、規劃與重新計算的 UI 共用入口。 |
| [`src/webmcp/registerJourneyTool.ts`](src/webmcp/registerJourneyTool.ts)、[`src/webmcp/pageState.ts`](src/webmcp/pageState.ts) | 三個工具與從頁面狀態組合標準請求的轉接層。 |
| [`src/journey/types.ts`](src/journey/types.ts)、[`src/journey/planner.ts`](src/journey/planner.ts)、[`src/journey/replanner.ts`](src/journey/replanner.ts) | 標準旅程契約、主規劃、重規劃。 |
| [`src/journey/candidates.ts`](src/journey/candidates.ts)、[`src/journey/connectionValidator.ts`](src/journey/connectionValidator.ts)、[`src/journey/ranking.ts`](src/journey/ranking.ts)、[`src/journey/feasibility.ts`](src/journey/feasibility.ts) | 候選生成、換乘約束、排序、目標可行性。 |
| [`src/journey/timetableStore.ts`](src/journey/timetableStore.ts)、[`src/journey/officialTimetable.ts`](src/journey/officialTimetable.ts) | 固定官方時刻表與索引。 |
| [`src/journey/modeValidation.ts`](src/journey/modeValidation.ts) | Rail/Bus 與正式推薦的證據驗證邏輯。 |
| [`src/data/officialTimetableSnapshot.json`](src/data/officialTimetableSnapshot.json)、[`src/data/officialTimetableManifest.json`](src/data/officialTimetableManifest.json)、[`src/data/officialGoldenGoal.json`](src/data/officialGoldenGoal.json) | 主要網頁離線使用的官方排定時刻快照、Manifest 及 Xpark 黃金目標。 |

### 離線研究資料（存在 GitHub，可重新取用）

固定資料目錄：[`data/snapshots/2026-08-31_2026-09-06/`](data/snapshots/2026-08-31_2026-09-06/)。

- [`manifest.json`](data/snapshots/2026-08-31_2026-09-06/manifest.json)：來源、查詢條件、資料產出及最終結果索引。
- [`maas-candidates.json`](data/snapshots/2026-08-31_2026-09-06/maas-candidates.json)：去重後的 MaaS 候選。
- [`official-secondary-evidence.json`](data/snapshots/2026-08-31_2026-09-06/official-secondary-evidence.json)、[`mode-validation.json`](data/snapshots/2026-08-31_2026-09-06/mode-validation.json)、[`fares.json`](data/snapshots/2026-08-31_2026-09-06/fares.json)：追加官方證據、交通工具驗證與費率證據。
- [`optimization-proof.json`](data/snapshots/2026-08-31_2026-09-06/optimization-proof.json)、[`validation-summary.json`](data/snapshots/2026-08-31_2026-09-06/validation-summary.json)：**目前最後可核對的固定候選結論**，優先於較早中間層狀態。
- [`candidate-service-inventory.json`](data/snapshots/2026-08-31_2026-09-06/candidate-service-inventory.json)、[`places.json`](data/snapshots/2026-08-31_2026-09-06/places.json)、[`goal-access.json`](data/snapshots/2026-08-31_2026-09-06/goal-access.json)：候選服務、位置、目標接駁資訊。

### 重新驗證與資料管線

專案根目錄使用 Node、TypeScript/Vite/Vitest；安裝與基礎驗證指令：

```bash
npm ci
npm test
npm run build
npm run timetable:golden
npm run journey:optimization-proof
```

- [`package.json`](package.json)：可執行指令與套件版本範圍。
- [`scripts/import/`](scripts/import/)：TDX 時刻抓取／正規化、SQLite 資料庫建立、靜態匯出、MaaS 取得與 Rail/Bus 驗證。`npm run journey:snapshot` 負責有憑證的固定走廊查詢，`npm run journey:validate` 負責查詢官方 Rail/Bus 證據；`npm run journey:optimization-proof` 使用保存資料產出最後的候選證明。
- [`.env.example`](.env.example)：只示範 `TDX_CLIENT_ID` 和 `TDX_CLIENT_SECRET` 設定；實際金鑰放在被 Git 忽略的本機 `.env`。沒有憑證就不應宣稱能重新取得遠端資料。
- [`netlify.toml`](netlify.toml)：使用 `npm run build`，發布 Vite 的 `dist`；**曾配置不等於已驗證目前部署正常**。
- [`tests/`](tests/)：候選、排定時刻、費率與推薦證明、可行性、模擬延誤、人類 UI／WebMCP 共用狀態及資料匯入測試。

### 歷史技術參考（非第二份管理文件）

- [架構圖](docs/ARCHITECTURE.md)、[Journey 契約](docs/journey-engine-contract.md)、[資料出處](docs/DATA_PROVENANCE.md)、[測試計畫](docs/test-plan.md)：技術背景；部分描述仍停在較早驗證階段，**最新專案狀態以本 README 及上述最新證據 JSON 為準**。
- [Challenge 工作邊界](docs/CHALLENGE_SCOPE.md)、[舊 Devpost 文字](docs/DEVPOST_SUBMISSION.md)、[舊評審操作](docs/JUDGING_INSTRUCTIONS.md)、[舊英文影片稿](docs/DEMO_SCRIPT_EN.md)、[舊投稿勾選清單](docs/SUBMISSION_CHECKLIST.md)：**已結束競賽的歷史資料**。不再把其中未勾選的錄影、YouTube、投稿或評審事項算成現行待辦。
- [Rebirth／zirin 舊專案卡](https://github.com/zirinandzennos/zirin/blob/main/projects/WebMCP.md)：2026-10-12 的舊狀態摘要已併入此處；該卡片只作遷移來源，不是繼續並行維護的另一份正式專案文件。
- [原展示 URL](https://taiwan-goal-aware-webmcp.netlify.app/)：僅保留入口與歷史用途，實際可用性未重新確認。

## 6. 限制及尚未解決的問題

1. **版本未對齊：** 舊本機摘要報 185 測試、舊 GitHub README 報 156；是否存在尚未上傳的新版程式和正確測試報告未知。
2. **公開網站未驗證：** Netlify DNS／站台／部署 Commit／手機操作尚未獲得新證據。競賽期間曾有發布紀錄，不等於現在一定能開。
3. **真正的 WebMCP E2E 未證實：** 工具註冊程式、模擬與單元測試存在，但未取得目前正式網站在相容環境下的成功代理呼叫紀錄。
4. **畫面驗收尚未完成：** 目前 `src/app.ts` 顯示**去重後的條件式選項分頁**，不同於「最快／平衡／最便宜三張卡同時可見」的想像。若未來仍需要真正三卡介面，屬後續 UI 需求，不可當作已完成。
5. **資料僅為歷史日期快照：** 不是今日即時導航；沒有即時延誤整合、GPS、自動重新定位、遠端 MCP、訂票／支付、正式 GIS 路線幾何。高雄車站多運具資料也尚未接回主要頁面。
6. **部分舊 `docs/` 文件仍記錄中間層結果或舊工具數量：** 保留作歷史技術材料，不能取代 `optimization-proof.json`、現行程式與本管理文件的最終狀態。

以上都是**未來若重啟時的待查事項**，而非目前需要立刻執行的阻礙或已啟動工作。

## 7. 有空重新啟動時的步驟

**目前不排工期、不派 Codex、不進行競賽補件。** 等使用者主動再次安排這個專案，再依順序進行：

1. **先恢復可靠的版本基線。** 在能操作原本機器時，核對本機專案路徑／Git 分支／Commit、185 測試證據，與此儲存庫最新版的差異。不要不經比對就以較舊版覆蓋本機變更。
2. **重跑基本驗證。** 在選定的實際版本執行 `npm ci`、`npm test`、`npm run build`、`npm run timetable:golden`、`npm run journey:optimization-proof`，記錄成功／失敗及實際測試數量；未跑前保留目前的歷史測試標籤。
3. **若要再次展示，才檢查部署。** 核實 Netlify 網站、發布路徑與部署 Commit，確認手機能開；依照既有 Xpark 黃金流程操作，檢查切換分頁及模擬延誤重規劃。
4. **驗證真實 WebMCP 呼叫。** 分別查工具發現、三工具註冊、代理實際呼叫、與人類 UI 相同輸入是否回傳一致結果；有失敗就記錄具體環境、重現步驟及輸出。
5. **最後才決定新功能。** 評估三卡 UI、高雄車站多運具結果接入、擴增資料日期與路線、即時交通或 GPS；一次只做經過確認的一個功能，不擅自展開大型改寫。

每次取得可核實的新成果，**直接在本 README 對應章節替換舊狀態**；有效實驗證據與成果路徑保留。更新後 Commit 並讀回驗證，不另建 CHANGELOG／進度表。

## 8. 待使用者確認與長期方向

**現在沒有需要使用者立即決定或驗收的事項。** 本專案已被明確列為閒暇專案。

下次重啟前可能要確認的產品方向（均**未排程、未實作**）：

- 要維持「達成特定目的的交通可行性」工具，還是拓展成跨台灣的多運具旅程服務。
- 是否要在路線排序納入更多旅客條件：行李、趕時間／休閒、成本敏感度、步行能力、交通工具可用性等。既有 `TravelerState` 已留部分欄位，但網頁展示未提供完整可操作流程。
- 是否擴充至即時 TDX、GPS 現況、遠端 MCP、旅程中的活動、餐飲、住宿，及如何確保來源與授權可核實。
- 若重新展示，是否採用**同時看三卡**的手機結果 UI，或保留目前**條件式選項分頁**。

這些是可討論的後續方向，**不能寫成已決策要實作，更不能寫成已完成**。

## 9. 來源界線與最近更新

### 可核對來源

1. **原程式／資料：** [此儲存庫](https://github.com/zirinandzennos/taiwan-goal-aware-webmcp) 的 `main`、實際 `src/`、`tests/`、`scripts/import/` 及固定 `data/snapshots/`。
2. **目前離線候選最終結果：** [`validation-summary.json`](data/snapshots/2026-08-31_2026-09-06/validation-summary.json) + [`optimization-proof.json`](data/snapshots/2026-08-31_2026-09-06/optimization-proof.json)。其固定日期與候選界線不可外推。
3. **曾核對的程式／資料提交：** [`ec716d93`](https://github.com/zirinandzennos/taiwan-goal-aware-webmcp/commit/ec716d93b5c67680e63c0dd64dab280654c07ae4)（2026-08-31）。
4. **待驗證的本機資訊：** [舊 Rebirth 專案卡](https://github.com/zirinandzennos/zirin/blob/main/projects/WebMCP.md)（資料確認時間 2026-10-12）記載「185 項測試」、本機高雄車站版本和 Netlify 連線疑慮；本次**未取得**該本機程式和原始測試結果。
5. **競賽歷史檔案：** `docs/` 中的競賽說明、英文稿、舊提交清單與測試指引。比賽已結束，保留作源流，不再據此排工作。

### 最近更新（2026-10-14）

- 接受最新決定：**競賽結束 → 低優先級、空閒時再繼續**；將競賽投稿與評審交付從目前待辦移走。
- 將 Rebirth 舊 `projects/WebMCP.md` 的狀態、185 項本機測試線索、部署／手機驗收疑慮，連同本庫完整功能、實驗結論、來源及實體路徑，**合併為本 README 唯一正式專案狀態**。
- 明確區分左營站官方高鐵網頁展示與高雄車站 MaaS 離線研究；以**10 候選／4 可行／6 不可行／三類正式推薦已可產生**取代較早「三類推薦全受阻」的最終敘述。
- 標示舊競賽文件的過期條目；保留有效技術證據、原始程式、歷史文件與 Git Commit History。**本次只做主文件管理更新，沒有新增功能、跑測試或修復部署。**
