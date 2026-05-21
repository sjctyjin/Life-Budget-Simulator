/**
 * 當沖復盤日誌 — UI 互動邏輯
 * 處理 Tab 切換、表單互動、localStorage 存取、圖表渲染
 */

(function () {
    'use strict';

    // ---- 工具函數 ----
    const $ = (id) => document.getElementById(id);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ---- 狀態 ----
    let currentTab = 'advisor';
    let advDirection = 'long';
    let advEmotion = '';
    let trDirection = 'long';
    let trEmotion = '';
    let trTags = new Set();
    let editingTradeId = null;
    let pnlChart = null;
    let dirChart = null;
    let radarInterval = null;
    let lastSectorData = null; // 最新的族群動能數據

    // ---- 初始化 ----
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // 設定今日日期為預設
        const today = new Date().toISOString().split('T')[0];
        if ($('tr-date')) $('tr-date').value = today;

        // 設定預設日期範圍 (過去 30 天)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        if ($('dash-start')) $('dash-start').value = thirtyDaysAgo;
        if ($('dash-end')) $('dash-end').value = today;

        setupTabs();
        setupAdvisor();
        setupRadar();
        setupTradeForm();
        setupDashboard();
        renderTradeList();
    }

    // ==================== TAB 切換 ====================
    function setupTabs() {
        $$('.journal-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                const panel = tab.dataset.panel;
                $$('.journal-tab').forEach(t => t.classList.remove('active'));
                $$('.journal-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const targetPanel = $('panel-' + panel);
                if (targetPanel) targetPanel.classList.add('active');
                currentTab = panel;

                // 切換到 Dashboard 時更新圖表
                if (panel === 'dashboard') refreshDashboard();
            });
        });
    }

    // ==================== AI 顧問 (Tab 1) ====================
    function setupAdvisor() {
        // 方向切換
        $$('#panel-advisor .direction-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#panel-advisor .direction-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                advDirection = btn.dataset.dir;
            });
        });

        // 情緒選擇
        $$('#adv-emotion-grid .emotion-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#adv-emotion-grid .emotion-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                advEmotion = btn.dataset.emotion;
            });
        });

        // VWAP 自動取得
        if ($('btn-adv-vwap')) {
            $('btn-adv-vwap').addEventListener('click', async function () {
                const symbol = $('adv-symbol').value;
                if (!symbol) { alert('請先輸入股票代號'); return; }
                const btn = this;
                btn.innerHTML = '⏳ 取得中';
                btn.disabled = true;
                const vwapData = await JournalEngine.fetchVWAP(symbol);
                btn.innerHTML = '🔄 VWAP';
                btn.disabled = false;
                
                if (vwapData) {
                    const text = `\n[系統自動帶入] 目前股價 ${vwapData.currentPrice}，VWAP = ${vwapData.vwap} (${vwapData.position === 'above' ? '股價在VWAP上方' : vwapData.position === 'below' ? '股價在VWAP下方' : '股價接近VWAP'}，斜率${vwapData.slope === 'up' ? '向上' : vwapData.slope === 'down' ? '向下' : '持平'})`;
                    const reason = $('adv-reason');
                    reason.value = (reason.value + text).trim();
                } else {
                    alert('無法取得今日 VWAP 數據，請確認代號是否正確。');
                }
            });
        }

        // 每日虧損即時檢查熔斷
        if ($('adv-daily-loss')) {
            $('adv-daily-loss').addEventListener('input', checkMeltdown);
        }
        if ($('adv-meltdown')) {
            $('adv-meltdown').addEventListener('input', checkMeltdown);
        }

        // 評估按鈕
        if ($('btn-evaluate')) {
            $('btn-evaluate').addEventListener('click', runEvaluation);
        }

        // 進場/放棄按鈕
        if ($('btn-proceed')) {
            $('btn-proceed').addEventListener('click', function () {
                saveConsultationDecision(true);
            });
        }
        if ($('btn-abort')) {
            $('btn-abort').addEventListener('click', function () {
                saveConsultationDecision(false);
            });
        }
    }

    // ==================== 族群動能雷達 ====================
    function setupRadar() {
        if ($('btn-refresh-radar')) {
            $('btn-refresh-radar').addEventListener('click', fetchSectorMomentum);
        }
        if ($('radar-auto-refresh')) {
            $('radar-auto-refresh').addEventListener('change', function () {
                if (this.checked) {
                    fetchSectorMomentum();
                    radarInterval = setInterval(fetchSectorMomentum, 3 * 60 * 1000);
                } else {
                    if (radarInterval) { clearInterval(radarInterval); radarInterval = null; }
                }
            });
        }
    }

    async function fetchSectorMomentum() {
        const market = $('radar-market') ? $('radar-market').value : 'tw';
        const loading = $('radar-loading');
        const results = $('radar-results');
        const btn = $('btn-refresh-radar');

        if (loading) loading.style.display = '';
        if (results) results.innerHTML = '';
        if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 掃描中...'; }

        try {
            const res = await fetch('/api/sector/momentum?market=' + market);
            const data = await res.json();
            lastSectorData = data;
            renderSectorRadar(data);
        } catch (err) {
            if (results) results.innerHTML = '<div class="empty-state"><p>掃描失敗：' + err.message + '</p></div>';
        } finally {
            if (loading) loading.style.display = 'none';
            if (btn) { btn.disabled = false; btn.innerHTML = '📡 掃描'; }
        }
    }

    function renderSectorRadar(data) {
        const container = $('radar-results');
        const tsEl = $('radar-timestamp');
        if (!container) return;

        if (!data || !data.sectors || data.sectors.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>無族群數據</p></div>';
            return;
        }

        if (tsEl) {
            const ts = new Date(data.timestamp);
            tsEl.textContent = '更新時間：' + ts.toLocaleTimeString('zh-TW') + ' (耗時 ' + data.elapsed + 's)';
        }

        let html = '';
        data.sectors.forEach(function (sector, idx) {
            if (sector.error) return;
            const vrClass = sector.momentum || 'normal';
            const changeClass = sector.avgChange >= 0 ? 'positive' : 'negative';
            const alertClass = sector.alert ? ' alert' : '';

            html += '<div class="sector-bar-container" data-idx="' + idx + '">' +
                '<div class="sector-bar-header' + alertClass + '">' +
                '<span class="sector-bar-name">' + (sector.alert ? '🔥 ' : '') + sector.name + '</span>' +
                '<div class="sector-bar-metrics">' +
                '<span class="sector-vr ' + vrClass + '">VR ' + sector.avgVolumeRatio + 'x</span>' +
                '<span class="sector-change ' + changeClass + '">' + (sector.avgChange >= 0 ? '+' : '') + sector.avgChange + '%</span>' +
                '<span class="sector-hot-count">' + sector.hotStocks + '/' + sector.totalStocks + ' 熱</span>' +
                '<span class="sector-expand-icon">▼</span>' +
                '</div>' +
                '</div>' +
                '<div class="sector-stock-detail">' +
                renderSectorStocks(sector.stocks) +
                '</div>' +
                '</div>';
        });

        container.innerHTML = html;

        // 綁定展開/收合
        container.querySelectorAll('.sector-bar-header').forEach(function (header) {
            header.addEventListener('click', function () {
                header.parentElement.classList.toggle('expanded');
            });
        });
    }

    function renderSectorStocks(stocks) {
        if (!stocks || stocks.length === 0) return '<p style="padding:10px;color:var(--text-dim);">無數據</p>';
        let html = '<table class="sector-stock-table"><thead><tr>' +
            '<th>代號</th><th>名稱</th><th>現價</th><th>漲跌%</th><th>Volume Ratio</th>' +
            '</tr></thead><tbody>';
        stocks.forEach(function (s) {
            const changeClass = s.change >= 0 ? 'positive' : 'negative';
            const barWidth = Math.min(100, Math.max(5, s.volumeRatio * 25));
            const barColor = s.volumeRatio >= 2.5 ? '#ef4444' : s.volumeRatio >= 1.8 ? '#f59e0b' : s.volumeRatio >= 1.2 ? '#818cf8' : '#64748b';
            html += '<tr>' +
                '<td style="font-weight:600;">' + s.symbol + '</td>' +
                '<td>' + s.name + '</td>' +
                '<td>' + s.price + '</td>' +
                '<td class="sector-change ' + changeClass + '">' + (s.change >= 0 ? '+' : '') + s.change + '%</td>' +
                '<td>' + s.volumeRatio + 'x <span class="stock-vr-bar" style="width:' + barWidth + 'px;background:' + barColor + ';"></span></td>' +
                '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    // 取得族群動能加分資訊 (供 AI 評估用)
    function getSectorContext(symbol) {
        if (!lastSectorData || !lastSectorData.sectors) return null;
        for (const sector of lastSectorData.sectors) {
            if (!sector.stocks) continue;
            const found = sector.stocks.find(s => s.symbol === symbol);
            if (found) {
                return {
                    sectorName: sector.name,
                    sectorVR: sector.avgVolumeRatio,
                    sectorChange: sector.avgChange,
                    sectorAlert: sector.alert,
                    sectorMomentum: sector.momentum,
                    hotStocks: sector.hotStocks,
                    totalStocks: sector.totalStocks,
                    stockVR: found.volumeRatio,
                    stockChange: found.change,
                };
            }
        }
        return null;
    }

    function checkMeltdown() {
        const loss = parseFloat($('adv-daily-loss').value) || 0;
        const limit = parseFloat($('adv-meltdown').value) || 5000;
        const banner = $('meltdown-banner');
        if (banner) {
            if (loss >= limit) {
                banner.classList.add('active');
            } else {
                banner.classList.remove('active');
            }
        }
    }

    function runEvaluation() {
        const symbol = ($('adv-symbol').value || '').trim().toUpperCase();
        const reason = ($('adv-reason').value || '').trim();
        const dailyLoss = parseFloat($('adv-daily-loss').value) || 0;
        const meltdownLimit = parseFloat($('adv-meltdown').value) || 5000;

        // 驗證
        if (!symbol) { alert('請輸入股票代號'); $('adv-symbol').focus(); return; }
        if (!reason) { alert('請描述你的進場理由'); $('adv-reason').focus(); return; }
        if (!advEmotion) { alert('請選擇你目前的情緒狀態'); return; }

        // 取得歷史交易資料
        const allTrades = JournalEngine.getAllTrades();

        // 取得族群動能資訊
        const sectorCtx = getSectorContext(symbol);

        // 呼叫 AI 引擎
        const result = JournalEngine.evaluateConsultation({
            symbol: symbol,
            direction: advDirection,
            reason: reason,
            emotion: advEmotion,
            dailyLoss: dailyLoss,
            meltdownLimit: meltdownLimit,
            sectorContext: sectorCtx,
        }, allTrades);

        // 顯示結果
        renderVerdict(result);

        // 儲存此次諮詢
        window._lastConsultation = {
            symbol: symbol,
            market: $('adv-market').value,
            direction: advDirection,
            reason: reason,
            emotion: advEmotion,
            dailyLoss: dailyLoss,
            aiScore: result.score,
            aiVerdict: result.verdict,
            aiFeedback: result.advice,
        };
    }

    function renderVerdict(result) {
        const container = $('advisor-results');
        const card = $('verdict-card');
        if (!container || !card) return;

        // 移除舊的 verdict class
        card.classList.remove('verdict-green', 'verdict-yellow', 'verdict-red');
        card.classList.add('verdict-' + result.verdict);

        // 分數
        const scoreEl = $('verdict-score');
        if (scoreEl) {
            scoreEl.textContent = result.score;
            scoreEl.style.color = result.verdict === 'green' ? 'var(--accent-green)' :
                result.verdict === 'yellow' ? 'var(--accent-yellow)' : 'var(--accent-red)';
        }

        // 判定文字
        const textEl = $('verdict-text');
        if (textEl) textEl.textContent = result.verdictText;

        // 標記
        const flagsEl = $('verdict-flags');
        if (flagsEl) {
            flagsEl.innerHTML = result.flags.map(f =>
                '<span class="verdict-flag">' + f + '</span>'
            ).join('');
        }

        // 詳細說明
        const detailsEl = $('verdict-details');
        if (detailsEl) {
            detailsEl.innerHTML = result.details.map(d =>
                '<div class="verdict-detail ' + d.type + '">' +
                '<span class="verdict-detail-icon">' + d.icon + '</span>' +
                '<span class="verdict-detail-text">' + d.text + '</span>' +
                '</div>'
            ).join('');
        }

        // 建議
        const adviceEl = $('verdict-advice');
        if (adviceEl) {
            adviceEl.innerHTML = '<div class="advice-title">💡 AI 建議</div>' +
                '<div class="advice-content">' + result.advice + '</div>';
        }

        // 顯示行動按鈕
        if ($('btn-proceed')) $('btn-proceed').style.display = 'inline-flex';
        if ($('btn-abort')) $('btn-abort').style.display = 'inline-flex';

        // 顯示結果區塊
        container.classList.add('active');

        // 滾動到結果
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function saveConsultationDecision(didTrade) {
        if (!window._lastConsultation) return;
        const consultation = {
            ...window._lastConsultation,
            timestamp: new Date().toISOString(),
            didTrade: didTrade,
        };
        JournalEngine.addConsultation(consultation);

        if (didTrade) {
            // 跳轉到復盤日誌 Tab，預填資料
            $('tab-journal').click();
            prefillTradeForm(consultation);
            alert('✅ 已記錄你的決定。請在交易結束後回來填寫復盤日誌。');
        } else {
            alert('🛑 明智的決定！已記錄此次放棄的諮詢。');
        }
        window._lastConsultation = null;

        // 隱藏按鈕
        if ($('btn-proceed')) $('btn-proceed').style.display = 'none';
        if ($('btn-abort')) $('btn-abort').style.display = 'none';
    }

    function prefillTradeForm(consultation) {
        if ($('tr-symbol')) $('tr-symbol').value = consultation.symbol;
        if ($('tr-market')) $('tr-market').value = consultation.market;
        if ($('tr-reason')) $('tr-reason').value = consultation.reason;

        // 設定方向
        trDirection = consultation.direction;
        $$('#tr-direction-toggle .direction-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.dir === consultation.direction) b.classList.add('active');
        });

        // 設定情緒
        trEmotion = consultation.emotion;
        $$('#tr-emotion-grid .emotion-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.emotion === consultation.emotion) b.classList.add('active');
        });
    }

    // ==================== 復盤日誌 (Tab 2) ====================
    function setupTradeForm() {
        // 方向切換
        $$('#tr-direction-toggle .direction-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#tr-direction-toggle .direction-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                trDirection = btn.dataset.dir;
            });
        });

        // 情緒選擇
        $$('#tr-emotion-grid .emotion-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#tr-emotion-grid .emotion-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                trEmotion = btn.dataset.emotion;
            });
        });

        // 標籤選擇
        $$('#tr-tag-grid .tag-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                btn.classList.toggle('active');
                const tag = btn.dataset.tag;
                if (trTags.has(tag)) trTags.delete(tag); else trTags.add(tag);
            });
        });

        // VWAP 自動取得
        if ($('btn-tr-vwap')) {
            $('btn-tr-vwap').addEventListener('click', async function () {
                const symbol = $('tr-symbol').value;
                if (!symbol) { alert('請先輸入股票代號'); return; }
                const btn = this;
                btn.innerHTML = '⏳ 取得中';
                btn.disabled = true;
                const vwapData = await JournalEngine.fetchVWAP(symbol);
                btn.innerHTML = '🔄 VWAP';
                btn.disabled = false;
                
                if (vwapData) {
                    if ($('tr-vwap-pos')) $('tr-vwap-pos').value = vwapData.position;
                    if ($('tr-vwap-slope')) $('tr-vwap-slope').value = vwapData.slope;
                    // 如果原本沒有填進場價，順便填入最新價
                    if ($('tr-entry-price') && !$('tr-entry-price').value) {
                        $('tr-entry-price').value = vwapData.currentPrice;
                    }
                } else {
                    alert('無法取得今日 VWAP 數據，請確認代號是否正確。');
                }
            });
        }

        // 損益即時計算
        ['tr-entry-price', 'tr-exit-price', 'tr-shares'].forEach(function (id) {
            const el = $(id);
            if (el) el.addEventListener('input', updatePnlPreview);
        });

        // 儲存按鈕
        if ($('btn-save-trade')) {
            $('btn-save-trade').addEventListener('click', saveTrade);
        }

        // 清空按鈕
        if ($('btn-clear-form')) {
            $('btn-clear-form').addEventListener('click', clearTradeForm);
        }

        // 搜尋
        if ($('trade-search')) {
            $('trade-search').addEventListener('input', function () {
                renderTradeList(this.value.trim().toUpperCase());
            });
        }

        // 匯出 CSV
        if ($('btn-export-csv')) {
            $('btn-export-csv').addEventListener('click', exportCSV);
        }
    }

    function updatePnlPreview() {
        const entry = parseFloat($('tr-entry-price').value) || 0;
        const exit = parseFloat($('tr-exit-price').value) || 0;
        const shares = parseInt($('tr-shares').value) || 1;
        const input = $('tr-pnl');
        if (!input || !entry || !exit) { if (input) input.value = ''; return; }

        const market = $('tr-market').value;
        let pnl;
        if (trDirection === 'long') {
            pnl = (exit - entry) * shares;
        } else {
            pnl = (entry - exit) * shares;
        }
        // 台股一張 = 1000 股
        if (market === 'tw') pnl *= 1000;

        input.value = Math.round(pnl);
        input.style.color = pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }

    function saveTrade() {
        // 收集表單資料
        const date = ($('tr-date').value || '').trim();
        const symbol = ($('tr-symbol').value || '').trim().toUpperCase();
        const market = $('tr-market').value;
        const entryPrice = parseFloat($('tr-entry-price').value);
        const exitPrice = parseFloat($('tr-exit-price').value);
        const shares = parseInt($('tr-shares').value) || 1;

        // 驗證
        if (!date) { alert('請選擇日期'); return; }
        if (!symbol) { alert('請輸入股票代號'); return; }
        if (isNaN(entryPrice)) { alert('請輸入進場價'); return; }
        if (isNaN(exitPrice)) { alert('請輸入出場價'); return; }

        // 計算損益
        let pnl = parseFloat($('tr-pnl').value);
        if (isNaN(pnl)) {
            if (trDirection === 'long') {
                pnl = (exitPrice - entryPrice) * shares;
            } else {
                pnl = (entryPrice - exitPrice) * shares;
            }
            if (market === 'tw') pnl *= 1000;
        }

        const trade = {
            date: date,
            market: market,
            symbol: symbol,
            direction: trDirection,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            shares: shares,
            pnl: Math.round(pnl),
            vwapPosition: $('tr-vwap-pos').value || '',
            vwapSlope: $('tr-vwap-slope').value || '',
            vwapPullback: $('tr-vwap-pullback').value === 'yes',
            emotionBefore: trEmotion,
            reasonText: ($('tr-reason').value || '').trim(),
            whatWentRight: ($('tr-right').value || '').trim(),
            whatWentWrong: ($('tr-wrong').value || '').trim(),
            improvement: ($('tr-improve').value || '').trim(),
            tags: [...trTags],
        };

        if (editingTradeId) {
            JournalEngine.updateTrade(editingTradeId, trade);
            editingTradeId = null;
            $('btn-save-trade').innerHTML = '💾 儲存交易紀錄';
            alert('✅ 交易紀錄已更新！');
        } else {
            JournalEngine.addTrade(trade);
            alert('✅ 交易紀錄已儲存！');
        }

        clearTradeForm();
        renderTradeList();
    }

    function clearTradeForm() {
        const today = new Date().toISOString().split('T')[0];
        if ($('tr-date')) $('tr-date').value = today;
        if ($('tr-symbol')) $('tr-symbol').value = '';
        if ($('tr-entry-price')) $('tr-entry-price').value = '';
        if ($('tr-exit-price')) $('tr-exit-price').value = '';
        if ($('tr-shares')) $('tr-shares').value = '1';
        if ($('tr-vwap-pos')) $('tr-vwap-pos').value = '';
        if ($('tr-vwap-slope')) $('tr-vwap-slope').value = '';
        if ($('tr-vwap-pullback')) $('tr-vwap-pullback').value = '';
        if ($('tr-reason')) $('tr-reason').value = '';
        if ($('tr-right')) $('tr-right').value = '';
        if ($('tr-wrong')) $('tr-wrong').value = '';
        if ($('tr-improve')) $('tr-improve').value = '';
        if ($('tr-pnl')) { $('tr-pnl').value = ''; $('tr-pnl').style.color = ''; }

        trDirection = 'long';
        trEmotion = '';
        trTags.clear();
        editingTradeId = null;

        $$('#tr-direction-toggle .direction-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.dir === 'long') b.classList.add('active');
        });
        $$('#tr-emotion-grid .emotion-btn').forEach(b => b.classList.remove('active'));
        $$('#tr-tag-grid .tag-btn').forEach(b => b.classList.remove('active'));
        if ($('btn-save-trade')) $('btn-save-trade').innerHTML = '💾 儲存交易紀錄';
    }

    function renderTradeList(filterSymbol) {
        const listEl = $('trade-list');
        const emptyEl = $('empty-trade-list');
        if (!listEl) return;

        let trades = JournalEngine.getAllTrades();

        // 過濾
        if (filterSymbol) {
            trades = trades.filter(t => t.symbol.includes(filterSymbol));
        }

        // 按日期排序 (最新在前)
        trades.sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1));

        if (trades.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) {
                emptyEl.style.display = '';
                listEl.appendChild(emptyEl);
            }
            return;
        }

        const emotionMap = {
            revenge: '😤 急躁', fomo: '😰 FOMO', calm: '😌 冷靜',
            hesitant: '🤔 猶豫', overconfident: '🔥 過度自信'
        };
        const dirMap = { long: '📈 做多', short: '📉 做空' };

        let html = '';
        trades.forEach(function (t) {
            const isWin = t.pnl >= 0;
            const pnlClass = isWin ? 'positive' : 'negative';
            const borderClass = isWin ? 'win' : 'loss';
            const pnlText = (isWin ? '+' : '') + '$' + Math.abs(t.pnl).toLocaleString();

            const tagsHtml = (t.tags || []).map(tag =>
                '<span class="trade-tag">' + tag + '</span>'
            ).join('');

            html += '<div class="trade-entry ' + borderClass + '" data-id="' + t.id + '">' +
                '<div class="trade-entry-header">' +
                '<div class="trade-meta">' +
                '<span class="trade-date">' + t.date + '</span>' +
                '<span class="trade-symbol">' + t.symbol + '</span>' +
                '<span class="trade-dir">' + (dirMap[t.direction] || t.direction) + '</span>' +
                '<span class="trade-emotion">' + (emotionMap[t.emotionBefore] || '') + '</span>' +
                '</div>' +
                '<div class="trade-pnl ' + pnlClass + '">' + pnlText + '</div>' +
                '</div>' +
                '<div class="trade-prices">' +
                '<span>進場：' + t.entryPrice + '</span>' +
                '<span>→ 出場：' + t.exitPrice + '</span>' +
                '<span>(' + t.shares + (t.market === 'tw' ? '張' : '股') + ')</span>' +
                '</div>' +
                (t.reasonText ? '<div class="trade-reason">' + t.reasonText + '</div>' : '') +
                (tagsHtml ? '<div class="trade-tags">' + tagsHtml + '</div>' : '') +
                '<div class="trade-actions">' +
                '<button class="btn-trade-action btn-edit" data-id="' + t.id + '">✏️ 編輯</button>' +
                '<button class="btn-trade-action btn-delete" data-id="' + t.id + '">🗑️ 刪除</button>' +
                '</div>' +
                '</div>';
        });

        listEl.innerHTML = html;

        // 綁定編輯/刪除按鈕
        listEl.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                editTrade(btn.dataset.id);
            });
        });
        listEl.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (confirm('確定要刪除此筆交易紀錄嗎？')) {
                    JournalEngine.deleteTrade(btn.dataset.id);
                    renderTradeList();
                }
            });
        });
    }

    function editTrade(id) {
        const trades = JournalEngine.getAllTrades();
        const trade = trades.find(t => t.id === id);
        if (!trade) return;

        editingTradeId = id;

        // 填入表單
        if ($('tr-date')) $('tr-date').value = trade.date;
        if ($('tr-symbol')) $('tr-symbol').value = trade.symbol;
        if ($('tr-market')) $('tr-market').value = trade.market || 'tw';
        if ($('tr-entry-price')) $('tr-entry-price').value = trade.entryPrice;
        if ($('tr-exit-price')) $('tr-exit-price').value = trade.exitPrice;
        if ($('tr-shares')) $('tr-shares').value = trade.shares;
        if ($('tr-pnl')) {
            $('tr-pnl').value = trade.pnl;
            $('tr-pnl').style.color = trade.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
        if ($('tr-vwap-pos')) $('tr-vwap-pos').value = trade.vwapPosition || '';
        if ($('tr-vwap-slope')) $('tr-vwap-slope').value = trade.vwapSlope || '';
        if ($('tr-vwap-pullback')) $('tr-vwap-pullback').value = trade.vwapPullback ? 'yes' : (trade.vwapPullback === false ? 'no' : '');
        if ($('tr-reason')) $('tr-reason').value = trade.reasonText || '';
        if ($('tr-right')) $('tr-right').value = trade.whatWentRight || '';
        if ($('tr-wrong')) $('tr-wrong').value = trade.whatWentWrong || '';
        if ($('tr-improve')) $('tr-improve').value = trade.improvement || '';

        // 方向
        trDirection = trade.direction || 'long';
        $$('#tr-direction-toggle .direction-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.dir === trDirection) b.classList.add('active');
        });

        // 情緒
        trEmotion = trade.emotionBefore || '';
        $$('#tr-emotion-grid .emotion-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.emotion === trEmotion) b.classList.add('active');
        });

        // 標籤
        trTags = new Set(trade.tags || []);
        $$('#tr-tag-grid .tag-btn').forEach(b => {
            b.classList.toggle('active', trTags.has(b.dataset.tag));
        });

        // 更新按鈕文字
        if ($('btn-save-trade')) $('btn-save-trade').innerHTML = '✏️ 更新交易紀錄';

        // 更新損益預覽
        updatePnlPreview();

        // 滾動到表單
        $('trade-form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function exportCSV() {
        const trades = JournalEngine.getAllTrades();
        if (trades.length === 0) { alert('沒有交易紀錄可匯出'); return; }

        const headers = ['日期', '代號', '市場', '方向', '進場價', '出場價', '張/股數', '損益', '情緒', '理由', '做對', '做錯', '改進', '標籤'];
        const rows = trades.map(t => [
            t.date, t.symbol, t.market, t.direction === 'long' ? '做多' : '做空',
            t.entryPrice, t.exitPrice, t.shares, t.pnl,
            t.emotionBefore || '', (t.reasonText || '').replace(/,/g, '，'),
            (t.whatWentRight || '').replace(/,/g, '，'),
            (t.whatWentWrong || '').replace(/,/g, '，'),
            (t.improvement || '').replace(/,/g, '，'),
            (t.tags || []).join(';')
        ]);

        const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '當沖復盤日誌_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ==================== 歷史分析 (Tab 3) ====================
    function setupDashboard() {
        if ($('btn-refresh-dash')) {
            $('btn-refresh-dash').addEventListener('click', refreshDashboard);
        }
    }

    function refreshDashboard() {
        const startDate = ($('dash-start').value || '');
        const endDate = ($('dash-end').value || '');
        const market = ($('dash-market').value || 'all');

        let trades = JournalEngine.getAllTrades();

        // 日期過濾
        if (startDate) trades = trades.filter(t => t.date >= startDate);
        if (endDate) trades = trades.filter(t => t.date <= endDate);
        if (market !== 'all') trades = trades.filter(t => t.market === market);

        const stats = JournalEngine.calculateStats(trades);

        // 更新統計卡片
        updateStatCard('stat-total', stats.totalTrades, '筆');
        updateStatCard('stat-winrate', stats.totalTrades > 0 ? Math.round(stats.winRate * 100) + '%' : '--%', '', stats.winRate >= 0.5);
        updateStatCard('stat-pnl', formatCurrency(stats.totalPnl), '', stats.totalPnl >= 0);
        updateStatCard('stat-discipline', stats.totalTrades > 0 ? Math.round(stats.disciplineRate * 100) + '%' : '--%', '');
        updateStatCard('stat-avg-win', stats.wins > 0 ? formatCurrency(stats.avgWin) : '$0', '', true);
        updateStatCard('stat-avg-loss', stats.losses > 0 ? formatCurrency(stats.avgLoss) : '$0', '', false);
        updateStatCard('stat-max-win', formatCurrency(stats.maxWin), '', true);
        updateStatCard('stat-max-loss', formatCurrency(stats.maxLoss), '', false);

        // 渲染圖表
        renderPnlChart(stats.pnlByDate);
        renderDirectionChart(stats.byDirection);
        renderEmotionHeatmap(stats.byEmotion);
        renderTagAnalysis(stats.byTag);

        // 顯示/隱藏空狀態
        const emptyDash = $('empty-dashboard');
        if (emptyDash) emptyDash.style.display = trades.length < 3 ? '' : 'none';
    }

    function updateStatCard(id, value, suffix, isPositive) {
        const card = $(id);
        if (!card) return;
        const valEl = card.querySelector('.stat-value');
        if (valEl) valEl.textContent = value + (suffix || '');

        card.classList.remove('positive', 'negative');
        if (isPositive === true) card.classList.add('positive');
        else if (isPositive === false) card.classList.add('negative');
    }

    function formatCurrency(amount) {
        if (amount === undefined || amount === null) return '$0';
        const abs = Math.abs(Math.round(amount));
        return (amount >= 0 ? '+$' : '-$') + abs.toLocaleString();
    }

    function renderPnlChart(pnlByDate) {
        const canvas = $('chart-pnl');
        if (!canvas) return;

        if (pnlChart) pnlChart.destroy();

        if (!pnlByDate || pnlByDate.length === 0) {
            canvas.parentElement.innerHTML = '<div class="empty-state"><span class="empty-icon">📈</span><p>尚無數據</p></div>';
            return;
        }

        const ctx = canvas.getContext('2d');
        pnlChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: pnlByDate.map(d => d.date),
                datasets: [{
                    label: '累計損益',
                    data: pnlByDate.map(d => d.cumPnl),
                    borderColor: pnlByDate[pnlByDate.length - 1].cumPnl >= 0 ? '#10b981' : '#ef4444',
                    backgroundColor: pnlByDate[pnlByDate.length - 1].cumPnl >= 0 ?
                        'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return '累計: $' + context.parsed.y.toLocaleString();
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', font: { size: 11 } },
                        grid: { color: 'rgba(124, 58, 237, 0.05)' }
                    },
                    y: {
                        ticks: {
                            color: '#64748b',
                            callback: v => '$' + v.toLocaleString()
                        },
                        grid: { color: 'rgba(124, 58, 237, 0.08)' }
                    }
                }
            }
        });
    }

    function renderDirectionChart(byDirection) {
        const canvas = $('chart-direction');
        if (!canvas) return;

        if (dirChart) dirChart.destroy();

        const longData = byDirection.long || { wins: 0, losses: 0 };
        const shortData = byDirection.short || { wins: 0, losses: 0 };

        const ctx = canvas.getContext('2d');
        dirChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['做多 📈', '做空 📉'],
                datasets: [
                    {
                        label: '勝',
                        data: [longData.wins, shortData.wins],
                        backgroundColor: 'rgba(16, 185, 129, 0.7)',
                        borderRadius: 6,
                    },
                    {
                        label: '敗',
                        data: [longData.losses, shortData.losses],
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderRadius: 6,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#94a3b8', font: { size: 12 } }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                    y: {
                        ticks: { color: '#64748b', stepSize: 1 },
                        grid: { color: 'rgba(124, 58, 237, 0.05)' }
                    }
                }
            }
        });
    }

    function renderEmotionHeatmap(byEmotion) {
        const container = $('emotion-heatmap');
        if (!container) return;

        const emotionConfig = {
            calm: { emoji: '😌', label: '冷靜/有計畫', color: 'var(--accent-green)' },
            fomo: { emoji: '😰', label: '怕錯過 (FOMO)', color: 'var(--accent-yellow)' },
            revenge: { emoji: '😤', label: '急躁/想回本', color: 'var(--accent-red)' },
            hesitant: { emoji: '🤔', label: '猶豫不決', color: 'var(--text-dim)' },
            overconfident: { emoji: '🔥', label: '興奮/過度自信', color: 'var(--accent-purple)' },
        };

        let html = '';
        for (const [key, cfg] of Object.entries(emotionConfig)) {
            const data = byEmotion[key] || { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 };
            if (data.trades === 0) continue;
            const wr = Math.round(data.winRate * 100);
            const barWidth = Math.max(5, wr);
            const barColor = wr >= 50 ? 'var(--accent-green)' : wr >= 30 ? 'var(--accent-yellow)' : 'var(--accent-red)';

            html += '<div class="emotion-stat-row">' +
                '<div class="emotion-stat-label">' +
                '<span class="emotion-stat-emoji">' + cfg.emoji + '</span>' +
                '<span>' + cfg.label + '</span>' +
                '</div>' +
                '<div class="emotion-stat-data">' +
                '<div class="emotion-bar-container">' +
                '<div class="emotion-bar" style="width:' + barWidth + '%;background:' + barColor + '"></div>' +
                '</div>' +
                '<span class="emotion-stat-wr" style="color:' + barColor + '">' + wr + '% 勝率</span>' +
                '<span class="emotion-stat-count">' + data.trades + ' 筆 (' + formatCurrency(data.totalPnl) + ')</span>' +
                '</div>' +
                '</div>';
        }

        container.innerHTML = html || '<div class="empty-state"><p>尚無情緒數據</p></div>';
    }

    function renderTagAnalysis(byTag) {
        const container = $('tag-analysis');
        if (!container) return;

        const entries = Object.entries(byTag || {})
            .filter(([, d]) => d.trades > 0)
            .sort((a, b) => b[1].trades - a[1].trades);

        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>尚無標籤數據</p></div>';
            return;
        }

        let html = '';
        entries.forEach(([tag, data]) => {
            const wr = Math.round(data.winRate * 100);
            const barWidth = Math.max(5, wr);
            const barColor = wr >= 50 ? 'var(--accent-green)' : wr >= 30 ? 'var(--accent-yellow)' : 'var(--accent-red)';

            html += '<div class="emotion-stat-row">' +
                '<div class="emotion-stat-label">' +
                '<span>' + tag + '</span>' +
                '</div>' +
                '<div class="emotion-stat-data">' +
                '<div class="emotion-bar-container">' +
                '<div class="emotion-bar" style="width:' + barWidth + '%;background:' + barColor + '"></div>' +
                '</div>' +
                '<span class="emotion-stat-wr" style="color:' + barColor + '">' + wr + '% 勝率</span>' +
                '<span class="emotion-stat-count">' + data.trades + ' 筆 (' + formatCurrency(data.totalPnl) + ')</span>' +
                '</div>' +
                '</div>';
        });

        container.innerHTML = html;
    }

})();
