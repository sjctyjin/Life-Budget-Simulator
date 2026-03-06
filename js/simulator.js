/**
 * Monte Carlo Financial Simulator — V3
 * 蒙地卡羅財務模擬引擎
 * Features: debts, stock portfolio, year-end bonus, monthly breakdown
 */

class FinancialSimulator {
    constructor(config) {
        this.income = config.income || 0;
        this.age = config.age || 25;
        this.currentYear = config.currentYear || new Date().getFullYear();
        this.retireAge = config.retireAge || 65;
        this.fixedExpenses = config.fixedExpenses || [];
        this.variableExpenses = config.variableExpenses || [];
        this.savings = config.savings || 0;
        this.debts = config.debts || []; // [{name, totalRemaining, monthlyPayment, remainingPeriods}]
        this.stocks = config.stocks || []; // [{symbol, shares, currentPrice, volatility, currency, exchangeRate}]
        this.decision = config.decision || null;
        this.annualRaiseRate = config.annualRaiseRate || 0.03;
        this.inflationRate = config.inflationRate || 0.02;
        this.bonusMonths = config.bonusMonths || 0; // year-end bonus in months of salary

        // Calculate initial values
        this.totalDebtRemaining = this.debts.reduce((s, d) => s + d.totalRemaining, 0);
        this.stockPortfolioValue = this.stocks.reduce((s, st) => {
            const priceNTD = st.currency === 'USD' ? st.currentPrice * (st.exchangeRate || 32) : st.currentPrice;
            return s + priceNTD * st.shares;
        }, 0);
        this.initialNetWorth = this.savings + this.stockPortfolioValue - this.totalDebtRemaining;
    }

    randomNormal(mean = 0, std = 1) {
        let u1 = Math.random();
        let u2 = Math.random();
        while (u1 === 0) u1 = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + std * z;
    }

    getTotalFixedExpenses() {
        return this.fixedExpenses.reduce((sum, e) => sum + e.amount, 0);
    }

    getRandomVariableExpenses(inflationFactor) {
        const items = {};
        let total = 0;
        for (const exp of this.variableExpenses) {
            const mean = exp.amount;
            const std = exp.fluctuation || mean * 0.2;
            let val = this.randomNormal(mean, std) * inflationFactor;
            if (val < 0) val = 0;
            items[exp.name] = Math.round(val);
            total += val;
        }
        return { items, total };
    }

    getInsuranceMonthlyPremium() {
        if (!this.decision || this.decision.type !== 'insurance' || !this.decision.insurance) return 0;
        return this.decision.insurance.yearlyPremium / 12;
    }

    getInsuranceDividendForYear(yearIndex) {
        if (!this.decision || this.decision.type !== 'insurance' || !this.decision.insurance) return 0;
        const ins = this.decision.insurance;
        const years = this.decision.years || 12;
        if (yearIndex >= years) return 0;
        const rate = ins.baseRate + ins.rateIncrement * yearIndex;
        return ins.yearlyPremium * rate;
    }

    /**
     * Simulate a single path with full detail tracking
     * @param {number} years - simulation duration
     * @param {boolean} trackDetail - whether to store monthly breakdown
     */
    simulateOnePath(years, trackDetail = false) {
        let cashBalance = this.savings;
        let monthlyIncome = this.income;
        const fixedExpenseBase = this.getTotalFixedExpenses();
        const totalMonths = years * 12;

        // Clone debts for tracking payoff
        const activeDebts = this.debts.map(d => ({
            ...d,
            remaining: d.totalRemaining,
            periodsLeft: d.remainingPeriods,
        }));

        // Clone stocks for tracking value
        const activeStocks = this.stocks.map(st => ({
            ...st,
            priceNTD: st.currency === 'USD' ? st.currentPrice * (st.exchangeRate || 32) : st.currentPrice,
        }));

        // Insurance & Real Estate
        const isInsurance = this.decision && this.decision.type === 'insurance' && this.decision.insurance;
        const isHouse = this.decision && this.decision.type === 'house';

        const insuranceMonthlyPremium = this.getInsuranceMonthlyPremium();
        const decisionMonthlyCost = (!this.decision || isInsurance || isHouse) ? 0 : (this.decision.monthlyCost || 0);
        const houseMonthlyMortgage = isHouse ? (this.decision.monthlyCost || 0) : 0;
        let propertyValue = isHouse ? (this.decision.housePrice || 0) : 0;
        const houseAppreciationRate = isHouse ? (this.decision.appreciationRate || 0) : 0;

        const decisionYears = this.decision ? (this.decision.years || years) : 0;
        let totalInsuranceDividends = 0;

        // Stock Liquidation Helper
        const liquidateStocks = (amountNeeded) => {
            if (amountNeeded <= 0) return 0;
            let amountRaised = 0;
            for (const st of activeStocks) {
                if (amountRaised >= amountNeeded) break;
                if (st.shares > 0 && st.priceNTD > 0) {
                    const value = st.shares * st.priceNTD;
                    const stillNeeded = amountNeeded - amountRaised;
                    if (value <= stillNeeded) {
                        amountRaised += value;
                        st.shares = 0;
                    } else {
                        const sharesToSell = stillNeeded / st.priceNTD;
                        st.shares -= sharesToSell;
                        amountRaised += stillNeeded;
                    }
                }
            }
            return amountRaised;
        };

        // Apply upfront cost
        if (this.decision && this.decision.upfrontCost) {
            cashBalance -= this.decision.upfrontCost;
            if (cashBalance < 0) {
                const raised = liquidateStocks(-cashBalance);
                cashBalance += raised;
            }
        }

        // Calculate stock value
        const getStockValue = () => activeStocks.reduce((s, st) => s + st.priceNTD * st.shares, 0);
        const getTotalDebtRemaining = () => activeDebts.reduce((s, d) => s + Math.max(d.remaining, 0), 0);

        let netWorth = cashBalance + getStockValue() + propertyValue - getTotalDebtRemaining();
        const netWorthPath = [netWorth];

        // Detail tracking
        const monthlyDetails = trackDetail ? [] : null;

        let bankrupt = false;
        let bankruptMonth = -1;

        for (let month = 1; month <= totalMonths; month++) {
            const yearIndex = Math.floor((month - 1) / 12);
            const monthInYear = ((month - 1) % 12) + 1; // 1-12
            const currentAge = this.age + yearIndex;
            const calendarYear = this.currentYear + yearIndex;
            const inflationFactor = Math.pow(1 + this.inflationRate, yearIndex);

            // Annual salary raise & Property Appreciation
            if (month > 1 && monthInYear === 1) {
                monthlyIncome *= (1 + this.annualRaiseRate + this.randomNormal(0, 0.01));
                if (isHouse) {
                    propertyValue *= (1 + houseAppreciationRate);
                }
            }

            // --- INCOME ---
            const salaryIncome = currentAge < this.retireAge ? monthlyIncome : 0;
            let bonusIncome = 0;
            if (monthInYear === 12 && this.bonusMonths > 0 && currentAge < this.retireAge) {
                bonusIncome = monthlyIncome * this.bonusMonths;
            }
            const totalIncome = salaryIncome + bonusIncome;

            // --- FIXED EXPENSES ---
            const fixedItems = {};
            let totalFixed = 0;
            for (const e of this.fixedExpenses) {
                const val = Math.round(e.amount * inflationFactor);
                fixedItems[e.name] = val;
                totalFixed += val;
            }

            // --- VARIABLE EXPENSES ---
            const varResult = this.getRandomVariableExpenses(inflationFactor);

            // --- DEBT PAYMENTS ---
            const debtItems = {};
            let totalDebtPayment = 0;
            for (const d of activeDebts) {
                if (d.periodsLeft > 0 && d.remaining > 0) {
                    const payment = Math.min(d.monthlyPayment, d.remaining);
                    debtItems[d.name] = Math.round(payment);
                    totalDebtPayment += payment;
                    d.remaining -= payment;
                    d.periodsLeft--;
                }
            }

            // --- DECISION COST ---
            let decisionExpense = 0;
            let insuranceDividend = 0;
            if (month <= decisionYears * 12) {
                if (isInsurance) {
                    decisionExpense = insuranceMonthlyPremium;
                    if (monthInYear === 12) {
                        insuranceDividend = this.getInsuranceDividendForYear(yearIndex);
                        totalInsuranceDividends += insuranceDividend;
                    }
                } else if (isHouse) {
                    decisionExpense = houseMonthlyMortgage;
                } else {
                    decisionExpense = decisionMonthlyCost;
                }
            }

            // --- STOCK RETURNS & DIVIDENDS ---
            let stockReturn = 0; // Unrealized gain/loss this month
            let stockDividendIncome = 0; // Realized cash dividend this month
            const stockReturnItems = {};
            for (const st of activeStocks) {
                if (st.shares > 0 && st.priceNTD > 0) {
                    // 1. Dividend payout
                    if (st.payoutSchedule && st.payoutSchedule.length > 0) {
                        const payout = st.payoutSchedule.find(p => p.month === monthInYear);
                        if (payout) {
                            // Dividend is cash generated based on current value and the specific month's yield
                            const dividendCash = st.priceNTD * st.shares * payout.yield;
                            stockDividendIncome += dividendCash;
                        }
                    }

                    // 2. Price fluctuation (Capital Gain/Loss)
                    const monthlyVol = (st.volatility || 0.25) / Math.sqrt(12);
                    const annualMu = st.expectedReturn !== undefined ? st.expectedReturn : 0.08;
                    const monthlyMu = annualMu / 12; // use specific expected return (historic CAGR)
                    const ret = this.randomNormal(monthlyMu, monthlyVol);
                    const previousValue = st.priceNTD * st.shares;

                    st.priceNTD *= (1 + ret);
                    if (st.priceNTD < 0) st.priceNTD = 0;

                    const currentValue = st.priceNTD * st.shares;
                    const gain = currentValue - previousValue;

                    stockReturn += gain;
                    stockReturnItems[st.symbol || '股票'] = Math.round(gain);
                }
            }

            // --- DOLLAR-COST AVERAGING (DCA) ---
            for (const e of this.fixedExpenses) {
                if (e.isInvestment && e.targetStock) {
                    const targetSt = activeStocks.find(s => s.symbol === e.targetStock);
                    if (targetSt && targetSt.priceNTD > 0) {
                        const investedCash = Math.round(e.amount * inflationFactor);
                        const sharesBought = investedCash / targetSt.priceNTD;
                        targetSt.shares += sharesBought;
                    }
                }
            }

            // --- NET CASH FLOW ---
            const totalExpenses = totalFixed + varResult.total + totalDebtPayment + decisionExpense;
            // Cash flow only includes actual cash in/out (excludes unrealized stock returns)
            const cashFlow = totalIncome + insuranceDividend + stockDividendIncome - totalExpenses;

            cashBalance += cashFlow;
            if (cashBalance < 0) {
                const raised = liquidateStocks(-cashBalance);
                cashBalance += raised;
            }

            // Net worth is cash + stocks (updated prices) + propertyValue - debt
            netWorth = cashBalance + getStockValue() + propertyValue - getTotalDebtRemaining();
            netWorthPath.push(netWorth);

            if (cashBalance < -monthlyIncome * 3 && !bankrupt) {
                bankrupt = true;
                bankruptMonth = month;
            }

            // Store monthly detail
            if (trackDetail) {
                const currentStockList = activeStocks.map(st => ({
                    symbol: st.symbol || st.shortName || '未命名',
                    price: Math.round(st.priceNTD * 100) / 100,
                    shares: Math.round(st.shares * 1000) / 1000,
                    value: Math.round(st.priceNTD * st.shares)
                }));

                monthlyDetails.push({
                    month,
                    monthInYear,
                    yearIndex,
                    calendarYear,
                    age: currentAge,
                    stockList: currentStockList,
                    income: {
                        salary: Math.round(salaryIncome),
                        bonus: Math.round(bonusIncome),
                        insuranceDividend: Math.round(insuranceDividend),
                        stockReturn: Math.round(stockReturn),
                        stockDividendIncome: Math.round(stockDividendIncome),
                        stockReturnItems,
                        total: Math.round(totalIncome + insuranceDividend + stockDividendIncome), // only realized cash
                    },
                    expenses: {
                        fixed: fixedItems,
                        variable: varResult.items,
                        debts: debtItems,
                        decision: decisionExpense > 0 ? Math.round(decisionExpense) : 0,
                        decisionName: this.decision?.name || '',
                        totalFixed: Math.round(totalFixed),
                        totalVariable: Math.round(varResult.total),
                        totalDebt: Math.round(totalDebtPayment),
                        total: Math.round(totalExpenses),
                    },
                    netCashFlow: Math.round(cashFlow), // uses the calculated realized cash flow

                    cashBalance: Math.round(cashBalance),
                    stockValue: Math.round(getStockValue()),
                    debtRemaining: Math.round(getTotalDebtRemaining()),
                    netWorth: Math.round(netWorth),
                });
            }
        }

        return {
            netWorthPath,
            finalNetWorth: netWorth,
            bankrupt,
            bankruptMonth,
            totalInsuranceDividends,
            monthlyDetails,
        };
    }

    /**
     * Run full Monte Carlo simulation
     * After main run, re-run 3 detailed paths for P10/P50/P90 breakdown
     */
    runSimulation(iterations = 5000) {
        const years = this.decision
            ? Math.max(this.decision.years || 10, 10)
            : Math.min(this.retireAge - this.age, 30);
        const simulationYears = Math.min(years, 30);

        const results = [];
        const allPaths = [];
        let bankruptCount = 0;
        const finalNetWorths = [];

        for (let i = 0; i < iterations; i++) {
            const result = this.simulateOnePath(simulationYears, false);
            results.push(result);
            finalNetWorths.push(result.finalNetWorth);
            if (result.bankrupt) bankruptCount++;
            if (i < 200) allPaths.push(result.netWorthPath);
        }

        finalNetWorths.sort((a, b) => a - b);

        const initialNW = this.initialNetWorth;
        const successCount = results.filter(r => r.finalNetWorth >= initialNW).length;
        const successRate = successCount / iterations;
        const shrinkCount = results.filter(r => r.finalNetWorth < initialNW).length;
        const shrinkRate = shrinkCount / iterations;
        const bankruptcyRate = bankruptCount / iterations;

        const p10 = finalNetWorths[Math.floor(iterations * 0.1)];
        const p25 = finalNetWorths[Math.floor(iterations * 0.25)];
        const p50 = finalNetWorths[Math.floor(iterations * 0.5)];
        const p75 = finalNetWorths[Math.floor(iterations * 0.75)];
        const p90 = finalNetWorths[Math.floor(iterations * 0.9)];

        // Percentile paths
        const totalMonths = simulationYears * 12 + 1;
        const medianPath = [], p10Path = [], p90Path = [];
        for (let m = 0; m < totalMonths; m++) {
            const values = allPaths.map(p => p[m] || 0).sort((a, b) => a - b);
            medianPath.push(values[Math.floor(values.length * 0.5)]);
            p10Path.push(values[Math.floor(values.length * 0.1)]);
            p90Path.push(values[Math.floor(values.length * 0.9)]);
        }

        // === RUN 3 DETAILED PATHS for representative scenarios ===
        // We run fresh simulations and pick closest to P10/P50/P90
        const detailedCandidates = [];
        for (let i = 0; i < 100; i++) {
            const r = this.simulateOnePath(simulationYears, true);
            detailedCandidates.push(r);
        }
        detailedCandidates.sort((a, b) => a.finalNetWorth - b.finalNetWorth);

        const findClosest = (target) => {
            let best = detailedCandidates[0];
            let bestDiff = Infinity;
            for (const c of detailedCandidates) {
                const diff = Math.abs(c.finalNetWorth - target);
                if (diff < bestDiff) { bestDiff = diff; best = c; }
            }
            return best;
        };

        const detailedPaths = {
            pessimistic: findClosest(p10),
            median: findClosest(p50),
            optimistic: findClosest(p90),
        };

        // Stress & recommendation
        let stressLevel, stressLabel;
        if (successRate >= 0.8) { stressLevel = 'low'; stressLabel = '低'; }
        else if (successRate >= 0.6) { stressLevel = 'medium'; stressLabel = '中'; }
        else if (successRate >= 0.4) { stressLevel = 'high'; stressLabel = '高'; }
        else { stressLevel = 'critical'; stressLabel = '極高'; }

        const monthlyNetIncome = this.income - this.getTotalFixedExpenses() -
            this.variableExpenses.reduce((s, e) => s + e.amount, 0) -
            this.debts.reduce((s, d) => s + d.monthlyPayment, 0);
        const decisionTotalCost = (this.decision?.monthlyCost || 0) * (this.decision?.years || 0) * 12 +
            (this.decision?.upfrontCost || 0);
        const retirementDelay = monthlyNetIncome > 0 ? Math.round(decisionTotalCost / (monthlyNetIncome * 12)) : 0;

        let recommendation;
        if (successRate >= 0.8) {
            recommendation = '✅ 資產增長率良好！在此決策下，你的資產有高機率在模擬期間持續成長，財務風險低。';
        } else if (successRate >= 0.6) {
            recommendation = '⚠️ 中等風險。此決策下資產有一定機率縮水，建議提升收入或降低支出來增加安全邊際。';
        } else if (successRate >= 0.4) {
            recommendation = '🔶 風險偏高。超過半數模擬結果顯示資產會縮水，建議重新評估此決策的規模或時機。';
        } else {
            recommendation = '🚫 高風險！大多數模擬結果顯示資產將縮水，此決策在目前財務狀況下不建議執行。';
        }

        // Expense breakdown for pie chart
        const expenseBreakdown = {};
        for (const e of this.fixedExpenses) {
            expenseBreakdown[e.name] = (expenseBreakdown[e.name] || 0) + e.amount;
        }
        for (const e of this.variableExpenses) {
            expenseBreakdown[e.name] = (expenseBreakdown[e.name] || 0) + e.amount;
        }
        for (const d of this.debts) {
            expenseBreakdown[d.name + ' (貸款)'] = d.monthlyPayment;
        }
        if (this.decision) {
            if (this.decision.type === 'insurance' && this.decision.insurance) {
                expenseBreakdown['保險保費'] = this.getInsuranceMonthlyPremium();
            } else if (this.decision.monthlyCost) {
                expenseBreakdown[this.decision.name || '決策支出'] = this.decision.monthlyCost;
            }
        }

        // Insurance stats
        let insuranceStats = null;
        if (this.decision && this.decision.type === 'insurance' && this.decision.insurance) {
            const ins = this.decision.insurance;
            const totalPremium = ins.yearlyPremium * (this.decision.years || 12);
            let totalDividend = 0;
            for (let y = 0; y < (this.decision.years || 12); y++) {
                totalDividend += ins.yearlyPremium * (ins.baseRate + ins.rateIncrement * y);
            }
            insuranceStats = {
                totalPremium, expectedTotalDividend: totalDividend,
                netCost: totalPremium - totalDividend,
                roi: ((totalDividend / totalPremium) * 100).toFixed(1),
            };
        }

        return {
            iterations, years: simulationYears,
            successRate, shrinkRate, bankruptcyRate,
            initialNetWorth: initialNW,
            medianNetWorth: p50, p10, p25, p50, p75, p90,
            medianPath, p10Path, p90Path,
            samplePaths: allPaths.slice(0, 20),
            stressLevel, stressLabel, retirementDelay, recommendation,
            expenseBreakdown, finalNetWorths, insuranceStats,
            detailedPaths, // P10/P50/P90 monthly breakdowns
            startAge: this.age,
            startYear: this.currentYear,
        };
    }
}

window.FinancialSimulator = FinancialSimulator;
