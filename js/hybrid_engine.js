/**
 * Hybrid Pledge Strategy Monte Carlo Simulation Engine
 * Strategy:
 * 1. Build a Collateral Portfolio (Main Engine), track its value and monthly DCA.
 * 2. Borrow a static amount against it at a specific loan rate.
 * 3. Invest the debt into a Reinvestment Portfolio (CF Engine).
 * 4. Yield from CF Engine pays Loan Interest + Monthly Expenses.
 * 5. Margin Call Check (e.g. 130%): If Collateral Value / Debt < 1.3, trigger margin call.
 */

class HybridSimulator {
    constructor(opts) {
        this.paths = opts.paths || 5000;
        this.years = opts.years || 30;
        this.months = this.years * 12;
        
        // Main Engine (Collateral)
        this.initialMainValue = opts.initialMainValue || 0;
        this.dcaMonthly = opts.dcaMonthly || 0;
        this.dcaInflation = opts.dcaInflation || 0.02; // DCA grows with inflation
        this.mainYieldAnnual = opts.mainYieldAnnual || 0.04;
        this.mainMuAnnual = opts.mainMuAnnual || 0.09;
        this.mainVolAnnual = opts.mainVolAnnual || 0.20;
        
        // CF Engine (Reinvestment)
        this.initialCfValue = opts.initialCfValue || 0; // usually = debt
        this.cfYieldAnnual = opts.cfYieldAnnual || 0.06;
        this.cfMuAnnual = opts.cfMuAnnual || 0.07;
        this.cfVolAnnual = opts.cfVolAnnual || 0.15;
        
        // Leverage & Rules
        this.initialDebt = opts.initialDebt || 0;
        this.loanRateAnnual = opts.loanRateAnnual || 0.0258;
        this.marginCallRatio = opts.marginCallRatio || 1.30;
        this.marginCallRestoreRatio = 1.40; // If called, liquidate to 140%
        
        // Lifestyle
        this.monthlyExpense = opts.monthlyExpense || 0;
        this.expenseInflation = opts.expenseInflation || 0.02;

        // Calc monthly params
        this.mu0 = this.mainMuAnnual / 12;
        this.vol0 = this.mainVolAnnual / Math.sqrt(12);
        this.yield0 = this.mainYieldAnnual / 12;

        this.mu1 = this.cfMuAnnual / 12;
        this.vol1 = this.cfVolAnnual / Math.sqrt(12);
        this.yield1 = this.cfYieldAnnual / 12;

        this.monthlyInterestRate = this.loanRateAnnual / 12;
    }

    randomNormal() {
        let u = 0, v = 0;
        while(u === 0) u = Math.random(); 
        while(v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    run(onProgress) {
        return new Promise((resolve) => {
            let bankruptHits = 0;
            let marginCallHits = 0;
            const finalNetWorths = [];
            const cashFlowBuckets = []; // To track how much surplus cash we amassed
            const medPathData = []; // Store median path history for charting

            // We generate 50-path batches to not block the main thread
            const batchSize = 100;
            let currentPath = 0;

            const nextBatch = () => {
                const end = Math.min(currentPath + batchSize, this.paths);
                
                for (let p = currentPath; p < end; p++) {
                    let mainVal = this.initialMainValue;
                    let cfVal = this.initialCfValue;
                    let debt = this.initialDebt;
                    
                    let pathMarginCalled = false;
                    let pathBankrupt = false;
                    let bankedCashFlow = 0; 
                    
                    let pathHistory = [];
                    // Keep track of inflation factors
                    let currentExpense = this.monthlyExpense;
                    let currentDCA = this.dcaMonthly;

                    for (let m = 1; m <= this.months; m++) {
                        // Inflation adjustments every 12 months (e.g. Month 13, 25...)
                        if (m > 1 && m % 12 === 1) {
                            currentExpense *= (1 + this.expenseInflation);
                            currentDCA *= (1 + this.dcaInflation);
                        }

                        // 1. Market returns
                        const ret0 = this.mu0 + this.vol0 * this.randomNormal();
                        const ret1 = this.mu1 + this.vol1 * this.randomNormal();
                        
                        mainVal *= (1 + ret0);
                        cfVal *= (1 + ret1);
                        
                        // 2. Yields generated this month
                        const mainDiv = mainVal * this.yield0;
                        const cfDiv = cfVal * this.yield1;
                        const totalDiv = mainDiv + cfDiv;
                        
                        // 3. DCA into Main Engine
                        mainVal += currentDCA;
                        
                        // 4. Interest Payment
                        const interest = debt * this.monthlyInterestRate;
                        
                        // 5. Cashflow Balance (Dividends - Interest - Living Expenses)
                        const netCashFlowThisMonth = totalDiv - interest - currentExpense;
                        bankedCashFlow += netCashFlowThisMonth;

                        // If banked cashflow is deeply negative, we must sell assets to cover expenses
                        if (bankedCashFlow < 0) {
                            let deficit = Math.abs(bankedCashFlow);
                            
                            // Sell from CF Engine first
                            if (cfVal >= deficit) {
                                cfVal -= deficit;
                                bankedCashFlow = 0;
                            } else {
                                deficit -= cfVal;
                                cfVal = 0;
                                
                                // Sell from Main Engine next
                                if (mainVal >= deficit) {
                                    mainVal -= deficit;
                                    bankedCashFlow = 0;
                                } else {
                                    // Bankrupt
                                    mainVal = 0;
                                    pathBankrupt = true;
                                    bankedCashFlow = -deficit; // Keep tracking the debt/deficit
                                }
                            }
                        }

                        // 6. Margin Call Check
                        // Only Main Engine serves as collateral. 
                        if (debt > 0 && mainVal > 0) {
                            const maintRatio = mainVal / debt;
                            if (maintRatio < this.marginCallRatio) {
                                pathMarginCalled = true;
                                // Need to sell Main Engine to reduce debt and restore to marginCallRestoreRatio
                                // Target: (MainVal - sell) / (Debt - sell) = 1.40
                                // MainVal - sell = 1.40*Debt - 1.40*sell
                                // 0.40*sell = 1.40*Debt - MainVal
                                // sell = (1.40*Debt - MainVal) / 0.40
                                
                                const targetRatio = this.marginCallRestoreRatio;
                                let sellAmount = (targetRatio * debt - mainVal) / (targetRatio - 1);
                                
                                // Can't sell more than we have
                                if (sellAmount > mainVal) sellAmount = mainVal;
                                
                                if (sellAmount > 0) {
                                    mainVal -= sellAmount;
                                    debt -= sellAmount;
                                }
                                
                                // If debt exceeds MainVal somehow (black swan), we are functionally bankrupt in collateral
                                if (debt > mainVal) {
                                    pathBankrupt = true;
                                }
                            }
                        }

                        pathHistory.push({
                            month: m,
                            mainVal,
                            cfVal,
                            debt,
                            bankedCashFlow,
                            netWorth: mainVal + cfVal - debt + bankedCashFlow
                        });
                    } // end month loop
                    
                    if (pathBankrupt) bankruptHits++;
                    if (pathMarginCalled) marginCallHits++;
                    
                    const netWorth = mainVal + cfVal - debt + bankedCashFlow;
                    finalNetWorths.push({ nw: netWorth, history: pathHistory });
                    cashFlowBuckets.push(bankedCashFlow);
                }

                currentPath = end;
                if (onProgress) onProgress(Math.round((currentPath / this.paths) * 100));

                if (currentPath < this.paths) {
                    setTimeout(nextBatch, 0); // yield to UI
                } else {
                    // Finalize stats
                    finalNetWorths.sort((a,b) => a.nw - b.nw);
                    cashFlowBuckets.sort((a,b) => a - b);
                    
                    const nw10 = finalNetWorths[Math.floor(this.paths * 0.10)].nw;
                    const nw50 = finalNetWorths[Math.floor(this.paths * 0.50)].nw;
                    const nw90 = finalNetWorths[Math.floor(this.paths * 0.90)].nw;
                    
                    const cf10 = cashFlowBuckets[Math.floor(this.paths * 0.10)];
                    const cf50 = cashFlowBuckets[Math.floor(this.paths * 0.50)];
                    
                    // Return the history of the median path for charting
                    const medianHistory = finalNetWorths[Math.floor(this.paths * 0.50)].history;

                    resolve({
                        bankruptRate: bankruptHits / this.paths,
                        marginCallRate: marginCallHits / this.paths,
                        nw10,
                        nw50,
                        nw90,
                        cf10,
                        cf50,
                        medianHistory,
                        paths: this.paths,
                        years: this.years
                    });
                }
            };

            nextBatch();
        });
    }
}

if (typeof window !== 'undefined') {
    window.HybridSimulator = HybridSimulator;
}
