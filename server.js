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
    const splits = Object.values(splitData).map(s => {
        const d = new Date(s.date * 1000);
        return {
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            ratio: s.numerator / s.denominator,
            numerator: s.numerator,
            denominator: s.denominator,
            timestamp: s.date
        };
    }).sort((a, b) => a.timestamp - b.timestamp);

    const dividends = events.dividends || {};

    const currency = meta.currency || 'TWD';
    const shortName = meta.shortName || symbol;
    const currentPrice = meta.regularMarketPrice || 0;

    // Build monthly price array
    const months = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        months.push({
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            close: Math.round(closes[i] * 100) / 100,
            timestamp: timestamps[i],
        });
    }

    // Build dividend array and unadjust the amounts 
    // Yahoo returns split-adjusted dividends, so we multiply by all future splits to get the actual historical cash payout
    const divList = Object.values(dividends).map(div => {
        const d = new Date(div.date * 1000);
        let multiplier = 1;
        for (const s of splits) {
            if (s.timestamp > div.date) {
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

app.listen(PORT, () => {
    console.log(`\n🚀 Life Budget Simulator 伺服器已啟動`);
    console.log(`   http://localhost:${PORT}\n`);
});
