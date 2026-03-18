const https = require('https');

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function dumpPrices(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=3y`;
        const data = await fetchJSON(url);
        const result = data.chart.result[0];
        
        console.log(`\n=== ${symbol} Monthly closes ===`);
        const len = result.timestamp.length;
        for (let i = Math.max(0, len-12); i < len; i++) {
            const date = new Date(result.timestamp[i]*1000).toISOString().split('T')[0];
            const close = result.indicators.quote[0].close[i];
            console.log(`${date}: ${close}`);
        }
    } catch (e) {
        console.error(e);
    }
}

(async () => {
    await dumpPrices('0050.TW');
    await dumpPrices('0052.TW');
})();
