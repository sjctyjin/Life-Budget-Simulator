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
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/2885.TW?interval=1mo&range=5y&events=div,splits';
        const data = await fetchJSON(url);
        const ev = data.chart.result[0].events;
        console.log("Splits:", JSON.stringify(ev.splits, null, 2));
        console.log("Dividends:", JSON.stringify(ev.dividends, null, 2));
    } catch (e) {
        console.error(e);
    }
})();
