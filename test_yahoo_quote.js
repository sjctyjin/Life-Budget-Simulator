const https = require('https');

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function test() {
    const data = await fetchJSON('https://query1.finance.yahoo.com/v10/finance/quoteSummary/2330.TW?modules=financialData,defaultKeyStatistics');
    console.log(JSON.stringify(data, null, 2));
}

test();
