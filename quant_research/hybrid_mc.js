const fs = require('fs');

/**
 * Hybrid Pledge Strategy Monte Carlo Simulation
 * Strategy:
 * 1. DCA into Main Engine (e.g. 0050) every month.
 * 2. Pledge Main Engine to borrow Cash at a low interest rate.
 * 3. Invest borrowed cash into Cash Flow Engine (e.g. 0056).
 * 4. Yield from Cash Flow Engine pays the Pledge Interest. 
 * 5. Margin Call Check (130%): If Main Engine value crashes and maintenance ratio < 1.3, liquidates both to cover debt.
 */

// ----------------- Parameters -----------------
const SIMULATION_YEARS = 55; // age 30 to 85
const MONTHS = SIMULATION_YEARS * 12;
const PATHS = 5000;

// Main Engine (0050)
const DCA_MONTHLY = 15000; // NTD
const MAIN_MU_ANNUAL = 0.09; // 9% expected total return
const MAIN_VOL_ANNUAL = 0.20; // 20% annualized volatility

// Cash Flow Engine (0056)
const CF_YIELD_ANNUAL = 0.065; // 6.5% dividend yield
const CF_MU_ANNUAL = 0.08; // 8% expected total return
const CF_VOL_ANNUAL = 0.15; // 15% volatility

// Leverage
const LOAN_RATE_ANNUAL = 0.0258; // 2.58% pledge interest rate
const PLEDGE_RATIO = 0.60; // Borrow 60% of Main Engine value
// We will statically pledge X amount or dynamically pledge as we grow?
// The user: "先把 8 張 0050 做質押... 退休時 0050 大到能質押一筆不小金額放進高股息"
// Let's assume an initial setup:
const INITIAL_MAIN_VALUE = 8 * 150000; // 8 shares * 150 (example) = 1,200,000 NTD
const INITIAL_DEBT = INITIAL_MAIN_VALUE * PLEDGE_RATIO; // 720,000 NTD
const INITIAL_CF_VALUE = INITIAL_DEBT; // Buy 0056 with the debt

const MARGIN_CALL_RATIO = 1.30; 

// Convert to monthly parameters
const mu0 = MAIN_MU_ANNUAL / 12;
const vol0 = MAIN_VOL_ANNUAL / Math.sqrt(12);

const mu1 = CF_MU_ANNUAL / 12;
const vol1 = CF_VOL_ANNUAL / Math.sqrt(12);

const monthlyInterestRate = LOAN_RATE_ANNUAL / 12;
const monthlyYieldRate = CF_YIELD_ANNUAL / 12;

// Box-Muller transformation for normal distribution
function randomNormal() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
}

function runSimulation() {
    let bankruptCount = 0;
    let marginCallHits = 0;
    
    let finalNetWorths = [];
    let netCashFlowPaths = [];
    
    for (let p = 0; p < PATHS; p++) {
        let mainVal = INITIAL_MAIN_VALUE;
        let cfVal = INITIAL_CF_VALUE;
        let debt = INITIAL_DEBT;
        
        let pathMarginCalled = false;
        let bankedCashFlow = 0; // accumulated surplus/deficit from dividends - interest
        
        for (let m = 1; m <= MONTHS; m++) {
            // Market movements
            const ret0 = mu0 + vol0 * randomNormal();
            const ret1 = mu1 + vol1 * randomNormal();
            
            mainVal *= (1 + ret0);
            cfVal *= (1 + ret1);
            
            // DCA into Main Engine
            mainVal += DCA_MONTHLY;
            
            if (debt > 0) {
                // Interest & Dividends
                const interest = debt * monthlyInterestRate;
                const div = cfVal * monthlyYieldRate;
                
                bankedCashFlow += (div - interest); // Surplus cash flow
                
                // Margin Call Check
                // Collateral is only the Main Engine (0050)
                const maintRatio = mainVal / debt;
                
                if (maintRatio < MARGIN_CALL_RATIO) {
                    pathMarginCalled = true;
                    // Liquidation logic to restore to 1.40
                    const targetRatio = 1.40;
                    let sellAmount = (targetRatio * debt - mainVal) / (targetRatio - 1);
                    
                    if (sellAmount > mainVal) sellAmount = mainVal;
                    
                    if (sellAmount > 0) {
                        mainVal -= sellAmount;
                        debt -= sellAmount;
                    }
                }
            }
        }
        
        if (pathMarginCalled) marginCallHits++;
        const netWorth = mainVal + cfVal - debt + bankedCashFlow;
        finalNetWorths.push(netWorth);
        netCashFlowPaths.push(bankedCashFlow);
    }
    
    // Stats
    finalNetWorths.sort((a,b) => a - b);
    const p10 = finalNetWorths[Math.floor(PATHS * 0.10)];
    const p50 = finalNetWorths[Math.floor(PATHS * 0.50)];
    const p90 = finalNetWorths[Math.floor(PATHS * 0.90)];
    
    const avgCashFlow = netCashFlowPaths.reduce((a,b) => a+b, 0) / PATHS;
    
    console.log("=== 雙引擎混合策略 55年 蒙地卡羅模擬 (5,000次) ===");
    console.log(`初始設定: 0050市值: $${INITIAL_MAIN_VALUE.toLocaleString()} | 初始質押: $${INITIAL_DEBT.toLocaleString()}`);
    console.log(`每月持續投入 (DCA): $${DCA_MONTHLY.toLocaleString()} 買入 0050`);
    console.log("------------------------------------------");
    console.log(`⚠️ 觸發至少一次 130% 斷頭追繳的機率: ${((marginCallHits/PATHS)*100).toFixed(2)}%`);
    console.log(`💵 最終累積剩餘「淨現金流」(息收 - 利息): $${Math.round(avgCashFlow).toLocaleString()}`);
    console.log(`📉 第10百分位 (悲觀): $${Math.round(p10).toLocaleString()}`);
    console.log(`🎯 第50百分位 (中位): $${Math.round(p50).toLocaleString()}`);
    console.log(`🚀 第90百分位 (樂觀): $${Math.round(p90).toLocaleString()}`);
}

runSimulation();
