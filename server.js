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

async function fetchStockData(symbol) {
    // Fetch 1 year of data to get accurate volatility and trailing dividends
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
    const data = await fetchJSON(url);

    if (!data || !data.chart || !data.chart.result || data.chart.result.length === 0) {
        return null;
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const dividends = result.events?.dividends; // map of timestamp -> { date, amount }

    const currentPrice = meta.regularMarketPrice || 0;
    const previousClose = meta.previousClose || meta.chartPreviousClose || currentPrice;
    const currency = meta.currency || 'USD';
    const exchangeName = meta.exchangeName || '';
    const shortName = meta.shortName || symbol;

    // Calculate annualized volatility from 1y daily closes
    let volatility = 0.25; // default 25% annual
    if (quotes && quotes.close) {
        const closes = quotes.close.filter(c => c !== null);
        if (closes.length >= Math.min(20, closes.length)) { // Need at least some points
            const returns = [];
            for (let i = 1; i < closes.length; i++) {
                returns.push(Math.log(closes[i] / closes[i - 1]));
            }
            if (returns.length > 0) {
                const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
                const dailyVol = Math.sqrt(variance);
                volatility = dailyVol * Math.sqrt(252); // annualize
            }
        }
    }

    // Process Dividends over the trailing 1 year
    const dividendMonths = {};
    let ttmDividend = 0;
    if (dividends && currentPrice > 0) {
        Object.values(dividends).forEach(div => {
            const date = new Date(div.date * 1000);
            const month = date.getMonth() + 1; // 1-12
            ttmDividend += div.amount;

            // Calculate yield share for this specific month (e.g. if price is 100, and this month paid 2, yieldShare is 0.02)
            const yieldShare = div.amount / currentPrice;
            if (dividendMonths[month]) {
                dividendMonths[month] += yieldShare;
            } else {
                dividendMonths[month] = yieldShare;
            }
        });
    }

    // Prepare an array of { month, yield }
    const payoutSchedule = Object.keys(dividendMonths)
        .map(m => ({ month: parseInt(m), yield: Math.round(dividendMonths[m] * 10000) / 10000 }))
        .sort((a, b) => a.month - b.month);

    const dividendYield = currentPrice > 0 ? (ttmDividend / currentPrice) : 0;

    return {
        symbol,
        shortName,
        currentPrice,
        previousClose,
        currency,
        exchangeName,
        volatility: Math.round(volatility * 1000) / 1000,
        change: currentPrice - previousClose,
        changePct: previousClose > 0 ? ((currentPrice - previousClose) / previousClose * 100).toFixed(2) : 0,
        dividendYield: Math.round(dividendYield * 10000) / 10000, // as decimal (e.g. 0.05 for 5%)
        payoutSchedule // [{ month: 1, yield: 0.02 }, { month: 7, yield: 0.03 }]
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
