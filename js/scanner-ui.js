/**
 * 🧠 Scanner UI — Multi-Factor Stock Decision Engine UI
 * Handles DOM interactions, Chart.js rendering, and event handling.
 * Requires: scanner-engine.js, Chart.js
 */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const fmtNum = (v, d = 1) => v != null ? v.toFixed(d) : '-';
    const fmtPrice = v => v != null ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

    let radarChart = null;
    let scoreChart = null;
    let priceChart = null;
    let currentWeights = { trend: 0.30, momentum: 0.20, flow: 0.20, fundamental: 0.20, sentiment: 0.10 };
    let scanResults = [];

    // ==================== Tab Switching ====================
    document.querySelectorAll('.scanner-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.scanner-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.dataset.mode;
            document.querySelectorAll('.scanner-panel').forEach(p => p.classList.remove('active'));
            $(`panel-${mode}`).classList.add('active');
        });
    });

    // ==================== Weight Sliders ====================
    function initWeightSliders() {
        const sliders = document.querySelectorAll('.weight-slider');
        sliders.forEach(slider => {
            slider.addEventListener('input', () => {
                const factor = slider.dataset.factor;
                const value = parseInt(slider.value);
                currentWeights[factor] = value / 100;
                slider.parentElement.querySelector('.weight-value').textContent = `${value}%`;
            });
        });
    }
    initWeightSliders();

    // ==================== Individual Analysis ====================
    $('btn-analyze').addEventListener('click', runAnalysis);

    // Allow Enter key to trigger analysis
    $('analysis-symbol').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runAnalysis();
    });

    async function runAnalysis() {
        const symbol = $('analysis-symbol').value.trim();
        if (!symbol) { alert('請輸入股票代號'); return; }

        const btn = $('btn-analyze');
        btn.disabled = true;
        btn.textContent = '⏳ 分析中...';
        $('analysis-loading').classList.add('active');
        $('analysis-results').classList.remove('active');

        try {
            const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}/analysis?months=12`);
            const data = await res.json();

            if (data.error) { alert(`❌ ${data.error}`); return; }
            if (!data.days || data.days.length < 30) { alert('歷史資料不足，需至少 30 天數據'); return; }

            const result = ScannerEngine.scoreStock(data.days, currentWeights);
            const advice = ScannerEngine.generateAdvice(result);

            displayAnalysisResult(data, result, advice);
        } catch (err) {
            alert('無法連線到伺服器，請確認 server.js 正在運行');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔍 開始分析';
            $('analysis-loading').classList.remove('active');
        }
    }

    function displayAnalysisResult(stockData, result, advice) {
        $('analysis-results').classList.add('active');

        const { scores, totalScore, indicators, chartData } = result;
        const { classification, entrySignals, exitWarnings, positionAdvice, keyPrices } = advice;
        const last = stockData.currentPrice || indicators.ma5;
        const change = stockData.currentPrice - stockData.previousClose;
        const changePct = stockData.previousClose > 0 ? (change / stockData.previousClose * 100) : 0;
        const changeColor = change >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const changeSign = change >= 0 ? '+' : '';

        // Stock info header
        $('result-stock-info').innerHTML = `
            <div class="analysis-stock-info">
                <div class="stock-name">${stockData.shortName} <span style="color:var(--text-dim);font-size:0.9rem;">(${stockData.symbol})</span></div>
                <div class="stock-price" style="color:${changeColor}">${fmtPrice(last)}</div>
                <div class="stock-change" style="color:${changeColor}">${changeSign}${fmtNum(change, 2)}  (${changeSign}${fmtNum(changePct, 2)}%)</div>
            </div>
        `;

        // Score ring
        renderScoreRing(totalScore);

        // Classification badge
        $('result-classification').innerHTML = `
            <div class="classification-badge ${classification.badgeClass}">${classification.label}</div>
            <div style="color:var(--text-secondary);font-size:0.95rem;margin-top:8px;">${classification.advice}</div>
        `;

        // Factor cards
        const factorMeta = [
            { key: 'trend', name: '趨勢 Trend', icon: '📈', color: '#10b981' },
            { key: 'momentum', name: '動能 Momentum', icon: '⚡', color: '#06b6d4' },
            { key: 'flow', name: '籌碼 Flow', icon: '🏦', color: '#a855f7' },
            { key: 'fundamental', name: '基本面 Fund.', icon: '📊', color: '#f59e0b' },
            { key: 'sentiment', name: '情緒 Sent.', icon: '🎭', color: '#ec4899' },
        ];

        $('result-factors').innerHTML = factorMeta.map(f => {
            const sc = scores[f.key];
            const scoreClass = sc >= 70 ? 'score-high' : sc >= 40 ? 'score-mid' : 'score-low';
            return `
                <div class="factor-card">
                    <div class="factor-icon">${f.icon}</div>
                    <div class="factor-name">${f.name}</div>
                    <div class="factor-score ${scoreClass}">${sc}</div>
                    <div class="factor-bar"><div class="factor-bar-fill" style="width:${sc}%;background:${f.color};"></div></div>
                </div>
            `;
        }).join('');

        // Radar chart
        renderRadarChart(scores, factorMeta);

        // Key indicators
        const indItems = [
            { label: 'RSI(14)', value: fmtNum(indicators.rsi), color: indicators.rsi > 70 ? 'text-red' : indicators.rsi < 30 ? 'text-green' : '' },
            { label: 'K / D', value: `${fmtNum(indicators.k)} / ${fmtNum(indicators.d)}`, color: '' },
            { label: 'MACD 柱', value: fmtNum(indicators.macdHist, 2), color: indicators.macdHist > 0 ? 'text-green' : 'text-red' },
            { label: '量比', value: fmtNum(indicators.volRatio), color: indicators.volRatio > 1.5 ? 'text-cyan' : '' },
            { label: 'ATR', value: `${fmtNum(indicators.atr, 2)} (${fmtNum(indicators.atrPct)}%)`, color: '' },
            { label: 'BB Width', value: fmtNum(indicators.bbWidth, 4), color: '' },
            { label: 'MA5', value: fmtPrice(indicators.ma5), color: last > (indicators.ma5 || 0) ? 'text-green' : 'text-red' },
            { label: 'MA20', value: fmtPrice(indicators.ma20), color: last > (indicators.ma20 || 0) ? 'text-green' : 'text-red' },
            { label: 'MA60', value: fmtPrice(indicators.ma60), color: last > (indicators.ma60 || 0) ? 'text-green' : 'text-red' },
            { label: '5日漲幅', value: `${indicators.return5d > 0 ? '+' : ''}${fmtNum(indicators.return5d)}%`, color: indicators.return5d > 0 ? 'text-green' : 'text-red' },
            { label: '20日漲幅', value: `${indicators.return20d > 0 ? '+' : ''}${fmtNum(indicators.return20d)}%`, color: indicators.return20d > 0 ? 'text-green' : 'text-red' },
        ];

        $('result-indicators').innerHTML = indItems.map(i =>
            `<div class="indicator-item"><div class="ind-label">${i.label}</div><div class="ind-value ${i.color}">${i.value}</div></div>`
        ).join('');

        // Key prices
        let priceHtml = '';
        priceHtml += `<div class="key-price-item"><span class="label">🔴 停損 (-5%)</span><span class="value text-red">${fmtPrice(keyPrices.stopLoss5pct)}</span></div>`;
        if (keyPrices.ma20Support) priceHtml += `<div class="key-price-item"><span class="label">📉 MA20 支撐</span><span class="value text-yellow">${fmtPrice(keyPrices.ma20Support)}</span></div>`;
        priceHtml += `<div class="key-price-item"><span class="label">🟢 停利 (+10%)</span><span class="value text-green">${fmtPrice(keyPrices.takeProfit10pct)}</span></div>`;
        priceHtml += `<div class="key-price-item"><span class="label">🟢 停利 (+15%)</span><span class="value text-green">${fmtPrice(keyPrices.takeProfit15pct)}</span></div>`;

        if (keyPrices.supports.length > 0) {
            priceHtml += keyPrices.supports.map((s, i) =>
                `<div class="key-price-item"><span class="label">🛡️ 支撐${i + 1}</span><span class="value text-cyan">${fmtPrice(s.price)}</span></div>`
            ).join('');
        }
        if (keyPrices.resistances.length > 0) {
            priceHtml += keyPrices.resistances.map((r, i) =>
                `<div class="key-price-item"><span class="label">🧱 壓力${i + 1}</span><span class="value text-purple">${fmtPrice(r.price)}</span></div>`
            ).join('');
        }
        $('result-keyprices').innerHTML = priceHtml;

        // Advice section
        let adviceHtml = `<div class="advice-title">📋 交易建議</div><ul class="advice-list">`;
        adviceHtml += `<li>📊 ${classification.advice}</li>`;
        adviceHtml += `<li>💼 倉位建議：${positionAdvice}</li>`;
        entrySignals.forEach(s => adviceHtml += `<li>${s}</li>`);
        exitWarnings.forEach(w => adviceHtml += `<li>${w}</li>`);
        adviceHtml += `</ul>`;
        $('result-advice').innerHTML = adviceHtml;

        // Price + MA chart
        renderPriceChart(chartData);

        // Scroll to results
        setTimeout(() => {
            $('analysis-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ==================== Chart Renderers ====================

    function getScoreColor(score) {
        if (score >= 70) return '#10b981';
        if (score >= 50) return '#f59e0b';
        return '#ef4444';
    }

    function renderScoreRing(score) {
        const ctx = $('score-ring-canvas').getContext('2d');
        if (scoreChart) scoreChart.destroy();

        const color = getScoreColor(score);
        $('score-ring-value').textContent = score;
        $('score-ring-value').style.color = color;

        scoreChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [score, 100 - score],
                    backgroundColor: [color, 'rgba(255,255,255,0.05)'],
                    borderWidth: 0,
                }]
            },
            options: {
                cutout: '80%',
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                animation: { animateRotate: true, duration: 1000 }
            }
        });
    }

    function renderRadarChart(scores, meta) {
        const ctx = $('radar-canvas').getContext('2d');
        if (radarChart) radarChart.destroy();

        radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: meta.map(m => m.name),
                datasets: [{
                    label: '因子分數',
                    data: meta.map(m => scores[m.key]),
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    pointBackgroundColor: meta.map(m => m.color),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 1,
                    pointRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 20, color: '#64748b', backdropColor: 'transparent', font: { size: 10 } },
                        grid: { color: 'rgba(124,58,237,0.1)' },
                        angleLines: { color: 'rgba(124,58,237,0.1)' },
                        pointLabels: { color: '#94a3b8', font: { size: 11, family: "'Noto Sans TC', sans-serif" } }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    function renderPriceChart(chartData) {
        const ctx = $('price-chart-canvas').getContext('2d');
        if (priceChart) priceChart.destroy();

        const datasets = [
            {
                label: '收盤價',
                data: chartData.closes,
                borderColor: '#f1f5f9',
                backgroundColor: 'rgba(241,245,249,0.05)',
                fill: true,
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 2,
                yAxisID: 'y',
                order: 1,
            },
            {
                label: 'MA5',
                data: chartData.ma5,
                borderColor: '#f59e0b',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.2,
                borderDash: [2, 2],
                yAxisID: 'y',
                order: 2,
            },
            {
                label: 'MA20',
                data: chartData.ma20,
                borderColor: '#06b6d4',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.5,
                yAxisID: 'y',
                order: 3,
            },
            {
                label: 'MA60',
                data: chartData.ma60,
                borderColor: '#a855f7',
                backgroundColor: 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 1.5,
                yAxisID: 'y',
                order: 4,
            },
            {
                label: '成交量',
                data: chartData.volumes,
                borderColor: 'rgba(99,102,241,0.4)',
                backgroundColor: chartData.closes.map((c, i) =>
                    i > 0 && c >= chartData.closes[i - 1]
                        ? 'rgba(16,185,129,0.25)'
                        : 'rgba(239,68,68,0.25)'
                ),
                type: 'bar',
                yAxisID: 'yVol',
                order: 5,
            }
        ];

        priceChart = new Chart(ctx, {
            type: 'line',
            data: { labels: chartData.dates, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'line', font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                if (ctx.dataset.yAxisID === 'yVol') return `成交量: ${(ctx.parsed.y / 1000).toFixed(0)}K`;
                                return `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : '-'}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } }, grid: { color: 'rgba(124,58,237,0.06)' } },
                    y: { type: 'linear', display: true, position: 'left', ticks: { color: '#64748b' }, grid: { color: 'rgba(124,58,237,0.06)' } },
                    yVol: {
                        type: 'linear', display: false, position: 'right',
                        max: Math.max(...chartData.volumes.filter(v => v > 0)) * 4,
                        grid: { drawOnChartArea: false }
                    },
                },
            },
        });
    }

    // ==================== Market Scanner ====================
    $('btn-scan').addEventListener('click', runScanner);

    async function runScanner() {
        const customSymbols = $('scan-symbols').value.trim();
        const btn = $('btn-scan');
        btn.disabled = true;
        btn.textContent = '⏳ 掃描中...';
        $('scan-loading').classList.add('active');
        $('scan-results').classList.remove('active');

        try {
            let url = '/api/scanner/top';
            if (customSymbols) {
                url += `?symbols=${encodeURIComponent(customSymbols)}`;
            }

            const res = await fetch(url);
            const data = await res.json();

            if (data.error) { alert(`❌ ${data.error}`); return; }

            // Score each stock
            scanResults = [];
            for (const stock of (data.stocks || [])) {
                if (!stock.days || stock.days.length < 30) continue;
                const result = ScannerEngine.scoreStock(stock.days, currentWeights);
                if (!result) continue;
                const classification = ScannerEngine.classifyStock(result);
                scanResults.push({
                    symbol: stock.originalSymbol || stock.symbol,
                    shortName: stock.shortName,
                    currentPrice: stock.currentPrice,
                    previousClose: stock.previousClose,
                    ...result,
                    classification,
                    days: stock.days,
                });
            }

            // Sort by totalScore descending
            scanResults.sort((a, b) => b.totalScore - a.totalScore);

            displayScanResults(scanResults);

        } catch (err) {
            alert('掃描失敗，請確認伺服器正在運行');
            console.error(err);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔍 開始掃描';
            $('scan-loading').classList.remove('active');
        }
    }

    function displayScanResults(results, filter = 'all') {
        $('scan-results').classList.add('active');

        const filtered = filter === 'all' ? results : results.filter(r => r.classification.category === filter);
        $('scan-count').textContent = `找到 ${filtered.length} 檔`;

        let html = `
            <thead><tr>
                <th data-sort="rank"># <span class="sort-arrow">▼</span></th>
                <th data-sort="symbol">代號 <span class="sort-arrow">▼</span></th>
                <th data-sort="currentPrice">股價 <span class="sort-arrow">▼</span></th>
                <th data-sort="changePct">漲跌% <span class="sort-arrow">▼</span></th>
                <th data-sort="totalScore" class="sorted">總分 <span class="sort-arrow">▼</span></th>
                <th data-sort="trend">趨勢 <span class="sort-arrow">▼</span></th>
                <th data-sort="momentum">動能 <span class="sort-arrow">▼</span></th>
                <th data-sort="flow">籌碼 <span class="sort-arrow">▼</span></th>
                <th data-sort="category">分類 <span class="sort-arrow">▼</span></th>
            </tr></thead><tbody>
        `;

        filtered.forEach((s, i) => {
            const change = s.currentPrice - s.previousClose;
            const changePct = s.previousClose > 0 ? (change / s.previousClose * 100) : 0;
            const changeCls = changePct >= 0 ? 'text-green' : 'text-red';
            const scoreColor = getScoreColor(s.totalScore);
            const trendColor = getScoreColor(s.scores.trend);
            const momColor = getScoreColor(s.scores.momentum);
            const flowColor = getScoreColor(s.scores.flow);

            html += `<tr>
                <td>${i + 1}</td>
                <td class="scan-symbol-click" data-symbol="${s.symbol}">${s.symbol}</td>
                <td>${fmtPrice(s.currentPrice)}</td>
                <td class="${changeCls}">${changePct >= 0 ? '+' : ''}${fmtNum(changePct, 2)}%</td>
                <td class="score-cell" style="color:${scoreColor}">${s.totalScore}</td>
                <td><div class="mini-score-bar"><div class="bar-bg"><div class="bar-fill" style="width:${s.scores.trend}%;background:${trendColor};"></div></div><span class="bar-value" style="color:${trendColor}">${s.scores.trend}</span></div></td>
                <td><div class="mini-score-bar"><div class="bar-bg"><div class="bar-fill" style="width:${s.scores.momentum}%;background:${momColor};"></div></div><span class="bar-value" style="color:${momColor}">${s.scores.momentum}</span></div></td>
                <td><div class="mini-score-bar"><div class="bar-bg"><div class="bar-fill" style="width:${s.scores.flow}%;background:${flowColor};"></div></div><span class="bar-value" style="color:${flowColor}">${s.scores.flow}</span></div></td>
                <td><span class="classification-badge ${s.classification.badgeClass}" style="font-size:0.8rem;padding:4px 10px;">${s.classification.label}</span></td>
            </tr>`;
        });

        html += '</tbody>';
        $('scan-table').innerHTML = html;

        // Click symbol to analyze
        document.querySelectorAll('.scan-symbol-click').forEach(td => {
            td.addEventListener('click', () => {
                $('analysis-symbol').value = td.dataset.symbol;
                // Switch to analysis tab
                document.querySelectorAll('.scanner-tab').forEach(t => t.classList.remove('active'));
                document.querySelector('.scanner-tab[data-mode="analysis"]').classList.add('active');
                document.querySelectorAll('.scanner-panel').forEach(p => p.classList.remove('active'));
                $('panel-analysis').classList.add('active');
                runAnalysis();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        // Sort headers
        document.querySelectorAll('#scan-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const sortKey = th.dataset.sort;
                document.querySelectorAll('#scan-table th').forEach(h => h.classList.remove('sorted'));
                th.classList.add('sorted');

                const sorted = [...scanResults];
                if (sortKey === 'rank') sorted.sort((a, b) => b.totalScore - a.totalScore);
                else if (sortKey === 'symbol') sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
                else if (sortKey === 'currentPrice') sorted.sort((a, b) => b.currentPrice - a.currentPrice);
                else if (sortKey === 'changePct') {
                    sorted.sort((a, b) => {
                        const ca = a.previousClose > 0 ? (a.currentPrice - a.previousClose) / a.previousClose : 0;
                        const cb = b.previousClose > 0 ? (b.currentPrice - b.previousClose) / b.previousClose : 0;
                        return cb - ca;
                    });
                }
                else if (sortKey === 'totalScore') sorted.sort((a, b) => b.totalScore - a.totalScore);
                else if (sortKey === 'trend') sorted.sort((a, b) => b.scores.trend - a.scores.trend);
                else if (sortKey === 'momentum') sorted.sort((a, b) => b.scores.momentum - a.scores.momentum);
                else if (sortKey === 'flow') sorted.sort((a, b) => b.scores.flow - a.scores.flow);
                else if (sortKey === 'category') sorted.sort((a, b) => a.classification.label.localeCompare(b.classification.label));

                displayScanResults(sorted, getCurrentFilter());
            });
        });
    }

    function getCurrentFilter() {
        const activeTag = document.querySelector('.category-tag.active');
        return activeTag ? activeTag.dataset.category : 'all';
    }

    // Category filter tags
    document.querySelectorAll('.category-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.querySelectorAll('.category-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            const category = tag.dataset.category;
            displayScanResults(scanResults, category);
        });
    });
    // ==================== Professional Research ====================
    let equityChart = null;
    let lastResearchData = null;

    $('btn-run-research').addEventListener('click', runResearch);
    $('btn-load-results').addEventListener('click', loadResearchResults);
    $('btn-apply-weights').addEventListener('click', applyBestWeights);

    async function runResearch() {
        const btn = $('btn-run-research');
        const symbols = $('research-symbols').value.trim();
        const years = $('research-years').value;
        const token = $('research-token').value.trim();

        btn.disabled = true;
        btn.textContent = '⏳ 執行中...';
        $('research-loading').classList.add('active');
        $('research-results').classList.remove('active');
        $('research-status').textContent = '正在啟動 Python 研究引擎...';

        let pollCount = 0;

        try {
            const res = await fetch('/api/quant/run-research', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbols, years: parseInt(years), token })
            });
            const data = await res.json();

            if (data.error) {
                alert(`❌ ${data.error}`);
                btn.disabled = false;
                btn.textContent = '🚀 執行 Python 研究';
                $('research-loading').classList.remove('active');
                return;
            }

            // Keep polling — do NOT hide the loading spinner until done
            const pollInterval = setInterval(async () => {
                pollCount++;

                try {
                    const statusRes = await fetch('/api/quant/status');
                    const statusData = await statusRes.json();

                    // Update loading UI with real-time log
                    const loadingText = $('research-loading').querySelector('.loading-text');
                    const loadingSub = $('research-loading').querySelector('.loading-sub');
                    const log = statusData.log || [];
                    const lastLog = log.length > 0 ? log[log.length - 1] : '';

                    if (loadingText) loadingText.textContent = `正在執行 Python 量化研究引擎... (已等待 ${pollCount * 5} 秒)`;
                    if (loadingSub) loadingSub.textContent = lastLog || `資料抓取 → 因子計算 → 回測掃描中，請耐心等候`;
                    $('research-status').textContent = `⏳ 執行中... ${lastLog}`;

                    if (!statusData.running) {
                        clearInterval(pollInterval);
                        btn.disabled = false;
                        btn.textContent = '🚀 執行 Python 研究';
                        $('research-loading').classList.remove('active');

                        if (statusData.error) {
                            $('research-status').textContent = `❌ 執行失敗: ${statusData.error}`;
                            alert(`Python 研究引擎執行失敗:\n${statusData.error}\n\n請檢查終端機的詳細日誌。`);
                        } else {
                            $('research-status').textContent = '✅ 研究完成！正在載入結果...';
                            await loadResearchResults();
                        }
                    }
                } catch (e) {
                    // Server might be busy, keep polling
                }
            }, 5000);

        } catch (err) {
            alert('無法連線到伺服器');
            console.error(err);
            btn.disabled = false;
            btn.textContent = '🚀 執行 Python 研究';
            $('research-loading').classList.remove('active');
        }
    }

    async function loadResearchResults() {
        $('research-status').textContent = '正在讀取...';
        try {
            const res = await fetch('/api/quant/results');
            const data = await res.json();

            if (!data.exists) {
                $('research-status').textContent = `⚠️ ${data.message}`;
                return;
            }

            lastResearchData = data;
            displayResearchResults(data);
            $('research-status').textContent = `✅ 資料載入完成 (${data.generated_at || ''})`;

        } catch (err) {
            $('research-status').textContent = '❌ 讀取失敗';
            console.error(err);
        }
    }

    function displayResearchResults(data) {
        $('research-results').classList.add('active');

        const best = data.backtest?.best || {};
        const hasBest = best && Object.keys(best).length > 0;
        // Use recommended_weights as fallback when best.weights is empty
        const weights = (hasBest && best.weights) ? best.weights : (data.recommended_weights || {});

        // Stats cards — null-safe
        const sharpe = hasBest ? best.sharpe_ratio : null;
        const sharpeColor = sharpe != null ? (sharpe >= 1 ? '#10b981' : sharpe >= 0.5 ? '#f59e0b' : '#ef4444') : '#64748b';
        $('stat-sharpe').textContent = sharpe != null ? sharpe.toFixed(4) : '無回測資料';
        $('stat-sharpe').style.color = sharpeColor;
        if (!hasBest) $('stat-sharpe').style.fontSize = '1rem';

        const ret = hasBest ? best.total_return : null;
        $('stat-return').textContent = ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%` : '-';
        $('stat-return').style.color = ret != null ? (ret >= 0 ? '#10b981' : '#ef4444') : '#64748b';

        const mdd = hasBest ? best.max_drawdown : null;
        $('stat-mdd').textContent = mdd != null ? `${mdd.toFixed(2)}%` : '-';
        $('stat-mdd').style.color = '#ef4444';

        $('stat-count').textContent = data.symbols_count || '-';
        $('stat-count').style.color = '#06b6d4';

        // Best weights grid — use recommended_weights as fallback
        const wMeta = [
            { key: 'trend', name: '📈 趨勢', color: '#10b981' },
            { key: 'momentum', name: '⚡ 動能', color: '#06b6d4' },
            { key: 'flow', name: '🏦 籌碼', color: '#a855f7' },
            { key: 'fundamental', name: '📊 基本面', color: '#f59e0b' },
            { key: 'sentiment', name: '🎭 情緒', color: '#ec4899' },
        ];
        const weightSource = hasBest ? '回測最佳' : '預設推薦';
        $('best-weights-grid').innerHTML = wMeta.map(w => {
            const val = weights[w.key];
            const pct = val != null ? Math.round(val * 100) : 0;
            return `<div class="indicator-item">
                <div class="ind-label">${w.name}</div>
                <div class="ind-value" style="color:${w.color};font-size:1.4rem;">${pct}%</div>
            </div>`;
        }).join('') + `<div class="indicator-item"><div class="ind-label" style="font-size:0.8rem;">來源</div><div class="ind-value" style="color:#64748b;font-size:0.9rem;">${weightSource}</div></div>`;

        // Period info
        const period = data.research_period || {};
        $('research-period-info').textContent = `研究期間: ${period.start || '?'} ~ ${period.end || '?'} | 股票池: ${(data.symbols || []).join(', ')}`;

        // Equity Curve
        const eqData = data.backtest?.equity_curve || [];
        if (eqData.length > 0) {
            renderEquityCurve(eqData);
        }

        // Factor IC
        const ic = data.factor_ic || {};
        const icMeta = [
            { key: 'trend', name: '📈 趨勢 IC' },
            { key: 'momentum', name: '⚡ 動能 IC' },
            { key: 'flow', name: '🏦 籌碼 IC' },
        ];
        $('factor-ic-grid').innerHTML = icMeta.map(f => {
            const icData = ic[f.key] || {};
            const ic5 = icData.ic_5d || 0;
            const ic20 = icData.ic_20d || 0;
            const ic5Color = Math.abs(ic5) > 0.03 ? '#10b981' : '#64748b';
            const ic20Color = Math.abs(ic20) > 0.03 ? '#10b981' : '#64748b';
            return `<div class="indicator-item">
                <div class="ind-label">${f.name}</div>
                <div class="ind-value" style="color:${ic5Color}">${ic5.toFixed(4)}</div>
                <div class="ind-label" style="margin-top:4px;">20日 IC</div>
                <div class="ind-value" style="color:${ic20Color};font-size:0.95rem;">${ic20.toFixed(4)}</div>
            </div>`;
        }).join('');

        // No backtest warning
        if (!hasBest) {
            $('factor-ic-grid').innerHTML += `
                <div class="indicator-item" style="grid-column:1/-1;background:rgba(245,158,11,0.08);border-radius:8px;padding:12px;margin-top:8px;">
                    <div class="ind-label" style="color:#f59e0b;">⚠️ 回測引擎未產出結果</div>
                    <div class="ind-value" style="color:var(--text-dim);font-size:0.85rem;line-height:1.5;">可能原因：VectorBT 未安裝且簡易回測中所有權重組合失敗。請在終端機檢查 Python 輸出日誌以取得詳細錯誤。</div>
                </div>`;
        }

        // Top 10 combos
        const allResults = data.backtest?.all_results || [];
        if (allResults.length > 0) {
            let tableHtml = `<thead><tr>
                <th style="text-align:left">#</th>
                <th>趨勢</th><th>動能</th><th>籌碼</th>
                <th>Sharpe</th><th>報酬率</th><th>MDD</th>
            </tr></thead><tbody>`;
            allResults.forEach((r, i) => {
                const w = r.weights || {};
                const sr = r.sharpe_ratio || 0;
                const tr = r.total_return || 0;
                const md = r.max_drawdown || 0;
                const sColor = sr >= 1 ? 'text-green' : sr >= 0.5 ? 'text-yellow' : 'text-red';
                tableHtml += `<tr>
                    <td style="text-align:left">${i + 1}</td>
                    <td>${Math.round((w.trend || 0) * 100)}%</td>
                    <td>${Math.round((w.momentum || 0) * 100)}%</td>
                    <td>${Math.round((w.flow || 0) * 100)}%</td>
                    <td class="${sColor}" style="font-weight:700;">${sr.toFixed(4)}</td>
                    <td class="${tr >= 0 ? 'text-green' : 'text-red'}">${tr >= 0 ? '+' : ''}${tr.toFixed(2)}%</td>
                    <td class="text-red">${md.toFixed(2)}%</td>
                </tr>`;
            });
            tableHtml += '</tbody>';
            $('weight-combos-table').innerHTML = tableHtml;
        } else {
            $('weight-combos-table').innerHTML = '<tbody><tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px;">回測引擎未產出排行資料</td></tr></tbody>';
        }

        setTimeout(() => {
            $('research-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    function renderEquityCurve(eqData) {
        const ctx = $('equity-chart-canvas').getContext('2d');
        if (equityChart) equityChart.destroy();

        equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: eqData.map(d => d.date),
                datasets: [{
                    label: '投資組合淨值',
                    data: eqData.map(d => d.value),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#94a3b8' } },
                    tooltip: {
                        callbacks: {
                            label: ctx => `淨值: $${ctx.parsed.y?.toLocaleString()}`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#64748b', maxTicksLimit: 10, font: { size: 10 } }, grid: { color: 'rgba(124,58,237,0.06)' } },
                    y: { ticks: { color: '#64748b', callback: v => `$${(v / 1000000).toFixed(1)}M` }, grid: { color: 'rgba(124,58,237,0.06)' } },
                }
            }
        });
    }

    function applyBestWeights() {
        if (!lastResearchData) { alert('請先載入研究結果'); return; }

        const weights = lastResearchData.recommended_weights || {};
        const factors = ['trend', 'momentum', 'flow', 'fundamental', 'sentiment'];

        factors.forEach(f => {
            const val = Math.round((weights[f] || 0) * 100);
            currentWeights[f] = weights[f] || 0;

            // Update slider
            const slider = document.querySelector(`.weight-slider[data-factor="${f}"]`);
            if (slider) {
                slider.value = val;
                const label = slider.parentElement.querySelector('.weight-value');
                if (label) label.textContent = `${val}%`;
            }
        });

        // Switch to settings tab to show the updated sliders
        document.querySelectorAll('.scanner-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.scanner-tab[data-mode="settings"]').classList.add('active');
        document.querySelectorAll('.scanner-panel').forEach(p => p.classList.remove('active'));
        $('panel-settings').classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        alert('✅ 最佳權重已套用到策略設定！');
    }

})();
