const fs = require('fs');
const code = fs.readFileSync('./js/ghost-backtest.js', 'utf8');
eval(code + '\nglobal.GhostBacktest = GhostBacktest;');

const https = require('https');
https.get('https://query1.finance.yahoo.com/v8/finance/chart/00631L.TW?interval=1mo&range=6y&events=div,splits', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const parsed = JSON.parse(data);
        const result = parsed.chart.result[0];
        
        const timestamps = result.timestamp || [];
        const closes = result.indicators.quote[0].close || [];
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice || 0;
        
        const months = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue;
            const d = new Date(timestamps[i] * 1000);
            months.push({
                date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                close: closes[i],
                timestamp: timestamps[i],
            });
        }
        
        const gb = global.GhostBacktest.runBuyAndHold({
            months: months,
            dividends: [],
            splits: [],
            buyDate: '2020-01',
            shares: 10000,
            currentPrice: currentPrice,
            currency: 'TWD',
            reinvestDividends: true
        });
        
        const pf = global.GhostBacktest.runPortfolio([{ symbol: '00631L', result: gb }], true);
        
        console.log("Current Price:", currentPrice);
        console.log("Current Shares:", gb.currentShares);
        console.log("Final Market Value (Single):", gb.finalMarketValue);
        console.log("Equivalent Final Price:", gb.equivalentFinalPrice);
        console.log("Pf Final Market Value:", pf.finalMarketValue);
    });
});
