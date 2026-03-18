/**
 * Ghost Mode — Historical DCA Backtest Engine
 * 👻 幽靈模式回測引擎
 *
 * Given historical monthly prices and dividends,
 * simulates dollar-cost averaging and calculates ROI + IRR.
 */

class GhostBacktest {
    /**
     * @param {Object} opts
     * @param {Array} opts.months - [{date, close, timestamp}, ...]
     * @param {Array} opts.dividends - [{yearMonth, amount, timestamp}, ...]
     * @param {number} opts.monthlyAmount - Monthly DCA amount in local currency
     * @param {boolean} opts.reinvestDividends - Whether to reinvest dividends
     * @param {string} opts.currency - 'TWD' or 'USD'
     * @param {number} opts.currentPrice - Current market price (for final value calc)
     */
    constructor(opts) {
        this.months = opts.months || [];
        this.dividends = opts.dividends || [];
        this.splits = opts.splits || [];
        this.monthlyAmount = opts.monthlyAmount || 5000;
        this.reinvestDividends = opts.reinvestDividends !== false;
        this.currency = opts.currency || 'TWD';
        this.currentPrice = opts.currentPrice || 0;
    }

    run() {
        if (this.months.length === 0) {
            return { error: '無歷史資料可供回測' };
        }

        let totalShares = 0;
        let totalInvested = 0;
        let totalDividendsCash = 0; // Cash dividends received (if not reinvesting)
        let totalDividendsReinvested = 0; // Value of reinvested dividends
        const cashflows = []; // For XIRR: [{date, amount}]
        const monthlyDetails = [];
        const yearlyDetails = {};

        // Build a map of dividends by yearMonth for quick lookup
        const divMap = {};
        for (const d of this.dividends) {
            if (!divMap[d.yearMonth]) divMap[d.yearMonth] = 0;
            divMap[d.yearMonth] += d.amount;
        }

        // Build a map of splits by yearMonth
        const splitMap = {};
        for (const s of this.splits) {
            if (!splitMap[s.yearMonth]) splitMap[s.yearMonth] = [];
            splitMap[s.yearMonth].push(s.ratio);
        }

        for (let i = 0; i < this.months.length; i++) {
            const m = this.months[i];
            const price = m.close;
            if (price <= 0) continue;

            // 1. DCA Buy
            const sharesBought = this.monthlyAmount / price;
            totalShares += sharesBought;
            totalInvested += this.monthlyAmount;

            // Record as negative cashflow (money going out)
            cashflows.push({
                date: new Date(m.timestamp * 1000),
                amount: -this.monthlyAmount,
            });

            // 2. Check for cash dividends this month
            let monthDividend = 0;
            let dividendShares = 0;
            const divAmount = divMap[m.date];
            if (divAmount && divAmount > 0) {
                monthDividend = divAmount * totalShares;

                if (this.reinvestDividends) {
                    dividendShares = monthDividend / price;
                    totalShares += dividendShares;
                    totalDividendsReinvested += monthDividend;
                } else {
                    totalDividendsCash += monthDividend;
                }
            }

            // 3. Apply stock splits (stock dividends)
            let stockDividendShares = 0;
            if (splitMap[m.date]) {
                let actualMultiplier = 1;
                for (const sObj of splitMap[m.date]) {
                    actualMultiplier *= sObj.ratio;
                }
                const newShares = totalShares * actualMultiplier;
                stockDividendShares = newShares - totalShares;
                totalShares = newShares;
            }

            const currentValue = totalShares * price;

            const detail = {
                date: m.date,
                price,
                sharesBought: Math.round(sharesBought * 10000) / 10000,
                dividendPerShare: divAmount || 0,
                dividendTotal: Math.round(monthDividend),
                dividendShares: Math.round(dividendShares * 10000) / 10000,
                stockDividendShares: Math.round(stockDividendShares * 10000) / 10000,
                totalShares: Math.round(totalShares * 10000) / 10000,
                totalInvested: Math.round(totalInvested),
                currentValue: Math.round(currentValue),
                totalDividendsCash: Math.round(totalDividendsCash),
                unrealizedGain: Math.round(currentValue - totalInvested),
            };
            monthlyDetails.push(detail);

            // Yearly aggregation
            const year = m.date.substring(0, 4);
            if (!yearlyDetails[year]) {
                yearlyDetails[year] = {
                    year,
                    invested: 0,
                    dividends: 0,
                    sharesBought: 0,
                    dividendShares: 0,
                    stockDividendShares: 0,
                    endShares: 0,
                    endValue: 0,
                    endPrice: 0,
                };
            }
            yearlyDetails[year].invested += this.monthlyAmount;
            yearlyDetails[year].dividends += monthDividend;
            yearlyDetails[year].sharesBought += sharesBought;
            yearlyDetails[year].dividendShares += dividendShares;
            yearlyDetails[year].stockDividendShares += stockDividendShares;
            yearlyDetails[year].endShares = totalShares;
            yearlyDetails[year].endValue = currentValue;
            yearlyDetails[year].endPrice = price;
        }

        // Use current market price for final valuation
        const finalPrice = this.currentPrice > 0 ? this.currentPrice : this.months[this.months.length - 1].close;
        const finalMarketValue = totalShares * finalPrice;
        const totalReturn = finalMarketValue + totalDividendsCash;
        const roi = totalInvested > 0 ? ((totalReturn / totalInvested) - 1) : 0;

        // Add final value as positive cashflow for XIRR
        cashflows.push({
            date: new Date(), // today
            amount: totalReturn,
        });

        const irr = this.calculateXIRR(cashflows);

        // Convert yearly details to sorted array
        const yearlyArray = Object.values(yearlyDetails)
            .sort((a, b) => a.year.localeCompare(b.year))
            .map(y => ({
                ...y,
                invested: Math.round(y.invested),
                dividends: Math.round(y.dividends),
                sharesBought: Math.round(y.sharesBought * 10000) / 10000,
                dividendShares: Math.round(y.dividendShares * 10000) / 10000,
                stockDividendShares: Math.round(y.stockDividendShares * 10000) / 10000,
                endShares: Math.round(y.endShares * 10000) / 10000,
                endValue: Math.round(y.endValue),
            }));

        return {
            totalInvested: Math.round(totalInvested),
            totalShares: Math.round(totalShares * 10000) / 10000,
            finalPrice: Math.round(finalPrice * 100) / 100,
            finalMarketValue: Math.round(finalMarketValue),
            totalDividendsCash: Math.round(totalDividendsCash),
            totalDividendsReinvested: Math.round(totalDividendsReinvested),
            totalReturn: Math.round(totalReturn),
            roi,
            irr,
            months: this.months.length,
            years: Math.round((this.months.length / 12) * 10) / 10,
            monthlyDetails,
            yearlyDetails: yearlyArray,
            cashflows,
        };
    }

    /**
     * XIRR — Extended Internal Rate of Return
     * Uses Newton's method to find the annual rate r such that NPV = 0
     *
     * NPV = Σ cashflow_i / (1 + r) ^ (days_i / 365.25)
     */
    calculateXIRR(cashflows) {
        if (cashflows.length < 2) return 0;

        const firstDate = cashflows[0].date;
        const daysDiff = (d) => (d.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);

        const npv = (rate) => {
            let sum = 0;
            for (const cf of cashflows) {
                const years = daysDiff(cf.date) / 365.25;
                sum += cf.amount / Math.pow(1 + rate, years);
            }
            return sum;
        };

        const dnpv = (rate) => {
            let sum = 0;
            for (const cf of cashflows) {
                const years = daysDiff(cf.date) / 365.25;
                if (years === 0) continue;
                sum += -years * cf.amount / Math.pow(1 + rate, years + 1);
            }
            return sum;
        };

        // Newton's method
        let rate = 0.1; // initial guess 10%
        for (let i = 0; i < 200; i++) {
            const f = npv(rate);
            const df = dnpv(rate);
            if (Math.abs(df) < 1e-12) break;
            const newRate = rate - f / df;

            // Guard against divergence
            if (newRate < -0.99) rate = -0.5;
            else if (newRate > 10) rate = 5;
            else rate = newRate;

            if (Math.abs(f) < 1e-6) break;
        }

        return Math.round(rate * 10000) / 10000; // e.g. 0.0812 = 8.12%
    }

    /**
     * Buy-and-Hold Backtest
     * Simulates buying shares at a specific date and holding until now.
     *
     * @param {Object} opts
     * @param {Array} opts.months - Historical monthly price data
     * @param {Array} opts.dividends - Historical dividends
     * @param {string} opts.buyDate - 'YYYY-MM' format
     * @param {number} opts.shares - Number of shares bought
     * @param {number} opts.currentPrice - Current market price
     * @param {string} opts.currency - Currency code
     */
    static runBuyAndHold(opts) {
        const { months, dividends, splits = [], buyDate, shares, currentPrice, currency } = opts;

        if (!months || months.length === 0) return { error: '無歷史資料' };

        // Find the buy month
        const buyIdx = months.findIndex(m => m.date >= buyDate);
        if (buyIdx === -1) return { error: `找不到 ${buyDate} 的歷史資料，請確認日期在歷史範圍內` };

        const buyMonth = months[buyIdx];
        const buyPrice = buyMonth.close;
        const totalInvested = buyPrice * shares;
        let currentShares = shares;

        // Track from buy date to end
        let totalDividendsCash = 0;
        const monthlyDetails = [];
        const dividendHistory = []; // individual dividend events

        // Build dividend lookup
        const divMap = {};
        for (const d of (dividends || [])) {
            if (!divMap[d.yearMonth]) divMap[d.yearMonth] = [];
            divMap[d.yearMonth].push(d);
        }

        // Build split lookup
        const splitMap = {};
        for (const s of splits) {
            if (!splitMap[s.yearMonth]) splitMap[s.yearMonth] = [];
            splitMap[s.yearMonth].push({ ratio: s.ratio, adjustedPrices: s.adjustedPrices });
        }

        for (let i = buyIdx; i < months.length; i++) {
            const m = months[i];
            const price = m.close;

            // Apply stock splits (stock dividends)
            let stockDividendShares = 0;
            if (splitMap[m.date]) {
                let actualMultiplier = 1;
                for (const sObj of splitMap[m.date]) {
                    actualMultiplier *= sObj.ratio;
                }
                const newShares = currentShares * actualMultiplier;
                stockDividendShares = newShares - currentShares;
                currentShares = newShares;
            }

            const marketValue = price * currentShares;

            // Check dividends for this month
            let monthDiv = 0;
            const monthDivEvents = divMap[m.date] || [];
            for (const de of monthDivEvents) {
                const divAmount = de.amount * currentShares;
                monthDiv += divAmount;
                totalDividendsCash += divAmount;
                dividendHistory.push({
                    date: de.date,
                    perShare: de.amount,
                    shares: Math.round(currentShares * 100) / 100,
                    total: Math.round(divAmount),
                });
            }

            monthlyDetails.push({
                date: m.date,
                price,
                shares: Math.round(currentShares * 10000) / 10000,
                stockDividendShares: Math.round(stockDividendShares * 10000) / 10000,
                marketValue: Math.round(marketValue),
                dividendThisMonth: Math.round(monthDiv),
                totalDividends: Math.round(totalDividendsCash),
                totalReturn: Math.round(marketValue + totalDividendsCash),
                gainPct: totalInvested > 0 ? ((marketValue - totalInvested) / totalInvested * 100) : 0,
            });
        }

        const finalPrice = currentPrice > 0 ? currentPrice : months[months.length - 1].close;
        const finalMarketValue = finalPrice * currentShares;
        const totalReturn = finalMarketValue + totalDividendsCash;
        const roi = totalInvested > 0 ? (totalReturn / totalInvested) - 1 : 0;

        // Calculate the equivalent final price PER ORIGINAL SHARE to make a fair comparison.
        // e.g. if you bought 1000 shares at 103.8, and now have 4000 shares at 77.8,
        // the equivalent value per original share is 77.8 * 4000 / 1000 = 311.2
        const equivalentFinalPrice = Math.round(finalPrice * currentShares / shares * 100) / 100;
        const priceGain = Math.round((equivalentFinalPrice - buyPrice) * 100) / 100;
        const priceGainPct = buyPrice > 0 ? (priceGain / buyPrice) : 0;

        // Calculate holding period
        const buyTimestamp = months[buyIdx].timestamp;
        const holdingDays = Math.round((Date.now() / 1000 - buyTimestamp) / 86400);
        const holdingYears = Math.round(holdingDays / 365.25 * 10) / 10;

        // IRR
        const cashflows = [
            { date: new Date(buyTimestamp * 1000), amount: -totalInvested },
            { date: new Date(), amount: totalReturn },
        ];
        // Borrow XIRR from prototype
        const tempEngine = new GhostBacktest({ months: [], dividends: [] });
        const irr = tempEngine.calculateXIRR(cashflows);

        // Yearly aggregation of dividends
        const yearlyDividends = {};
        for (const dh of dividendHistory) {
            const year = dh.date.substring(0, 4);
            if (!yearlyDividends[year]) yearlyDividends[year] = { year, count: 0, total: 0, events: [] };
            yearlyDividends[year].count++;
            yearlyDividends[year].total += dh.total;
            yearlyDividends[year].events.push(dh);
        }

        return {
            buyDate: buyMonth.date,
            buyPrice,
            shares,
            currentShares: Math.round(currentShares * 10000) / 10000,
            totalInvested: Math.round(totalInvested),
            finalPrice: Math.round(finalPrice * 100) / 100,
            equivalentFinalPrice,
            finalMarketValue: Math.round(finalMarketValue),
            priceGain,
            priceGainPct,
            totalDividendsCash: Math.round(totalDividendsCash),
            totalReturn: Math.round(totalReturn),
            roi,
            irr,
            holdingDays,
            holdingYears,
            dividendHistory,
            yearlyDividends: Object.values(yearlyDividends).sort((a, b) => a.year.localeCompare(b.year)),
            monthlyDetails,
            currency: currency || 'TWD',
            cashflows,
        };
    }

    static runPortfolio(resultsList, isBuyAndHold = false) {
        if (!resultsList || resultsList.length === 0) return { error: 'No stocks provided' };

        let totalInvested = 0;
        let finalMarketValue = 0;
        let totalDividendsCash = 0;
        let totalReturn = 0;
        let allCashflows = [];
        const breakdown = [];

        // Combine monthly values
        const aggMonthly = {};
        const aggYearly = {};

        for (const r of resultsList) {
            totalInvested += r.result.totalInvested || 0;
            finalMarketValue += r.result.finalMarketValue || 0;
            totalDividendsCash += r.result.totalDividendsCash || 0;
            totalReturn += r.result.totalReturn || 0;

            const negatives = (r.result.cashflows || []).filter(cf => cf.amount < 0);
            allCashflows = allCashflows.concat(negatives);

            for (const m of (r.result.monthlyDetails || [])) {
                if (!aggMonthly[m.date]) {
                    aggMonthly[m.date] = { date: m.date, marketValue: 0, totalInvested: 0, dividendThisMonth: 0, totalDividends: 0, totalReturn: 0 };
                }
                aggMonthly[m.date].marketValue += m.marketValue || 0;
                aggMonthly[m.date].totalInvested += m.totalInvested || m.invested || 0;
                aggMonthly[m.date].dividendThisMonth += m.dividendThisMonth || 0;
                aggMonthly[m.date].totalDividends += m.totalDividends || 0;
                aggMonthly[m.date].totalReturn += m.totalReturn || 0;
            }

            const yearlySource = isBuyAndHold ? r.result.yearlyDividends : r.result.yearlyDetails;
            for (const y of (yearlySource || [])) {
                const year = y.year;
                if (!aggYearly[year]) {
                    aggYearly[year] = { year, invested: 0, dividends: 0, endValue: 0, count: 0, total: 0, events: [] };
                }
                if (isBuyAndHold) {
                    aggYearly[year].count += y.count || 0;
                    aggYearly[year].total += y.total || 0;
                    if (y.events) {
                        const taggedEvents = y.events.map(e => ({ ...e, symbol: r.symbol }));
                        aggYearly[year].events = aggYearly[year].events.concat(taggedEvents);
                    }
                } else {
                    aggYearly[year].invested += y.invested || 0;
                    aggYearly[year].dividends += y.dividends || 0;
                    aggYearly[year].endValue += y.endValue || 0;
                }
            }

            breakdown.push({
                symbol: r.symbol,
                invested: r.result.totalInvested,
                marketValue: r.result.finalMarketValue,
                dividends: r.result.totalDividendsCash,
                totalReturn: r.result.totalReturn,
                roi: r.result.roi,
                irr: r.result.irr
            });
        }

        allCashflows.push({
            date: new Date(),
            amount: totalReturn
        });

        const tempEngine = new GhostBacktest({ months: [], dividends: [] });
        const irr = tempEngine.calculateXIRR(allCashflows);
        const roi = totalInvested > 0 ? (totalReturn / totalInvested) - 1 : 0;

        const monthlyDetails = Object.values(aggMonthly).sort((a,b) => a.date.localeCompare(b.date));
        const yearlyArray = Object.values(aggYearly).sort((a,b) => a.year.localeCompare(b.year));

        const holdingYears = isBuyAndHold ? Math.max(...resultsList.map(r => r.result.holdingYears || 0)) : null;
        const buyDate = isBuyAndHold ? resultsList[0].result.buyDate : null; 
        const priceGain = isBuyAndHold ? resultsList.reduce((sum, r) => sum + (r.result.priceGain * r.result.shares), 0) : null;
        
        for (const b of breakdown) {
            b.weightPct = totalReturn > 0 ? (b.totalReturn / totalReturn) : 0;
        }
        breakdown.sort((a,b) => b.weightPct - a.weightPct);

        return {
            isPortfolio: true,
            totalInvested: Math.round(totalInvested),
            finalMarketValue: Math.round(finalMarketValue),
            totalDividendsCash: Math.round(totalDividendsCash),
            totalReturn: Math.round(totalReturn),
            roi,
            irr,
            monthlyDetails,
            yearlyDetails: isBuyAndHold ? null : yearlyArray,
            yearlyDividends: isBuyAndHold ? yearlyArray : null,
            holdingYears,
            buyDate,
            breakdown,
            priceGain,
            years: resultsList[0].result.years,
            dividendHistory: isBuyAndHold ? resultsList.flatMap(r => r.result.dividendHistory).sort((a,b) => a.date.localeCompare(b.date)) : null
        };
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.GhostBacktest = GhostBacktest;
}
