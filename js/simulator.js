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
        this.fireAgeOverride = config.fireAgeOverride || null;

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
                    // 1. Dividend payout
                    if (st.payoutSchedule && st.payoutSchedule.length > 0) {
                        const payout = st.payoutSchedule.find(p => p.month === monthInYear);
                        if (payout) {
                            // Dividend is cash generated based on current value and the specific month's yield
                            const dividendCash = st.priceNTD * st.shares * payout.yield;
                            stockDividendIncome += dividendCash;
                            dividendDetails.push({
                                symbol: st.symbol || st.shortName || '股票',
                                shares: st.shares,
                                priceNTD: st.priceNTD,
                                yield: payout.yield,
                                amount: dividendCash,
                            });
                        }
                    }

                    // 2. Price fluctuation (Capital Gain/Loss)
                    let annualMu = st.expectedReturn !== undefined ? st.expectedReturn : 0.08;
                    let annualVol = st.volatility || 0.25;

                    // Black Swan: Depression Scenario (First 10 years)
                    if (this.scenario === 'depression' && yearIndex < 10) {
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
            const totalEssentialExpenses = totalFixed + varResult.total + totalDebtPayment + decisionExpense;
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

            const totalExpenses = totalEssentialExpenses + totalDCAAmount;
            const cashFlow = totalIncome + insuranceDividend + stockDividendIncome - totalExpenses;

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
                        total: Math.round(totalExpenses),
                    },
                    netCashFlow: Math.round(cashFlow), // uses the calculated realized cash flow

                    cashBalance: Math.round(cashBalance),
                    stockValue: Math.round(getStockValue()),
                    liquidAssets: Math.round(cashBalance + getStockValue()),
                    debtRemaining: Math.round(getTotalDebtRemaining()),
                    netWorth: Math.round(netWorth),
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

        let recommendation;
        if (bankruptcyRate > 0.1) {
            recommendation = '❌ 嚴重警告：破產風險極高！模擬顯示在此決策下，你有超過 10% 的機率會陷入現金流斷絕且無資產可賣的境地。強烈建議大幅下修決策規模或直接放棄。';
        } else if (bankruptcyRate > 0) {
            recommendation = '⚠️ 警告：存在破產風險。雖然最終資產可能成長，但在過程中你會經歷數個月甚至數年的流動性負值，現實中可能導致毀約或法拍。建議增加緊急預備金。';
        } else if (successRate >= 0.8) {
            recommendation = '✅ 資產增長率良好且無破產紀錄。在此決策下，你的資產有高機率在模擬期間持續成長，財務相當穩健。';
        } else if (successRate >= 0.6) {
            recommendation = '🟡 中等風險。雖然沒有直接破產風險，但資產增長緩慢且有縮水機率。建議提升收入或降低非必要支出。';
        } else {
            recommendation = '🔶 風險偏高。雖然能撐過模擬期，但超過半數的情境顯示最終資產低於現狀，且現金流量吃緊。建議謹慎評估。';
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

        return {
            iterations, years: simulationYears,
            successRate, shrinkRate, bankruptcyRate,
            initialNetWorth: initialNW,
            medianNetWorth: p50, p10, p25, p75, p90,
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
