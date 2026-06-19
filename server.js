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
            date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
            yearMonth: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
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

    // Build monthly price array (deduplicated by year-month, keep LAST entry per month)
    // Yahoo returns split-adjusted historical prices. We must reverse this adjustment 
    // so the backtest engine uses the REAL ticker-tape historical prices for its buy calculations.
    const monthsMap = new Map();
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
        // CRITICAL: Use UTC methods! Yahoo timestamps are end-of-month UTC (e.g., May 31 16:00 UTC)
        // which becomes Jun 1 00:00 in UTC+8, shifting month labels forward by 1 if using local time.
        const yearMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

        // Overwrite: keep only the LAST data point per month (Yahoo sometimes returns duplicates)
        monthsMap.set(yearMonth, {
            date: yearMonth,
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            close: Math.round(unadjustedClose * 100) / 100, // True historical price
            adjustedClose: closes[i], // Original adjusted price from Yahoo
            timestamp: timestamps[i],
        });
    }
    const months = Array.from(monthsMap.values());

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
            date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
            yearMonth: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
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
    let dividendMonths = {};
    let dividendAmounts = {}; // per-share amount by month
    let ttmDividend = 0;

    if (dividends && currentPrice > 0) {
        // Collect all dividends within the last 1 year
        const divArray = Object.values(dividends).sort((a, b) => a.date - b.date);

        divArray.forEach(div => {
            const date = new Date(div.date * 1000);
            const month = date.getMonth() + 1; // 1-12
            
            if (dividendAmounts[month]) {
                dividendAmounts[month] += div.amount;
            } else {
                dividendAmounts[month] = div.amount;
            }
        });

        // --- EXTRAPOLATION FOR NEW ETFS ---
        const knownMonths = Object.keys(dividendAmounts);
        if (knownMonths.length > 0 && knownMonths.length < 10) {
            let freq = '';
            
            // Auto-detect based on payment intervals
            if (divArray.length >= 2) {
                let totalDays = 0;
                for (let i = 1; i < divArray.length; i++) {
                    totalDays += (divArray[i].date - divArray[i - 1].date) / (60 * 60 * 24);
                }
                const avgDays = totalDays / (divArray.length - 1);
                
                if (avgDays >= 20 && avgDays <= 40) freq = 'MONTHLY';
                else if (avgDays >= 75 && avgDays <= 105) freq = 'QUARTERLY';
            } 
            
            // Fallback: check ETF shortName for clues if only 1 payment was made
            if (freq === '' && shortName && (shortName.includes('月配') || shortName.includes('月配息'))) {
                freq = 'MONTHLY';
            }

            // Extrapolate missing payments using the average of known payments
            if (freq === 'MONTHLY' && knownMonths.length < 12) {
                const avgPayout = divArray.reduce((acc, d) => acc + d.amount, 0) / divArray.length;
                for (let m = 1; m <= 12; m++) {
                    if (!dividendAmounts[m]) dividendAmounts[m] = avgPayout;
                }
            } else if (freq === 'QUARTERLY' && knownMonths.length < 4) {
                const avgPayout = divArray.reduce((acc, d) => acc + d.amount, 0) / divArray.length;
                const lastM = new Date(divArray[divArray.length - 1].date * 1000).getMonth() + 1;
                
                // Project forward and backward by 3 months
                for (let m = lastM; m <= 12; m += 3) {
                    if (!dividendAmounts[m]) dividendAmounts[m] = avgPayout;
                }
                for (let m = lastM - 3; m >= 1; m -= 3) {
                    if (!dividendAmounts[m]) dividendAmounts[m] = avgPayout;
                }
            }
        }

        // Finalize TTMDividend and Yield
        Object.keys(dividendAmounts).forEach(m => {
            ttmDividend += dividendAmounts[m];
            dividendMonths[m] = dividendAmounts[m] / currentPrice;
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

        // --- Fetch Benchmark (^TWII for Taiwan stocks) ---
        if (isTaiwanCode) {
            try {
                const benchmarkData = await fetchAnalysisData('^TWII', months);
                if (benchmarkData && benchmarkData.days) {
                    data.benchmark = {
                        symbol: '^TWII',
                        shortName: '加權指數',
                        days: benchmarkData.days
                    };
                }
            } catch (e) {
                console.warn(`[API] Failed to fetch benchmark for ${symbol}:`, e.message);
            }
        }

        res.json(data);
    } catch (err) {
        console.error(`Error fetching analysis for ${symbol}:`, err.message);
        res.status(500).json({ error: '無法取得技術分析資料', details: err.message });
    }
});

// VWAP endpoint — returns intraday VWAP calculation
app.get('/api/stock/:symbol/vwap', async (req, res) => {
    let symbol = req.params.symbol.toUpperCase().trim();

    const isTaiwanCode = /^\d{4,6}[A-Z]*$/.test(symbol);
    if (isTaiwanCode) symbol = symbol + '.TW';

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
        let data = await fetchJSON(url);

        if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) {
            if (isTaiwanCode) {
                const altSymbol = symbol.replace('.TW', '.TWO');
                const altUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(altSymbol)}?interval=1m&range=1d`;
                const altData = await fetchJSON(altUrl);
                if (altData && altData.chart && altData.chart.result && altData.chart.result.length > 0) {
                    symbol = altSymbol;
                    data = altData;
                }
            }
        }

        if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) {
            return res.status(404).json({ error: `找不到 ${symbol} 的當日資料` });
        }

        const result = data.chart.result[0];
        const quotes = result.indicators?.quote?.[0] || {};
        const opens = quotes.open || [];
        const highs = quotes.high || [];
        const lows = quotes.low || [];
        const closes = quotes.close || [];
        const volumes = quotes.volume || [];

        let cumVolume = 0;
        let cumPV = 0;
        let vwap = 0;
        let currentPrice = result.meta.regularMarketPrice || 0;
        let vwapHistory = [];

        for (let i = 0; i < closes.length; i++) {
            if (closes[i] == null || volumes[i] == null) continue;
            
            const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
            const volume = volumes[i];
            
            cumVolume += volume;
            cumPV += typicalPrice * volume;
            
            if (cumVolume > 0) {
                vwap = cumPV / cumVolume;
            }
            vwapHistory.push(vwap);
        }
        
        // Determine slope based on the last 15 minutes (or available data)
        let slope = 'flat';
        if (vwapHistory.length > 15) {
            const oldVwap = vwapHistory[vwapHistory.length - 15];
            const diff = (vwap - oldVwap) / oldVwap;
            if (diff > 0.0005) slope = 'up';
            else if (diff < -0.0005) slope = 'down';
        } else if (vwapHistory.length > 5) {
            const oldVwap = vwapHistory[0];
            const diff = (vwap - oldVwap) / oldVwap;
            if (diff > 0.0005) slope = 'up';
            else if (diff < -0.0005) slope = 'down';
        }

        // Determine position
        let position = 'at';
        if (currentPrice > vwap * 1.002) position = 'above';
        else if (currentPrice < vwap * 0.998) position = 'below';

        res.json({
            symbol: symbol,
            vwap: Number(vwap.toFixed(2)),
            currentPrice: currentPrice,
            position: position,
            slope: slope,
            timestamp: result.meta.regularMarketTime * 1000
        });
    } catch (err) {
        console.error(`Error fetching VWAP for ${symbol}:`, err.message);
        res.status(500).json({ error: '無法取得 VWAP 資料', details: err.message });
    }
});

// ==================== 族群動能雷達 API ====================

// 台股族群定義
const SECTOR_GROUPS_TW = {
    memory: {
        name: '🧠 記憶體', stocks: [
            { symbol: '2344', name: '華邦電' }, { symbol: '3006', name: '晶豪科' },
            { symbol: '8150', name: '南茂' }, { symbol: '4967', name: '十銓' },
            { symbol: '8299', name: '群聯' }, { symbol: '2337', name: '旺宏' },
        ]
    },
    passive: {
        name: '⚡ 被動元件', stocks: [
            { symbol: '2327', name: '國巨' }, { symbol: '3023', name: '信邦' },
            { symbol: '2428', name: '興勤' }, { symbol: '1533', name: '車王電' },
            { symbol: '3090', name: '日電貿' }, { symbol: '2375', name: '凱美' },
            { symbol: '8163', name: '達方' },
        ]
    },
    optical: {
        name: '🔌 光通訊', stocks: [
            { symbol: '2340', name: '台亞' }, { symbol: '3152', name: '璟德' },
            { symbol: '6209', name: '今國光' }, { symbol: '4966', name: '譜瑞' },
            { symbol: '2485', name: '兆赫' }, { symbol: '3558', name: '神準' },
        ]
    },
    display: {
        name: '📺 面板/顯示', stocks: [
            { symbol: '3481', name: '群創' }, { symbol: '2409', name: '友達' },
            { symbol: '6116', name: '彩晶' }, { symbol: '8069', name: '元太' },
            { symbol: '3049', name: '和鑫' },
        ]
    },
    satellite: {
        name: '🛰️ 衛星/軍工', stocks: [
            { symbol: '2049', name: '上銀' }, { symbol: '3027', name: '盛達' },
            { symbol: '3217', name: '優群' }, { symbol: '2634', name: '漢翔' },
            { symbol: '4979', name: '華星光' },
        ]
    },
    ai_semi: {
        name: '🤖 AI/半導體', stocks: [
            { symbol: '2330', name: '台積電' }, { symbol: '2454', name: '聯發科' },
            { symbol: '3443', name: '創意' }, { symbol: '2379', name: '瑞昱' },
            { symbol: '3661', name: '世芯' }, { symbol: '2388', name: '威盛' },
        ]
    },
    power: {
        name: '🏗️ 重電/電力', stocks: [
            { symbol: '1503', name: '士電' }, { symbol: '1504', name: '東元' },
            { symbol: '1513', name: '中興電' }, { symbol: '1519', name: '華城' },
            { symbol: '8261', name: '富鼎' },
        ]
    },
    green: {
        name: '🔋 綠能/儲能', stocks: [
            { symbol: '6443', name: '元晶' }, { symbol: '3576', name: '聯合再生' },
            { symbol: '6244', name: '茂迪' }, { symbol: '3691', name: '碩禾' },
        ]
    },
};

// 美股族群定義
const SECTOR_GROUPS_US = {
    ai_gpu: {
        name: '🤖 AI/GPU', stocks: [
            { symbol: 'NVDA', name: 'NVIDIA' }, { symbol: 'AMD', name: 'AMD' },
            { symbol: 'AVGO', name: 'Broadcom' }, { symbol: 'QCOM', name: 'Qualcomm' },
            { symbol: 'INTC', name: 'Intel' }, { symbol: 'MRVL', name: 'Marvell' },
        ]
    },
    memory_us: {
        name: '🧠 記憶體', stocks: [
            { symbol: 'MU', name: 'Micron' }, { symbol: 'WDC', name: 'Western Digital' },
            { symbol: 'STX', name: 'Seagate' },
        ]
    },
    optical_us: {
        name: '🔌 光通訊', stocks: [
            { symbol: 'AAOI', name: 'Applied Optoelec' }, { symbol: 'LITE', name: 'Lumentum' },
            { symbol: 'COHR', name: 'Coherent' }, { symbol: 'CIEN', name: 'Ciena' },
            { symbol: 'VIAV', name: 'Viavi Solutions' },
        ]
    },
    semi_equip: {
        name: '⚙️ 半導體設備', stocks: [
            { symbol: 'ASML', name: 'ASML' }, { symbol: 'LRCX', name: 'Lam Research' },
            { symbol: 'KLAC', name: 'KLA Corp' }, { symbol: 'AMAT', name: 'Applied Materials' },
        ]
    },
    cloud: {
        name: '☁️ 雲端/SaaS', stocks: [
            { symbol: 'MSFT', name: 'Microsoft' }, { symbol: 'AMZN', name: 'Amazon' },
            { symbol: 'GOOGL', name: 'Alphabet' }, { symbol: 'META', name: 'Meta' },
            { symbol: 'SNOW', name: 'Snowflake' },
        ]
    },
    ev_energy: {
        name: '🔋 電動車/能源', stocks: [
            { symbol: 'TSLA', name: 'Tesla' }, { symbol: 'RIVN', name: 'Rivian' },
            { symbol: 'NIO', name: 'NIO' }, { symbol: 'ENPH', name: 'Enphase' },
            { symbol: 'FSLR', name: 'First Solar' },
        ]
    },
};

// 快取
let sectorCacheTW = { data: null, ts: 0 };
let sectorCacheUS = { data: null, ts: 0 };
const SECTOR_CACHE_TTL = 3 * 60 * 1000; // 3 分鐘

// 取得單支股票的即時量價摘要 (Yahoo Finance)
async function fetchStockSnapshot(symbol) {
    try {
        // 用 1d range + 1d interval 取得今日數據 + 近期均量
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`;
        const data = await fetchJSON(url);

        if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) return null;

        const result = data.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators?.quote?.[0] || {};
        const closes = quotes.close || [];
        const volumes = quotes.volume || [];

        const len = closes.length;
        if (len < 2) return null;

        const currentPrice = meta.regularMarketPrice || closes[len - 1] || 0;
        const prevClose = closes[len - 2] || closes[len - 1] || 0;
        const todayVolume = volumes[len - 1] || 0;

        // 計算 5 日均量 (排除今天)
        const pastVolumes = volumes.slice(Math.max(0, len - 6), len - 1).filter(v => v > 0);
        const avgVolume = pastVolumes.length > 0
            ? pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length
            : todayVolume;

        const changePercent = prevClose > 0 ? ((currentPrice - prevClose) / prevClose * 100) : 0;
        const volumeRatio = avgVolume > 0 ? (todayVolume / avgVolume) : 1;

        return {
            price: currentPrice,
            prevClose: prevClose,
            change: Number(changePercent.toFixed(2)),
            volume: todayVolume,
            avgVolume: Math.round(avgVolume),
            volumeRatio: Number(volumeRatio.toFixed(2)),
        };
    } catch (err) {
        console.error(`[Sector] Error fetching ${symbol}:`, err.message);
        return null;
    }
}

// 掃描單一族群
async function scanSector(sectorId, sectorDef, market) {
    const stocks = sectorDef.stocks;
    const results = [];

    // 批次處理，每批 3 支，避免速率限制
    const batchSize = 3;
    for (let i = 0; i < stocks.length; i += batchSize) {
        const batch = stocks.slice(i, i + batchSize);
        const promises = batch.map(async (s) => {
            const yahooSymbol = market === 'tw' ? s.symbol + '.TW' : s.symbol;
            const snapshot = await fetchStockSnapshot(yahooSymbol);
            if (snapshot) {
                results.push({
                    symbol: s.symbol,
                    name: s.name,
                    ...snapshot,
                });
            }
        });
        await Promise.allSettled(promises);
    }

    if (results.length === 0) {
        return { id: sectorId, name: sectorDef.name, error: true, stocks: [] };
    }

    // 計算族群加權指標
    const avgChange = results.reduce((a, s) => a + s.change, 0) / results.length;
    const avgVR = results.reduce((a, s) => a + s.volumeRatio, 0) / results.length;
    const hotStocks = results.filter(s => s.change > 2 && s.volumeRatio > 1.5).length;
    const maxVR = Math.max(...results.map(s => s.volumeRatio));

    // 排序：成交量比率高的在前
    results.sort((a, b) => b.volumeRatio - a.volumeRatio);

    return {
        id: sectorId,
        name: sectorDef.name,
        avgChange: Number(avgChange.toFixed(2)),
        avgVolumeRatio: Number(avgVR.toFixed(2)),
        maxVolumeRatio: Number(maxVR.toFixed(2)),
        hotStocks: hotStocks,
        totalStocks: results.length,
        alert: avgVR >= 2 || (hotStocks >= 3),
        momentum: avgVR >= 2.5 ? 'extreme' : avgVR >= 1.8 ? 'strong' : avgVR >= 1.2 ? 'normal' : 'weak',
        stocks: results,
    };
}

// 掃描所有族群
async function scanAllSectors(market) {
    const groups = market === 'tw' ? SECTOR_GROUPS_TW : SECTOR_GROUPS_US;
    const cache = market === 'tw' ? sectorCacheTW : sectorCacheUS;

    // 快取檢查
    if (cache.data && (Date.now() - cache.ts) < SECTOR_CACHE_TTL) {
        console.log(`[Sector] 使用 ${market.toUpperCase()} 快取 (${Math.round((Date.now() - cache.ts) / 1000)}s ago)`);
        return cache.data;
    }

    console.log(`[Sector] 開始掃描 ${market.toUpperCase()} 族群動能...`);
    const startTime = Date.now();

    const sectorIds = Object.keys(groups);
    const sectors = [];

    // 逐族群掃描 (避免同時發太多請求)
    for (const id of sectorIds) {
        const result = await scanSector(id, groups[id], market);
        sectors.push(result);
    }

    // 依動能排序 (Volume Ratio 高的在前)
    sectors.sort((a, b) => (b.avgVolumeRatio || 0) - (a.avgVolumeRatio || 0));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Sector] ${market.toUpperCase()} 掃描完成 (${elapsed}s), 熱門族群: ${sectors.filter(s => s.alert).map(s => s.name).join(', ') || '無'}`);

    const result = {
        sectors: sectors,
        timestamp: new Date().toISOString(),
        market: market,
        elapsed: Number(elapsed),
    };

    // 寫入快取
    if (market === 'tw') { sectorCacheTW = { data: result, ts: Date.now() }; }
    else { sectorCacheUS = { data: result, ts: Date.now() }; }

    return result;
}

// API 端點
app.get('/api/sector/momentum', async (req, res) => {
    const market = (req.query.market || 'tw').toLowerCase();

    if (market !== 'tw' && market !== 'us') {
        return res.status(400).json({ error: '市場參數錯誤，請使用 tw 或 us' });
    }

    try {
        const data = await scanAllSectors(market);
        res.json(data);
    } catch (err) {
        console.error(`[Sector] 掃描失敗:`, err.message);
        res.status(500).json({ error: '族群動能掃描失敗', details: err.message });
    }
});

// 查詢某支股票屬於哪個族群
app.get('/api/sector/lookup/:symbol', (req, res) => {
    const symbol = req.params.symbol.toUpperCase().trim();
    const market = (req.query.market || 'tw').toLowerCase();
    const groups = market === 'tw' ? SECTOR_GROUPS_TW : SECTOR_GROUPS_US;

    for (const [id, group] of Object.entries(groups)) {
        const found = group.stocks.find(s => s.symbol === symbol);
        if (found) {
            return res.json({ found: true, sectorId: id, sectorName: group.name, stock: found });
        }
    }
    res.json({ found: false, symbol: symbol });
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

// ==================== 當沖掃描 API ====================

// ---- Trending Stock Cache ----
const trendingCache = {
    tw: { data: null, timestamp: 0 },
    us: { data: null, timestamp: 0 },
};
const CACHE_TTL_TW = 30 * 60 * 1000; // 30 minutes (TWSE updates after market close)
const CACHE_TTL_US = 60 * 60 * 1000; // 60 minutes (Alpha Vantage has daily call limits)

/**
 * Fetch trending Taiwan stocks from TWSE MI_INDEX20 (daily volume top 20).
 * Returns array of stock codes like ['3481', '2303', '6770', ...]
 */
async function fetchTrendingTW() {
    const now = Date.now();
    if (trendingCache.tw.data && (now - trendingCache.tw.timestamp) < CACHE_TTL_TW) {
        console.log('  📦 使用快取的台股熱門榜 (' + trendingCache.tw.data.length + ' 檔)');
        return trendingCache.tw.data;
    }

    try {
        const url = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX20?response=json';
        const raw = await new Promise((resolve, reject) => {
            https.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });

        if (raw && raw.stat === 'OK' && raw.data && raw.data.length > 0) {
            // raw.data: [[rank, code, name, volume, ...], ...]
            const tickers = raw.data
                .map(row => String(row[1]).trim())
                .filter(code => /^\d{4,6}[A-Z]*$/.test(code)); // Keep only stock/ETF codes

            trendingCache.tw.data = tickers;
            trendingCache.tw.timestamp = now;
            console.log('  🔥 台股成交量 Top 20:', tickers.join(', '));
            return tickers;
        }
    } catch (err) {
        console.warn('  ⚠️ TWSE 熱門榜 API 失敗:', err.message);
    }
    return [];
}

/**
 * Fetch trending US stocks from Alpha Vantage TOP_GAINERS_LOSERS.
 * Returns array of tickers like ['NVDA', 'INTC', 'TSLA', ...]
 */
async function fetchTrendingUS(apiKey) {
    const now = Date.now();
    if (trendingCache.us.data && (now - trendingCache.us.timestamp) < CACHE_TTL_US) {
        console.log('  📦 使用快取的美股熱門榜 (' + trendingCache.us.data.length + ' 檔)');
        return trendingCache.us.data;
    }

    const key = apiKey || 'demo';
    try {
        const url = `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${key}`;
        const raw = await new Promise((resolve, reject) => {
            https.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
            }).on('error', reject);
        });

        if (raw && raw.metadata) {
            const allTickers = new Set();

            // Extract from all three lists: top_gainers, top_losers, most_actively_traded
            for (const listKey of ['top_gainers', 'top_losers', 'most_actively_traded']) {
                const list = raw[listKey] || [];
                for (const item of list) {
                    const ticker = item.ticker;
                    if (!ticker) continue;

                    // Filter out warrants (W suffix), rights (+), preferred (^), and penny stocks
                    if (/[W+^]/.test(ticker.slice(-1))) continue;
                    if (ticker.length > 5) continue; // Skip long tickers (usually warrants)

                    const price = parseFloat(item.price) || 0;
                    if (price < 1) continue; // Skip penny stocks

                    allTickers.add(ticker);
                }
            }

            const tickers = [...allTickers];
            trendingCache.us.data = tickers;
            trendingCache.us.timestamp = now;
            console.log('  🔥 美股動態熱門 (' + tickers.length + ' 檔):', tickers.slice(0, 15).join(', ') + '...');
            return tickers;
        }

        // Check if rate-limited
        if (raw && raw.Note) {
            console.warn('  ⚠️ Alpha Vantage API 頻率限制:', raw.Note);
        }
        if (raw && raw.Information) {
            console.warn('  ⚠️ Alpha Vantage API 訊息:', raw.Information);
        }
    } catch (err) {
        console.warn('  ⚠️ Alpha Vantage API 失敗:', err.message);
    }
    return [];
}

// ---- Core Watchlists (smaller, always-included fallback) ----

// Taiwan core watchlist — blue chips and popular day trade targets
const DAYTRADE_TW_CORE = [
    // 半導體龍頭
    '2303','2308','2344','2379','2408','3034','6770',
    // 面板 / 光電
    '3481','2409','3008',
    // AI / 伺服器 / 網通
    '2317','2345','2382','2474','3005','3035','3376',
    // 金融
    '2881','2882','2884','2886','2891',
    // 傳產代表
    '1301','1303','2002','2105',
    // 中低價題材
    '2324','2301','2337','6278','6488','6550','6669',
];

// US core watchlist — always-included popular stocks for day trading
const DAYTRADE_US_CORE = [
    // Mega-cap Tech
    'AAPL','MSFT','GOOG','AMZN','META','TSLA','NVDA','AMD',
    // AI / Semiconductor / Memory
    'AVGO','MRVL','MU','INTC','QCOM','ARM','SMCI','TSM',
    // Optical Communications (user-requested)
    'AAOI','LITE','CIEN','INFN',
    // Semiconductor ETF
    'SMH','SOXL','SOXX',
    // High-volatility favorites
    'PLTR','COIN','MARA','RIOT','IONQ','RBLX','GME',
    // Market ETFs
    'SPY','QQQ','TQQQ',
];

// Day-trade scanner endpoint (supports tw and us markets)
// Now dynamically fetches trending stocks from TWSE / Alpha Vantage,
// merges with core watchlist, and scans the combined unique list.
app.get('/api/scanner/daytrade', async (req, res) => {
    const market = (req.query.market || 'tw').toLowerCase();
    const symbolsParam = req.query.symbols;
    const avKey = req.query.avKey || '';
    const defaultMin = market === 'us' ? 5 : 100;
    const defaultMax = market === 'us' ? 500 : 500;
    const priceMin = parseFloat(req.query.priceMin) || defaultMin;
    const priceMax = parseFloat(req.query.priceMax) || defaultMax;

    const marketLabel = market === 'us' ? '美股' : '台股';
    const currency = market === 'us' ? 'USD' : 'TWD';

    // If user provided custom symbols, use those exclusively
    let symbolList;
    let trendingSet = new Set();

    if (symbolsParam) {
        symbolList = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        console.log(`\n⚡ 當沖掃描啟動 [${marketLabel}] (自訂): ${symbolList.length} 檔, 價格 ${priceMin}~${priceMax}`);
    } else {
        // Dynamic: fetch trending + merge with core watchlist
        console.log(`\n⚡ 當沖掃描啟動 [${marketLabel}] (動態), 價格 ${priceMin}~${priceMax}`);

        let trendingTickers = [];
        const coreList = market === 'us' ? DAYTRADE_US_CORE : DAYTRADE_TW_CORE;

        if (market === 'us') {
            trendingTickers = await fetchTrendingUS(avKey);
        } else {
            trendingTickers = await fetchTrendingTW();
        }

        // Track which tickers came from trending API
        trendingSet = new Set(trendingTickers.map(t => t.toUpperCase()));

        // Merge: trending first, then core (for display priority)
        const merged = new Set();
        for (const t of trendingTickers) merged.add(t.toUpperCase());
        for (const t of coreList) merged.add(t.toUpperCase());
        symbolList = [...merged];

        const trendCount = trendingTickers.length;
        const coreCount = symbolList.length - trendCount;
        console.log(`  📊 合併清單: ${trendCount} 動態 + ${coreCount} 核心 = ${symbolList.length} 檔 (去重後)`);
    }

    try {
        const batchSize = 5;
        const results = [];

        for (let i = 0; i < symbolList.length; i += batchSize) {
            const batch = symbolList.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(
                batch.map(async (sym) => {
                    try {
                        let symbol = sym;
                        const isTW = /^\d{4,6}[A-Z]*$/.test(symbol);

                        // Only auto-append .TW for Taiwan market codes
                        if (market === 'tw' && isTW) {
                            symbol = symbol + '.TW';
                        }

                        // 3 months of daily data is sufficient for day trade analysis
                        let data = await fetchAnalysisData(symbol, 3);

                        // Fallback for Taiwan OTC stocks
                        if (!data && market === 'tw' && isTW) {
                            const altSymbol = symbol.replace('.TW', '.TWO');
                            data = await fetchAnalysisData(altSymbol, 3);
                        }

                        // Pre-filter by price range to reduce payload
                        if (data && data.currentPrice >= priceMin && data.currentPrice <= priceMax) {
                            // Tag source: 'trending' or 'core'
                            const source = trendingSet.has(sym.toUpperCase()) ? 'trending' : 'core';
                            return { originalSymbol: sym, source, ...data };
                        }
                        return null;
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

        const trendingCount = results.filter(r => r.source === 'trending').length;
        const coreCount = results.filter(r => r.source === 'core').length;
        console.log(`⚡ 掃描完成 [${marketLabel}]: ${results.length} 檔在 ${priceMin}~${priceMax} 區間 (🔥 ${trendingCount} 動態 + 📋 ${coreCount} 核心)`);
        res.json({
            stocks: results,
            scannedAt: new Date().toISOString(),
            market,
            currency,
            priceRange: { min: priceMin, max: priceMax },
            sources: { trending: trendingCount, core: coreCount }
        });
    } catch (err) {
        console.error('Day-trade scanner error:', err.message);
        res.status(500).json({ error: '當沖掃描失敗', details: err.message });
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
let researchLog = [];
let researchError = '';
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
    researchLog = ['🧠 啟動 Python 研究引擎...'];
    researchError = '';
    console.log(`\n🧠 啟動 Python 研究引擎: python ${args.join(' ')}`);

    const pythonPath = path.join(QUANT_DIR, 'venv310', 'Scripts', 'python.exe');
    const child = execFile(pythonPath, args, { cwd: QUANT_DIR, timeout: 600000 }, (err, stdout, stderr) => {
        researchRunning = false;
        if (err) {
            console.error('❌ Python 研究失敗:', err.message);
            console.error(stderr);
            researchError = err.message;
            researchLog.push(`❌ 執行失敗: ${err.message}`);
        } else {
            console.log('✅ Python 研究完成');
            console.log(stdout);
            researchLog.push('✅ 研究完成！');
        }
    });

    // Capture real-time stdout
    if (child.stdout) {
        child.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                researchLog.push(line);
                // Keep last 50 lines
                if (researchLog.length > 50) researchLog.shift();
            }
        });
    }
    if (child.stderr) {
        child.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                researchLog.push(`⚠️ ${line}`);
                if (researchLog.length > 50) researchLog.shift();
            }
        });
    }

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
