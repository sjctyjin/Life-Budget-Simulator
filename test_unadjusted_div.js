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
        const splits = ev.splits ? Object.values(ev.splits).sort((a,b) => a.date - b.date) : [];
        const divs = ev.dividends ? Object.values(ev.dividends).sort((a,b) => a.date - b.date) : [];
        
        for (const d of divs) {
            let multiplier = 1;
            for (const s of splits) {
                if (s.date > d.date) {
                    multiplier *= (s.denominator / s.numerator);
                }
            }
            const unadjusted = d.amount * multiplier;
            console.log(`Date: ${new Date(d.date * 1000).toISOString().split('T')[0]}, AdjAmt: ${d.amount.toFixed(4)}, Multiplier: ${multiplier.toFixed(4)}, UnadjAmt: ${unadjusted.toFixed(2)}`);
        }
    } catch (e) {
        console.error(e);
    }
})();
