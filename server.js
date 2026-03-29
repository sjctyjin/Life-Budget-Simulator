/**
 * Life Budget Simulator — Node.js Server
 * Serves static files + Yahoo Finance stock API proxy
 */

const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 8080;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Yahoo Finance proxy endpoint
app.get('/api/stock/:symbol', async (req, res) => {
    let symbol = req.params.symbol.toUpperCase().trim();

    // Auto-detect Taiwan stock codes (e.g. 0050, 2330, 00878, 00679B)
    // and append .TW if no suffix provided
    const isTaiwanCode = /^\d{4,6}[A-Z]*$/.test(symbol);
    if (isTaiwanCode) {
        symbol = symbol + '.TW';
    }

    try {
        let data = await fetchStockData(symbol);

        // Fallback strategy for Taiwan codes
        if (!data) {
            // If it was a generic Taiwan auto-append that failed, try OTC (.TWO)
            if (isTaiwanCode) {
                const altSymbol = symbol.replace('.TW', '.TWO');
                data = await fetchStockData(altSymbol);
                if (data) symbol = altSymbol;
            }
            // If user didn't write suffix at all, and it's some other code, try .TW then .TWO
            else if (!symbol.includes('.')) {
                data = await fetchStockData(symbol + '.TW');
                if (data) {
                    symbol = symbol + '.TW';
                } else {
                    data = await fetchStockData(symbol + '.TWO');
                    if (data) symbol = symbol + '.TWO';
                }
            }
        }

        if (!data) {
            return res.status(404).json({ error: '找不到此股票代號，台股請輸入如 0050, 2330, 或 00679B', symbol });
        }

        res.json(data);
    } catch (err) {
        console.error(`Error fetching stock ${symbol}:`, err.message);
        res.status(500).json({ error: '無法取得股票資料', details: err.message });
    }
});

// Ghost Mode: Historical backtest data endpoint
app.get('/api/stock/:symbol/backtest', async (req, res) => {
    let symbol = req.params.symbol.toUpperCase().trim();
    const years = parseInt(req.query.years) || 12;

    // Auto-detect Taiwan stock codes
    const isTaiwanCode = /^\d{4,6}[A-Z]*$/.test(symbol);
    if (isTaiwanCode) symbol = symbol + '.TW';

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=${years}y&events=div,splits`;
        const data = await fetchJSON(url);

        if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) {
            // Fallback: try .TWO for OTC
            if (isTaiwanCode) {
                const altSymbol = symbol.replace('.TW', '.TWO');
                const altUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(altSymbol)}?interval=1mo&range=${years}y&events=div,splits`;
                const altData = await fetchJSON(altUrl);
                if (altData && altData.chart && altData.chart.result && altData.chart.result.length > 0) {
                    symbol = altSymbol;
                    return processBacktestData(res, altData, symbol);
                }
            }
            return res.status(404).json({ error: `找不到 ${symbol} 的歷史資料` });
        }

        processBacktestData(res, data, symbol);
    } catch (err) {
        console.error(`Error fetching backtest data for ${symbol}:`, err.message);
        res.status(500).json({ error: '無法取得歷史資料', details: err.message });
    }
});

function processBacktestData(res, data, symbol) {
    const result = data.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const events = result.events || {};
    
    // Process splits first
    const splitData = events.splits || {};
    let splits = Object.values(splitData).map(s => {
        const d = new Date(s.date * 1000);
        return {
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            ratio: s.numerator / s.denominator,
            numerator: s.numerator,
            denominator: s.denominator,
            timestamp: s.date
        };
    });

    // --- Inject Known Missing Splits (Yahoo Finance Bug for Taiwan ETFs) ---
    // Some ETFs have their historical prices adjusted by Yahoo (like 0050), 
    // while others don't (like 0052 causing massive price drops).
    const KNOWN_MISSING_SPLITS = {
        '0052.TW': [
            // 0052 split 1 to 7. Reference date 2025-11-26. NOT price adjusted by Yahoo, but IS dividend adjusted!
            { dateStr: '2025-11-26', numerator: 7, denominator: 1, adjustedPrices: false, adjustedDividends: true }
        ],
        '0050.TW': [
            // 0050 split 1 to 4. Reference date 2025-06-18. IS price adjusted, IS dividend adjusted.
            { dateStr: '2025-06-18', numerator: 4, denominator: 1, adjustedPrices: true, adjustedDividends: true }
        ]
    };

    if (KNOWN_MISSING_SPLITS[symbol]) {
        for (const ms of KNOWN_MISSING_SPLITS[symbol]) {
            const d = new Date(ms.dateStr);
            splits.push({
                date: ms.dateStr,
                yearMonth: ms.dateStr.substring(0, 7),
                ratio: ms.numerator / ms.denominator,
                numerator: ms.numerator,
                denominator: ms.denominator,
                adjustedPrices: ms.adjustedPrices,
                adjustedDividends: ms.adjustedDividends,
                timestamp: Math.floor(d.getTime() / 1000)
            });
        }
    }

    splits = splits.sort((a, b) => a.timestamp - b.timestamp);

    const dividends = events.dividends || {};

    const currency = meta.currency || 'TWD';
    const shortName = meta.shortName || symbol;
    const currentPrice = meta.regularMarketPrice || 0;

    // Build monthly price array
    // Yahoo returns split-adjusted historical prices. We must reverse this adjustment 
    // so the backtest engine uses the REAL ticker-tape historical prices for its buy calculations.
    const months = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        
        let multiplier = 1;
        for (const s of splits) {
            // Only apply the reverse multiplier if Yahoo actually adjusted the prices backwards.
            if (s.timestamp > timestamps[i] && s.adjustedPrices !== false) {
                multiplier *= s.ratio;
            }
        }
        const unadjustedClose = closes[i] * multiplier;

        months.push({
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            close: Math.round(unadjustedClose * 100) / 100, // True historical price
            adjustedClose: closes[i], // Original adjusted price from Yahoo
            timestamp: timestamps[i],
        });
    }

    // Build dividend array and unadjust the amounts 
    // Yahoo returns split-adjusted dividends, so we multiply by all future splits to get the actual historical cash payout
    const divList = Object.values(dividends).map(div => {
        const d = new Date(div.date * 1000);
        let multiplier = 1;
        for (const s of splits) {
            // Only apply the reverse multiplier if Yahoo actually adjusted the dividends backwards.
            // Some ETFs (like 0052) had unadjusted prices but adjusted dividends.
            if (s.timestamp > div.date && s.adjustedDividends !== false) {
                multiplier *= s.ratio;
            }
        }
        const unadjustedAmount = div.amount * multiplier;

        return {
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            amount: Math.round(unadjustedAmount * 10000) / 10000, // Now represents unadjusted (real) cash div
            adjustedAmount: div.amount, // Original from Yahoo
            timestamp: div.date,
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    res.json({
        symbol,
        shortName,
        currency,
        currentPrice,
        months,
        dividends: divList,
        splits: splits,
        dataYears: months.length > 0 ? Math.round((months.length / 12) * 10) / 10 : 0,
    });
}

async function fetchStockData(symbol) {
    // 1. Fetch 1 year of daily data to get accurate current price and trailing dividends
    const url1y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
    const data1y = await fetchJSON(url1y);

    if (!data1y || !data1y.chart || !data1y.chart.result || data1y.chart.result.length === 0) {
        return null;
    }

    const result = data1y.chart.result[0];
    const meta = result.meta;
    const dividends = result.events?.dividends; // map of timestamp -> { date, amount }

    const currentPrice = meta.regularMarketPrice || 0;
    const previousClose = meta.previousClose || meta.chartPreviousClose || currentPrice;
    const currency = meta.currency || 'USD';
    const exchangeName = meta.exchangeName || '';
    const shortName = meta.shortName || symbol;

    // 2. Fetch 20 years of monthly data for CAGR and long-term volatility
    const url20y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=20y`;
    let historicalCAGR = 0.08; // default 8%
    let historicalVolatility = 0.25; // default 25%
    let dataYears = 0;

    try {
        const data20y = await fetchJSON(url20y);
        if (data20y && data20y.chart && data20y.chart.result && data20y.chart.result.length > 0) {
            const quotes20y = data20y.chart.result[0].indicators?.quote?.[0];
            if (quotes20y && quotes20y.close) {
                const closes = quotes20y.close.filter(c => c !== null);
                if (closes.length >= 12) { // At least 1 year of data
                    const firstClose = closes[0];
                    const lastClose = closes[closes.length - 1];
                    dataYears = closes.length / 12;

                    // CAGR calculation
                    if (firstClose > 0 && lastClose > 0) {
                        historicalCAGR = Math.pow(lastClose / firstClose, 1 / dataYears) - 1;
                        // Cap at 15% to prevent unrealistic 30yr extrapolations to billions
                        historicalCAGR = Math.min(historicalCAGR, 0.15);
                    }

                    // Historical Volatility (from monthly returns)
                    const returns = [];
                    for (let i = 1; i < closes.length; i++) {
                        returns.push(Math.log(closes[i] / closes[i - 1]));
                    }
                    if (returns.length > 0) {
                        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                        const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
                        const monthlyVol = Math.sqrt(variance);
                        historicalVolatility = monthlyVol * Math.sqrt(12); // annualize
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`Could not fetch 20y history for ${symbol}, using defaults.`);
    }

    // Process Dividends over the trailing 1 year
    const dividendMonths = {};
    const dividendAmounts = {}; // per-share amount by month
    let ttmDividend = 0;
    if (dividends && currentPrice > 0) {
        Object.values(dividends).forEach(div => {
            const date = new Date(div.date * 1000);
            const month = date.getMonth() + 1; // 1-12
            ttmDividend += div.amount;

            // Calculate yield share for this specific month
            const yieldShare = div.amount / currentPrice;
            if (dividendMonths[month]) {
                dividendMonths[month] += yieldShare;
                dividendAmounts[month] += div.amount;
            } else {
                dividendMonths[month] = yieldShare;
                dividendAmounts[month] = div.amount;
            }
        });
    }

    const payoutSchedule = Object.keys(dividendMonths)
        .map(m => ({
            month: parseInt(m),
            yield: Math.round(dividendMonths[m] * 10000) / 10000,
            amountPerShare: Math.round(dividendAmounts[m] * 10000) / 10000
        }))
        .sort((a, b) => a.month - b.month);

    const dividendYield = currentPrice > 0 ? (ttmDividend / currentPrice) : 0;

    return {
        symbol,
        shortName,
        currentPrice,
        previousClose,
        currency,
        exchangeName,
        volatility: Math.round(historicalVolatility * 1000) / 1000,
        cagr: Math.round(historicalCAGR * 10000) / 10000, // as decimal (e.g. 0.0815 for 8.15%)
        dataYears: Math.round(dataYears * 10) / 10,
        change: currentPrice - previousClose,
        changePct: previousClose > 0 ? ((currentPrice - previousClose) / previousClose * 100).toFixed(2) : 0,
        dividendYield: Math.round(dividendYield * 10000) / 10000,
        payoutSchedule
    };
}

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        }).on('error', reject);
    });
}

// ==================== 決策引擎 API ====================

// Default scanner stock list (top TW ETFs + blue chips)
const DEFAULT_SCAN_LIST = [
    '0050', '0056', '00878', '00919', '00929', '00940',
    '006208', '00713', '00850', '00692',
    '2330', '2317', '2454', '2308', '2881', '2882',
    '2891', '2303', '3711', '2412',
    '2886', '2884', '1301', '1303', '2002', '2105',
    '3008', '2345', '6505', '1216'
];

// Analysis endpoint — returns daily OHLCV for technical analysis
app.get('/api/stock/:symbol/analysis', async (req, res) => {
    let symbol = req.params.symbol.toUpperCase().trim();
    const months = parseInt(req.query.months) || 12;

    const isTaiwanCode = /^\d{4,6}[A-Z]*$/.test(symbol);
    if (isTaiwanCode) symbol = symbol + '.TW';

    try {
        let data = await fetchAnalysisData(symbol, months);

        // Fallback for OTC
        if (!data && isTaiwanCode) {
            const altSymbol = symbol.replace('.TW', '.TWO');
            data = await fetchAnalysisData(altSymbol, months);
            if (data) symbol = altSymbol;
        }

        if (!data) {
            return res.status(404).json({ error: `找不到 ${symbol} 的技術分析資料` });
        }

        res.json(data);
    } catch (err) {
        console.error(`Error fetching analysis for ${symbol}:`, err.message);
        res.status(500).json({ error: '無法取得技術分析資料', details: err.message });
    }
});

async function fetchAnalysisData(symbol, months) {
    // Fetch daily data for the requested period 
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${months}mo&events=div`;
    const data = await fetchJSON(url);

    if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) {
        return null;
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const opens = quotes.open || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const closes = quotes.close || [];
    const volumes = quotes.volume || [];

    // Build daily OHLCV array
    const days = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null || opens[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        days.push({
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            open: Math.round(opens[i] * 100) / 100,
            high: Math.round(highs[i] * 100) / 100,
            low: Math.round(lows[i] * 100) / 100,
            close: Math.round(closes[i] * 100) / 100,
            volume: volumes[i] || 0,
        });
    }

    return {
        symbol,
        shortName: meta.shortName || symbol,
        currency: meta.currency || 'TWD',
        currentPrice: meta.regularMarketPrice || 0,
        previousClose: meta.previousClose || meta.chartPreviousClose || 0,
        exchangeName: meta.exchangeName || '',
        days,
        dataMonths: months,
    };
}

// Scanner endpoint — batch scan multiple symbols
app.get('/api/scanner/top', async (req, res) => {
    const symbolsParam = req.query.symbols;
    const symbolList = symbolsParam
        ? symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        : DEFAULT_SCAN_LIST;

    try {
        // Process in parallel with concurrency limit
        const batchSize = 5;
        const results = [];

        for (let i = 0; i < symbolList.length; i += batchSize) {
            const batch = symbolList.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(
                batch.map(async (sym) => {
                    try {
                        let symbol = sym;
                        const isTW = /^\d{4,6}[A-Z]*$/.test(symbol);
                        if (isTW) symbol = symbol + '.TW';

                        let data = await fetchAnalysisData(symbol, 6);
                        if (!data && isTW) {
                            const altSymbol = symbol.replace('.TW', '.TWO');
                            data = await fetchAnalysisData(altSymbol, 6);
                        }
                        return data ? { originalSymbol: sym, ...data } : null;
                    } catch {
                        return null;
                    }
                })
            );
            for (const r of batchResults) {
                if (r.status === 'fulfilled' && r.value) {
                    results.push(r.value);
                }
            }
        }

        res.json({ stocks: results, scannedAt: new Date().toISOString() });
    } catch (err) {
        console.error('Scanner error:', err.message);
        res.status(500).json({ error: '掃描失敗', details: err.message });
    }
});

// ==================== 專業研究橋接 API ====================
const { execFile } = require('child_process');
const QUANT_DIR = path.join(__dirname, 'quant_research');
const QUANT_RESULTS = path.join(QUANT_DIR, 'quant_results.json');

// Read research results
app.get('/api/quant/results', (req, res) => {
    const fs = require('fs');
    try {
        if (!fs.existsSync(QUANT_RESULTS)) {
            return res.json({
                exists: false,
                message: '尚未執行研究。請先在「🧪 專業研究」分頁點擊執行，或在終端機執行 python quant_research/research_engine.py',
            });
        }
        const raw = fs.readFileSync(QUANT_RESULTS, 'utf-8');
        const data = JSON.parse(raw);
        res.json({ exists: true, ...data });
    } catch (err) {
        res.status(500).json({ error: '讀取研究結果失敗', details: err.message });
    }
});

// Trigger Python research (async, returns immediately)
let researchRunning = false;
app.post('/api/quant/run-research', express.json(), (req, res) => {
    if (researchRunning) {
        return res.status(409).json({ error: '研究正在執行中，請稍後...' });
    }

    const symbols = req.body?.symbols || '';
    const years = req.body?.years || 3;
    const token = req.body?.token || '';

    const args = ['research_engine.py'];
    if (symbols) args.push('--symbols', symbols);
    if (years) args.push('--years', String(years));
    if (token) args.push('--token', token);

    researchRunning = true;
    console.log(`\n🧠 啟動 Python 研究引擎: python ${args.join(' ')}`);

    const child = execFile('python', args, { cwd: QUANT_DIR, timeout: 600000 }, (err, stdout, stderr) => {
        researchRunning = false;
        if (err) {
            console.error('❌ Python 研究失敗:', err.message);
            console.error(stderr);
        } else {
            console.log('✅ Python 研究完成');
            console.log(stdout);
        }
    });

    res.json({ status: 'started', message: '研究已啟動，請稍後查看結果（約需 1~5 分鐘）' });
});

// Check research status
app.get('/api/quant/status', (req, res) => {
    res.json({ running: researchRunning });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Life Budget Simulator 伺服器已啟動`);
    console.log(`   http://localhost:${PORT}\n`);
});
