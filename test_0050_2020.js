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

(async () => {
    try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/0050.TW?interval=1mo&range=6y';
        const data = await fetchJSON(url);
        const result = data.chart.result[0];
        
        console.log("0050 Quotes:");
        for (let i = 0; i < 5; i++) {
            const date = new Date(result.timestamp[i]*1000).toISOString().split('T')[0];
            console.log(`Date: ${date}, close: ${result.indicators.quote[0].close[i]}, adjclose: ${result.indicators.adjclose[0].adjclose[i]}`);
        }
        
    } catch (e) {
        console.error(e);
    }
})();
