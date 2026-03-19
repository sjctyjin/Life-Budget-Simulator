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
        this.decision = config.decision;
        this.annualRaiseRate = config.annualRaiseRate || 0.03;
        this.inflationRate = config.inflationRate || 0.02;
        this.insuranceSurrenderYear = config.insuranceSurrenderYear || null; // dynamic surrender year
        this.perpetualDividend = config.perpetualDividend || false; // whether insurance dividend continues indefinitely
        this.endAge = config.endAge || 85;
        this.fireAge = config.fireAge || 35;
        this.fireAgeOverride = config.fireAgeOverride || null;
        this.enableSWR = config.enableSWR !== false; // Default to true

        // Pre-calculate baseline values (if any)
        // this.precalculatedIncome = this.getYearlyIncome(); // This line was in the diff but seems to be a placeholder or incomplete. Keeping it commented out as it's not a valid method call here.

        this.bonusMonths = config.bonusMonths || 0; // year-end bonus in months of salary
        this.scenario = config.scenario || 'normal'; // 'normal' or 'depression'

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
        // For perpetual: after the payment term, keep paying at the final year's rate
        if (yearIndex >= years) {
            if (this.decision.perpetualDividend) {
                const finalRate = ins.baseRate + ins.rateIncrement * (years - 1);
                return ins.yearlyPremium * finalRate;
            }
            return 0;
        }
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
        const liquidateStocks = (amountNeeded, record = []) => {
            if (amountNeeded <= 0) return 0;
            let amountRaised = 0;
            for (const st of activeStocks) {
                if (amountRaised >= amountNeeded) break;
                if (st.shares > 0 && st.priceNTD > 0) {
                    const value = st.shares * st.priceNTD;
                    const stillNeeded = amountNeeded - amountRaised;
                    if (value <= stillNeeded) {
                        amountRaised += value;
                        record.push({
                            symbol: st.symbol || st.shortName || '未命名',
                            shares: st.shares,
                            value: value
                        });
                        st.shares = 0;
                    } else {
                        const sharesToSell = stillNeeded / st.priceNTD;
                        st.shares -= sharesToSell;
                        amountRaised += stillNeeded;
                        record.push({
                            symbol: st.symbol || st.shortName || '未命名',
                            shares: sharesToSell,
                            value: stillNeeded
                        });
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
        let consecutiveNegativeLiquidAssets = 0;

        let yearlyIncomeForTax = 0;
        let previousYearIncomeForTax = 0;

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

                // --- SURRENDER CASH INJECTION ---
                if (isInsurance && this.insuranceSurrenderYear && yearIndex === this.insuranceSurrenderYear) {
                    // Inject the total premium paid back into cash balance as surrender value
                    const ins = this.decision.insurance;
                    const yearsPaid = Math.min(this.decision.years, this.insuranceSurrenderYear);
                    const totalPaid = ins.yearlyPremium * yearsPaid;
                    cashBalance += totalPaid;
                }
            }

            // --- INCOME ---
            const effectiveRetireAge = this.fireAgeOverride !== null ? this.fireAgeOverride : this.retireAge;
            const salaryIncome = currentAge < effectiveRetireAge ? monthlyIncome : 0;
            let bonusIncome = 0;
            if (monthInYear === 12 && this.bonusMonths > 0 && currentAge < effectiveRetireAge) {
                bonusIncome = monthlyIncome * this.bonusMonths;
            }
            const totalIncome = salaryIncome + bonusIncome;

            // Track Income for Tax Purposes
            yearlyIncomeForTax += totalIncome;
            if (monthInYear === 12) {
                previousYearIncomeForTax = yearlyIncomeForTax;
                yearlyIncomeForTax = 0;
            }

            // --- FIXED EXPENSES & TAX ---
            const fixedItems = {};
            let totalFixed = 0;

            // Income Tax Calculation (Deducted in May)
            if (monthInYear === 5 && previousYearIncomeForTax > 0) {
                // Simplified 2024 Taiwan Tax Brackets (Single, no dependents)
                const exemptionAndDeduction = 423000;
                let netTaxable = Math.max(0, previousYearIncomeForTax - exemptionAndDeduction);
                let taxPaid = 0;

                if (netTaxable > 0) {
                    if (netTaxable <= 590000) {
                        taxPaid = netTaxable * 0.05;
                    } else if (netTaxable <= 1330000) {
                        taxPaid = netTaxable * 0.12 - 41300;
                    } else if (netTaxable <= 2660000) {
                        taxPaid = netTaxable * 0.20 - 147700;
                    } else if (netTaxable <= 4980000) {
                        taxPaid = netTaxable * 0.30 - 413700;
                    } else {
                        taxPaid = netTaxable * 0.40 - 911700;
                    }
                }
                if (taxPaid > 0) {
                    const roundedTax = Math.round(taxPaid);
                    fixedItems['綜合所得稅 (上年度)'] = roundedTax;
                    totalFixed += roundedTax;
                }
            }

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

            let decisionExpense = 0;
            let insuranceDividend = 0;

            // Surrender Check
            const isSurrendered = this.insuranceSurrenderYear && yearIndex >= this.insuranceSurrenderYear;

            // Pay premium logic
            if (month <= decisionYears * 12) {
                if (isInsurance) {
                    // Only pay if not surrendered early (though typically surrender happens after term)
                    if (!isSurrendered) {
                        decisionExpense = insuranceMonthlyPremium;
                    }
                } else if (isHouse) {
                    decisionExpense = houseMonthlyMortgage;
                } else {
                    decisionExpense = decisionMonthlyCost;
                }
            }

            // Dividend logic (can be perpetual)
            if (isInsurance && !isSurrendered) {
                // Pay dividend if we are in the payment term, OR if perpetual dividend is enabled
                if (month <= decisionYears * 12 || this.decision.perpetualDividend) {
                    if (monthInYear === 12) {
                        insuranceDividend = this.getInsuranceDividendForYear(yearIndex);
                        totalInsuranceDividends += insuranceDividend;
                    }
                }
            }

            // --- STOCK RETURNS & DIVIDENDS ---
            let stockReturn = 0; // Unrealized gain/loss this month
            let stockDividendIncome = 0; // Realized cash dividend this month
            const stockReturnItems = {};
            const dividendDetails = []; // Per-stock dividend breakdown
            for (const st of activeStocks) {
                if (st.shares > 0 && st.priceNTD > 0) {
                    if (st.payoutSchedule && st.payoutSchedule.length > 0) {
                        const payout = st.payoutSchedule.find(p => p.month === monthInYear);
                        if (payout) {
                            // Dividend is cash generated based on current simulated value and the specific month's yield
                            // Because priceNTD fluctuates via Monte Carlo, the effective amountPerShare fluctuates accordingly
                            const currentAmountPerShare = st.priceNTD * payout.yield;
                            const dividendCash = currentAmountPerShare * st.shares;
                            stockDividendIncome += dividendCash;
                            dividendDetails.push({
                                symbol: st.symbol || st.shortName || '股票',
                                shares: st.shares,
                                priceNTD: st.priceNTD,
                                yield: payout.yield,
                                amountPerShare: currentAmountPerShare,
                                amount: dividendCash,
                            });
                        }
                    }

                    // 2. Price fluctuation (Capital Gain/Loss)
                    let annualMu = st.expectedReturn !== undefined ? st.expectedReturn : 0.08;
                    let annualVol = st.volatility || 0.25;

                    // Safe Withdrawal Rate (SWR) De-risking post-retirement
                    if (this.enableSWR && currentAge >= effectiveRetireAge) {
                        annualMu = 0.04; // 4% conservative return (Bonds/Fixed Income)
                        annualVol = 0.06; // 6% low volatility
                    } else if (this.scenario === 'depression' && yearIndex < 10) {
                        // Black Swan: Depression Scenario (First 10 years)
                        annualMu = -0.15; // 15% drop per year
                        annualVol = 0.40; // 40% high volatility
                    }

                    const monthlyVol = annualVol / Math.sqrt(12);
                    const monthlyMu = annualMu / 12;
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

            // --- NET CASH FLOW (PRE-INVESTMENT) ---
            // The user considers DCA as a fixed expense. It is already in `totalFixed`.
            // We temporarily exclude it to see how much cash we actually have to invest.
            let intendedDCA = 0;
            for (const e of this.fixedExpenses) {
                if (e.isInvestment && e.targetStock) {
                    intendedDCA += Math.round(e.amount * inflationFactor);
                }
            }

            const totalEssentialExpenses = totalFixed - intendedDCA + varResult.total + totalDebtPayment + decisionExpense;
            const preInvestmentCashFlow = totalIncome + insuranceDividend + stockDividendIncome - totalEssentialExpenses;

            cashBalance += preInvestmentCashFlow;

            // --- SMART DOLLAR-COST AVERAGING (DCA) ---
            // Only invest if we still have cash after essential expenses
            let totalDCAAmount = 0;
            const dcaItems = [];
            const skippedDCA = [];

            for (const e of this.fixedExpenses) {
                if (e.isInvestment && e.targetStock) {
                    const amountToInvest = Math.round(e.amount * inflationFactor);
                    const targetSt = activeStocks.find(s => s.symbol === e.targetStock);

                    if (targetSt && targetSt.priceNTD > 0 && cashBalance >= amountToInvest) {
                        const sharesBought = amountToInvest / targetSt.priceNTD;
                        targetSt.shares += sharesBought;
                        cashBalance -= amountToInvest;
                        totalDCAAmount += amountToInvest;
                        dcaItems.push({ name: e.name, amount: amountToInvest });
                    } else if (e.isInvestment) {
                        skippedDCA.push({ name: e.name, amount: amountToInvest });
                    }
                }
            }

            // --- FINAL CASH BALANCE ADJUSTMENT (LIQUIDATION) ---
            const liquidations = [];
            if (cashBalance < 0) {
                const raised = liquidateStocks(-cashBalance, liquidations);
                cashBalance += raised;
            }

            // totalExpenses for display includes DCA as it is part of totalFixed.
            const totalExpensesForUI = totalFixed + varResult.total + totalDebtPayment + decisionExpense;
            // cashFlow is the exact change in cash buffer for the month (Income - Essential - Actually Invested DCA)
            const cashFlow = totalIncome + insuranceDividend + stockDividendIncome - totalEssentialExpenses - totalDCAAmount;

            // Net worth is cash + stocks (updated prices) + propertyValue - debt
            const currentStockValue = getStockValue();
            const currentLiquidAssets = cashBalance + currentStockValue;
            netWorth = cashBalance + currentStockValue + propertyValue - getTotalDebtRemaining();
            netWorthPath.push(netWorth);

            // --- REALISTIC BANKRUPTCY CHECK ---
            // Bankruptcy occurs if even after selling all stocks, you remain in debt for too long
            // Or if you hit a massive debt floor that no one would lend you.
            if (currentLiquidAssets < 0) {
                consecutiveNegativeLiquidAssets++;
            } else {
                consecutiveNegativeLiquidAssets = 0;
            }

            if (!bankrupt) {
                if (currentLiquidAssets < -500000 || consecutiveNegativeLiquidAssets >= 6) {
                    bankrupt = true;
                    bankruptMonth = month;
                    // In a realistic sim, we break here because you're evicted/bankrupt
                    break;
                }
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
                        dividendDetails,
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
                        total: Math.round(totalExpensesForUI),
                    },
                    netCashFlow: Math.round(cashFlow), // uses the calculated realized cash flow

                    cashBalance: Math.round(cashBalance),
                    stockValue: Math.round(currentStockValue),
                    liquidAssets: Math.round(currentLiquidAssets),
                    debtRemaining: Math.round(getTotalDebtRemaining()),
                    netWorth: Math.round(netWorth),
                    totalAssets: Math.round(cashBalance + currentStockValue + propertyValue),
                    leverageRatio: netWorth > 0 ? (Math.round(((cashBalance + currentStockValue + propertyValue) / netWorth) * 100) / 100) : 0,
                    debtToLiquidRatio: currentLiquidAssets > 0 ? Math.round((getTotalDebtRemaining() / currentLiquidAssets) * 100) : 999,
                    liquidations: liquidations,
                    skippedDCA: skippedDCA,
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
        // Extend simulation to endAge (default 85)
        const yearsToEnd = Math.max(this.endAge - this.age, 10);
        const simulationYears = Math.min(yearsToEnd, 100); // cap at 100 years max

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
        // Success Criteria: 1. Did not go bankrupt. 2. Final Net Worth >= Initial Net Worth
        const successCount = results.filter(r => !r.bankrupt && r.finalNetWorth >= initialNW).length;
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

        // === RUN 300 DETAILED PATHS for representative scenarios ===
        // Higher candidate count ensure better fit for P10/P50/P90
        const detailedCandidates = [];
        for (let i = 0; i < 300; i++) {
            const r = this.simulateOnePath(simulationYears, true);
            detailedCandidates.push(r);
        }
        detailedCandidates.sort((a, b) => a.finalNetWorth - b.finalNetWorth);

        const calculateMSE = (path, targetCurve) => {
            let sumSquareError = 0;
            const len = Math.min(path.length, targetCurve.length);
            for (let i = 0; i < len; i++) {
                // Weight the error: later years are often larger in scale, 
                // but we care about the "shape" of the curve.
                // Log scale or normalized diff could be used, but simple MSE is usually sufficient
                // if we normalize by the target value to avoid late-game bias.
                const diff = (path[i] - targetCurve[i]);
                sumSquareError += (diff * diff);
            }
            return sumSquareError / len;
        };

        const findClosest = (targetCurve) => {
            let best = detailedCandidates[0];
            let minMSE = Infinity;
            for (const c of detailedCandidates) {
                const mse = calculateMSE(c.netWorthPath, targetCurve);
                if (mse < minMSE) {
                    minMSE = mse;
                    best = c;
                }
            }
            return best;
        };

        const detailedPaths = {
            pessimistic: findClosest(p10Path),
            median: findClosest(medianPath),
            optimistic: findClosest(p90Path),
        };

        // Stress & recommendation
        let stressLevel, stressLabel;
        if (bankruptcyRate >= 0.15) {
            stressLevel = 'critical'; stressLabel = '極高 (高度破產風險)';
        } else if (bankruptcyRate > 0.05 || successRate < 0.5) {
            stressLevel = 'high'; stressLabel = '高 (有破產風險)';
        } else if (bankruptcyRate > 0 || successRate < 0.7) {
            stressLevel = 'medium'; stressLabel = '中 (需注意現金流)';
        } else {
            stressLevel = 'low'; stressLabel = '低 (財務穩健)';
        }

        const monthlyNetIncome = this.income - this.getTotalFixedExpenses() -
            this.variableExpenses.reduce((s, e) => s + e.amount, 0) -
            this.debts.reduce((s, d) => s + d.monthlyPayment, 0);
        const decisionTotalCost = (this.decision?.monthlyCost || 0) * (this.decision?.years || 0) * 12 +
            (this.decision?.upfrontCost || 0);
        const retirementDelay = monthlyNetIncome > 0 ? Math.round(decisionTotalCost / (monthlyNetIncome * 12)) : 0;

        // Calculate Required Income Gap (Feature 28)
        let incomeNeeded = 0;
        if (bankruptcyRate > 0 || p50 < initialNW) {
            // Logic 1: Cumulative deficit until the crash
            const minLiquid = Math.min(...(detailedPaths.median.monthlyDetails.map(m => m.liquidAssets)));
            let gapToSurvival = 0;
            if (minLiquid < 0) {
                const monthAtMin = detailedPaths.median.monthlyDetails.findIndex(m => m.liquidAssets === minLiquid);
                gapToSurvival = Math.ceil(Math.abs(minLiquid) / (monthAtMin || 1));
            }

            // Logic 2: Cumulative deficit until the end of simulation to maintain initial net worth
            const finalGap = Math.max(0, initialNW - p50);
            const gapToSustainability = Math.ceil(finalGap / (simulationYears * 12));

            // Logic 3: Current burn rate (if the last year is negative)
            let gapToCashFlowPositive = 0;
            const lastYearMonths = detailedPaths.median.monthlyDetails.slice(-12);
            if (lastYearMonths.length > 0) {
                const yearlyNet = lastYearMonths.reduce((sum, m) => sum + m.netCashFlow, 0);
                if (yearlyNet < 0) {
                    gapToCashFlowPositive = Math.ceil(Math.abs(yearlyNet) / 12);
                }
            }

            // We suggest the maximum of these to be truly safe
            incomeNeeded = Math.max(gapToSurvival, gapToSustainability, gapToCashFlowPositive);
        }

        // Detect Leverage Risk (Feature 27)
        const earlyLeverage = detailedPaths.median.monthlyDetails.slice(0, 120).map(m => m.leverageRatio);
        const maxEarlyLeverage = Math.max(...earlyLeverage);

        // Feature 30: FIRE Accelerator Suggestion
        const annualEssentialExp = (this.getTotalFixedExpenses() + this.variableExpenses.reduce((s, e) => s + e.amount, 0)) * 12;
        const leanFireTarget = annualEssentialExp * 25;
        const currentAge = this.age;
        // Use the user-defined target age for FIRE
        let targetAge = this.fireAge;
        let acceleratorAdvice = "";

        console.log(`[FIRE Accelerator] Target: ${leanFireTarget}, Current Age: ${currentAge}, Target Age: ${targetAge}`);

        if (targetAge > currentAge) {
            const fireMonth = detailedPaths.median.monthlyDetails.findIndex(m => m.netWorth >= leanFireTarget);
            const targetMonthIndex = (targetAge - currentAge) * 12;

            console.log(`[FIRE Accelerator] fireMonth: ${fireMonth}, targetMonthIndex: ${targetMonthIndex}`);

            // If we don't hit FIRE by targetAge or don't hit it at all
            if (fireMonth === -1 || fireMonth > targetMonthIndex) {
                const nwAtTarget = detailedPaths.median.monthlyDetails[targetMonthIndex]?.netWorth || 0;
                const gap = leanFireTarget - nwAtTarget;

                console.log(`[FIRE Accelerator] nwAtTarget: ${nwAtTarget}, gap: ${gap}`);

                if (gap > 0) {
                    // Future Value of Annuity Formula: FV = PMT * [((1 + r)^n - 1) / r]
                    let weightedExpectedReturn = 0.08; // default 8%
                    let totalVal = 0;
                    let weightedSum = 0;
                    for (const st of this.stocks) {
                        const val = st.priceNTD * st.shares;
                        totalVal += val;
                        weightedSum += val * (st.expectedReturn !== undefined ? st.expectedReturn : 0.08);
                    }
                    if (totalVal > 0) {
                        weightedExpectedReturn = weightedSum / totalVal;
                    } else if (this.stocks.length > 0) {
                        weightedExpectedReturn = this.stocks.reduce((acc, st) => acc + (st.expectedReturn !== undefined ? st.expectedReturn : 0.08), 0) / this.stocks.length;
                    }

                    const r = weightedExpectedReturn / 12; // monthly rate
                    const n = targetMonthIndex;
                    if (r > 0 && n > 0) {
                        const factor = (Math.pow(1 + r, n) - 1) / r;
                        const extraMonthly = Math.ceil(gap / factor);
                        acceleratorAdvice = `\n\n🏎️ 加速建議：若想在 ${targetAge} 歲提早達成「基礎提領目標 (NT$ ${Math.round(leanFireTarget).toLocaleString()})」，建議每月需額外再投入約 NT$ ${extraMonthly.toLocaleString()} 元進入股市投資 (以預期年化報酬率 ${(weightedExpectedReturn * 100).toFixed(1)}% 計算)。`;
                        console.log(`[FIRE Accelerator] Suggestion: ${extraMonthly}, r: ${r}`);
                    }
                }
            } else {
                console.log(`[FIRE Accelerator] Condition not met: fireMonth ${fireMonth} <= targetMonthIndex ${targetMonthIndex}`);
            }
        }

        let recommendation;
        if (bankruptcyRate > 0.1) {
            recommendation = `❌ 嚴重警告：破產風險極高 (${(bankruptcyRate * 100).toFixed(1)}%)！模擬顯示在此決策下，你有超過一成的機率會陷入現金流斷絕。強烈建議大幅下修決策規模。`;
        } else if (bankruptcyRate > 0) {
            const displayRate = (bankruptcyRate * 100) < 0.1 ? 0.1 : (bankruptcyRate * 100);
            const extraIncomeText = incomeNeeded > 0 ? `建議至少增加 NT$ ${incomeNeeded.toLocaleString()} 元的月收入，或` : '建議';
            recommendation = `⚠️ 警告：存在破產風險 (${displayRate.toFixed(1)}%)。雖然結果可能不錯，但過程中流動性極度吃緊。${extraIncomeText}增加緊急預備金來抵禦風險。`;
        } else if (successRate >= 0.8) {
            recommendation = '✅ 資產增長率良好且無破產紀錄。在此決策下，你的資產有高機率在模擬期間持續成長，財務相當穩健。';
        } else if (successRate >= 0.6) {
            recommendation = '🟡 中等風險。雖然沒有直接破產風險，但資產增長緩慢且有縮水機率。建議提升收入或降低非必要支出。';
        } else {
            recommendation = '🔶 風險偏高。雖然能撐過模擬期，但超過半數的情境顯示最終資產低於現狀，且現金流量吃緊。建議謹慎評估。';
        }

        if (maxEarlyLeverage > 5) {
            recommendation += `\n\n🔎 槓桿風險：模擬前期槓桿倍率高達 ${maxEarlyLeverage.toFixed(1)}x，這意味著你的脆弱性很高，任何微小的股市回檔或收入中斷都可能導致崩盤。建議在前期增加保險或預備金。`;
        }

        if (bankruptcyRate > 0 && incomeNeeded > 0) {
            recommendation += `\n\n💡 改善建議：若要讓此財務模型達成「收支平衡且不破產」，你每月至少需要再額外創造出 NT$ ${incomeNeeded.toLocaleString()} 元的淨現金流（包含加薪、兼職或節流）。`;
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
            const surrenderYear = this.insuranceSurrenderYear || simulationYears;
            const dividendEndYear = Math.min(surrenderYear, simulationYears);

            const yearsPaid = Math.min(this.decision.years || 12, dividendEndYear);
            const totalPremium = ins.yearlyPremium * yearsPaid;

            let totalDividend = 0;
            for (let y = 0; y < dividendEndYear; y++) {
                totalDividend += this.getInsuranceDividendForYear(y);
            }
            insuranceStats = {
                totalPremium, expectedTotalDividend: totalDividend,
                netCost: totalPremium - totalDividend,
                roi: totalPremium > 0 ? ((totalDividend / totalPremium) * 100).toFixed(1) : '0',
            };
        }

        // Lean FIRE: 25x annual essential expenses (already calculated as leanFireTarget)
        const fatFireTarget = annualEssentialExp * 40;

        const leanFireProb = results.filter(r => Math.max(...r.netWorthPath) >= leanFireTarget).length / iterations;
        const fatFireProb = results.filter(r => Math.max(...r.netWorthPath) >= fatFireTarget).length / iterations;

        const findAgeHitTarget = (path, target) => {
            for (let i = 0; i < path.length; i++) {
                if (path[i] >= target) {
                    return this.age + Math.floor(i / 12);
                }
            }
            return null; // Never hits target in this path
        };

        const milestones = {
            leanFireTarget: Math.round(leanFireTarget),
            fatFireTarget: Math.round(fatFireTarget),
            leanFireProb,
            fatFireProb,
            leanFireAge: findAgeHitTarget(medianPath, leanFireTarget),
            fatFireAge: findAgeHitTarget(medianPath, fatFireTarget),
        };

        return {
            iterations, years: simulationYears,
            successRate, shrinkRate, bankruptcyRate,
            initialNetWorth: initialNW,
            medianNetWorth: p50, p10, p25, p75, p90,
            medianPath, p10Path, p90Path,
            samplePaths: allPaths.slice(0, 20),
            stressLevel, stressLabel, retirementDelay, recommendation, acceleratorAdvice,
            expenseBreakdown, finalNetWorths, insuranceStats,
            detailedPaths, // P10/P50/P90 monthly breakdowns
            milestones, // FIRE targets and probabilities
            startAge: this.age,
            startYear: this.currentYear,
        };
    }
}

window.FinancialSimulator = FinancialSimulator;
