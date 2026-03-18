const http = require('http');

http.get('http://localhost:3000/api/stock/0050.TW/backtest?years=6', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            console.log("Splits returned:", parsed.splits);
            console.log("\n0050 Prices in 2020:");
            for (const m of parsed.months) {
                if (m.date.startsWith('2020-01') || m.date.startsWith('2020-02') || m.date.startsWith('2025-01')) {
                    console.log(`${m.date}: close=${m.close}, adjClose=${m.adjustedClose}`);
                }
            }
        } catch (e) {
            console.error("Parse error:", e);
        }
    });
}).on('error', (e) => {
    console.error("Request error:", e);
});
