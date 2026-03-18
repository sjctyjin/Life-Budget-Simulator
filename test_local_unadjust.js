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
        const symbol = '0052.TW';
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=6y&events=div,splits`;
        const data = await fetchJSON(url);

        const result = data.chart.result[0];
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        const dividends = result.events?.dividends || {};
        
        let splits = [
            // 0052 split 1 to 7. Reference date 2025-11-26. NOT price adjusted by Yahoo, but IS dividend adjusted!
            { dateStr: '2025-11-26', numerator: 7, denominator: 1, adjustedPrices: false, adjustedDividends: true }
        ];

        splits = splits.map(ms => {
            const d = new Date(ms.dateStr);
            return {
                date: ms.dateStr,
                yearMonth: ms.dateStr.substring(0, 7),
                ratio: ms.numerator / ms.denominator,
                numerator: ms.numerator,
                denominator: ms.denominator,
                adjustedPrices: ms.adjustedPrices,
                adjustedDividends: ms.adjustedDividends,
                timestamp: Math.floor(d.getTime() / 1000)
            };
        }).sort((a, b) => a.timestamp - b.timestamp);

        console.log("0052 Prices in 2025:");
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue;
            const d = new Date(timestamps[i] * 1000);
            
            let multiplier = 1;
            for (const s of splits) {
                if (s.timestamp > timestamps[i] && s.adjustedPrices !== false) {
                    multiplier *= s.ratio;
                }
            }
            const unadjustedClose = closes[i] * multiplier;

            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (dateStr.startsWith('2025-08') || dateStr.startsWith('2025-09')) {
                console.log(`${dateStr}: MathClose=${Math.round(unadjustedClose * 100) / 100}, RawYahooClose=${closes[i]}`);
            }
        }
        
        console.log("\n0052 Dividends in 2025/2024:");
        const divList = Object.values(dividends).map(div => {
            const d = new Date(div.date * 1000);
            let multiplier = 1;
            for (const s of splits) {
                if (s.timestamp > div.date && s.adjustedDividends !== false) {
                    multiplier *= s.ratio;
                }
            }
            const unadjustedAmount = div.amount * multiplier;

            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (dateStr.startsWith('2025-04') || dateStr.startsWith('2024-04')) {
                console.log(`${dateStr}: MathDiv=${unadjustedAmount.toFixed(2)}, RawYahooDiv=${div.amount}`);
            }
        });
        
    } catch (e) {
        console.error("Parse error:", e);
    }
})();
