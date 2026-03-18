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
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/0050.TW?interval=1mo&range=5y&events=div,splits';
        const data = await fetchJSON(url);
        const result = data.chart.result[0];
        console.log("0050 Splits:", result.events?.splits);
    } catch (e) {
        console.error(e);
    }
})();
