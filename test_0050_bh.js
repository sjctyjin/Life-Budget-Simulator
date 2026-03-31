const fs = require('fs');
const code = fs.readFileSync('./js/ghost-backtest.js', 'utf8');
eval(code + '\nglobal.GhostBacktest = GhostBacktest;');

const https = require('https');
https.get('http://localhost:8080/api/stock/0050/backtest?years=6', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const d = JSON.parse(data);
        const gb = global.GhostBacktest.runBuyAndHold({
            months: d.months,
            dividends: d.dividends,
            splits: d.splits,
            buyDate: '2020-01',
            shares: 10000,
            currentPrice: d.currentPrice,
            currency: 'TWD',
            reinvestDividends: true
        });
        
        const pf = global.GhostBacktest.runPortfolio([{ symbol: '0050', result: gb }], true);
        
        console.log("Current Price:", d.currentPrice);
        console.log("Splits:", d.splits);
        console.log("Current Shares:", gb.currentShares);
        console.log("Final Market Value (Single):", gb.finalMarketValue);
    });
});
