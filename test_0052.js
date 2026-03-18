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
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/0052.TW?interval=1mo&range=2y&events=div,splits';
        const data = await fetchJSON(url);
        const result = data.chart.result[0];
        
        console.log("Splits:", result.events?.splits);
        console.log("Quotes at idx 0 (date: " + new Date(result.timestamp[0]*1000).toISOString() + "):");
        console.log("close:", result.indicators.quote[0].close[0]);
        console.log("adjclose:", result.indicators.adjclose[0].adjclose[0]);
        
        // Let's print the last few months
        console.log("\nLast 5 months:");
        const len = result.timestamp.length;
        for (let i = Math.max(0, len-5); i < len; i++) {
            console.log(new Date(result.timestamp[i]*1000).toISOString().split('T')[0], "Close:", result.indicators.quote[0].close[i], "AdjClose:", result.indicators.adjclose[0].adjclose[i]);
        }
    } catch (e) {
        console.error(e);
    }
})();
