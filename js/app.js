/**
 * Life Budget Simulator — Main App V3
 * 人生財務決策模擬器主應用
 */

(function () {
    'use strict';

    // ---- State ----
    const state = {
        currentStep: 0,
        totalSteps: 5,
        fixedExpenses: [
            { name: '房租/房貸', amount: 12000 },
            { name: '水電瓦斯', amount: 2000 },
        ],
        variableExpenses: [
            { name: '伙食', amount: 8000, fluctuation: 2000 },
            { name: '交通', amount: 3000, fluctuation: 1000 },
            { name: '娛樂', amount: 3000, fluctuation: 2000 },
        ],
        stocks: [], // [{symbol, shares, currentPrice, currency, exchangeName, volatility, shortName}]
        debts: [],  // [{name, totalRemaining, monthlyPayment, remainingPeriods}]
        selectedDecision: null,
        currentScenario: 'median', // for year timeline
        simulationResults: null,
    };

    const chartRenderer = new ChartRenderer();

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        bindHeroStart();
        renderFixedExpenses();
        renderVariableExpenses();
        renderStockList();
        renderDebtList();
        bindDecisionCards();
        bindNavigation();
        bindAddButtons();
        bindRestart();
        bindInsurancePreview();
        bindTimelineTabs();
        bindDataManagement();
    }

    // ---- Hero ----
    function bindHeroStart() {
        document.getElementById('btn-start')?.addEventListener('click', () => {
            document.getElementById('hero-section').style.display = 'none';
            document.getElementById('wizard-section').classList.add('active');
            showStep(0);
        });
    }

    // ---- Steps ----
    function showStep(index) {
        state.currentStep = index;
        document.querySelectorAll('.step-content').forEach((s, i) => {
            s.classList.toggle('active', i === index);
        });
        updateProgressBar();
        updateNavButtons();
    }

    function updateProgressBar() {
        document.querySelectorAll('.step-indicator').forEach((ind, i) => {
            ind.classList.remove('active', 'completed');
            if (i < state.currentStep) ind.classList.add('completed');
            else if (i === state.currentStep) ind.classList.add('active');
        });
        document.querySelectorAll('.step-label').forEach((lbl, i) => {
            lbl.classList.toggle('active', i === state.currentStep);
        });
        const line = document.getElementById('progress-line');
        if (line) line.style.width = (state.currentStep / (state.totalSteps - 1) * 100) + '%';
    }

    function updateNavButtons() {
        const prev = document.getElementById('btn-prev');
        const next = document.getElementById('btn-next');
        if (prev) prev.style.visibility = state.currentStep === 0 ? 'hidden' : 'visible';
        if (next) {
            next.textContent = state.currentStep === state.totalSteps - 1 ? '🚀 開始模擬' : '下一步 →';
        }
    }

    function bindNavigation() {
        document.getElementById('btn-prev')?.addEventListener('click', () => {
            if (state.currentStep > 0) showStep(state.currentStep - 1);
        });
        document.getElementById('btn-next')?.addEventListener('click', () => {
            if (state.currentStep < state.totalSteps - 1) showStep(state.currentStep + 1);
            else startSimulation();
        });
    }

    // ---- Fixed Expenses ----
    // ---- Fixed Expenses ----
    function renderFixedExpenses() {
        const c = document.getElementById('fixed-expense-list');
        if (!c) return;
        c.innerHTML = '';
        state.fixedExpenses.forEach((exp, i) => {
            const div = document.createElement('div');
            div.className = 'expense-item';
            div.style.flexWrap = 'wrap'; // allow form-groups to wrap

            // Build stock options
            let stockOptions = '<option value="">請選擇股票...</option>';
            state.stocks.forEach(st => {
                const isSelected = exp.targetStock === st.symbol ? 'selected' : '';
                stockOptions += `<option value="${st.symbol}" ${isSelected}>${st.shortName || st.symbol} (${st.symbol})</option>`;
            });

            // If no stocks added yet
            if (state.stocks.length === 0) {
                stockOptions = '<option value="">請先至「資產負債」新增股票</option>';
            }

            div.innerHTML = `
                <div class="form-group" style="min-width: 150px;">
                    <label class="form-label">項目名稱</label>
                    <input type="text" class="form-input" value="${exp.name}" data-field="fixed-name" data-index="${i}">
                </div>
                <div class="form-group" style="min-width: 120px;">
                    <label class="form-label">每月金額 (NT$)</label>
                    <input type="number" class="form-input" value="${exp.amount}" data-field="fixed-amount" data-index="${i}" min="0">
                </div>
                <div class="form-group dca-group" style="min-width: 100%; display: flex; align-items: center; gap: 10px; margin-top: 10px;">
                    <label style="font-size: 0.9rem; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; cursor: pointer;">
                        <input type="checkbox" data-field="fixed-is-investment" data-index="${i}" ${exp.isInvestment ? 'checked' : ''} style="accent-color: var(--accent-cyan);">
                        這是一筆定期定額投資嗎？
                    </label>
                    <select class="form-input" data-field="fixed-stock" data-index="${i}" style="display: ${exp.isInvestment ? 'block' : 'none'}; max-width: 200px; padding: 0.2rem 0.5rem;">
                        ${stockOptions}
                    </select>
                </div>
                <button class="btn-remove" data-index="${i}" style="position:absolute; top: 15px; right: 15px;">×</button>
            `;

            // Re-bind listeners
            div.querySelectorAll('input, select').forEach(input => {
                input.addEventListener('change', e => {
                    const idx = parseInt(e.target.dataset.index);
                    const field = e.target.dataset.field;

                    if (field === 'fixed-name') state.fixedExpenses[idx].name = e.target.value;
                    if (field === 'fixed-amount') state.fixedExpenses[idx].amount = parseFloat(e.target.value) || 0;
                    if (field === 'fixed-is-investment') {
                        state.fixedExpenses[idx].isInvestment = e.target.checked;
                        renderFixedExpenses(); // re-render to show/hide select
                    }
                    if (field === 'fixed-stock') state.fixedExpenses[idx].targetStock = e.target.value;
                });
            });

            div.querySelector('.btn-remove').addEventListener('click', () => {
                state.fixedExpenses.splice(i, 1);
                renderFixedExpenses();
            });
            c.appendChild(div);
        });
    }

    // ---- Variable Expenses ----
    function renderVariableExpenses() {
        const c = document.getElementById('variable-expense-list');
        if (!c) return;
        c.innerHTML = '';
        state.variableExpenses.forEach((exp, i) => {
            const div = document.createElement('div');
            div.className = 'expense-item expense-item-3col';
            div.innerHTML = `
                <div class="form-group">
                    <label class="form-label">項目名稱</label>
                    <input type="text" class="form-input" value="${exp.name}" data-field="var-name" data-index="${i}">
                </div>
                <div class="form-group">
                    <label class="form-label">平均月額 (NT$)</label>
                    <input type="number" class="form-input" value="${exp.amount}" data-field="var-amount" data-index="${i}" min="0">
                </div>
                <div class="form-group">
                    <label class="form-label">波動範圍 (NT$)</label>
                    <input type="number" class="form-input" value="${exp.fluctuation}" data-field="var-fluct" data-index="${i}" min="0">
                </div>
                <button class="btn-remove" data-index="${i}">×</button>
            `;
            div.querySelectorAll('input').forEach(input => {
                input.addEventListener('change', e => {
                    const idx = parseInt(e.target.dataset.index);
                    if (e.target.dataset.field === 'var-name') state.variableExpenses[idx].name = e.target.value;
                    if (e.target.dataset.field === 'var-amount') state.variableExpenses[idx].amount = parseFloat(e.target.value) || 0;
                    if (e.target.dataset.field === 'var-fluct') state.variableExpenses[idx].fluctuation = parseFloat(e.target.value) || 0;
                });
            });
            div.querySelector('.btn-remove').addEventListener('click', () => {
                state.variableExpenses.splice(i, 1);
                renderVariableExpenses();
            });
            c.appendChild(div);
        });
    }

    // ---- Stock Portfolio ----
    function renderStockList() {
        const c = document.getElementById('stock-list');
        if (!c) return;
        c.innerHTML = '';
        state.stocks.forEach((st, i) => {
            const div = document.createElement('div');
            div.className = 'stock-item';
            const priceDisplay = st.currentPrice > 0
                ? `${st.currency || ''} ${st.currentPrice.toFixed(2)}`
                : '尚未取得';
            const changeClass = (st.changePct || 0) >= 0 ? 'text-green' : 'text-red';

            // For older saves, default to 0.08 if expectedReturn isn't defined
            const expectedReturn = st.expectedReturn !== undefined ? st.expectedReturn : (st.cagr !== undefined ? st.cagr : 0.08);

            let volDisplay = st.volatility ? `歷史波動率 ${(st.volatility * 100).toFixed(1)}%` : '波動率 -';
            if (st.dataYears > 0) volDisplay += ` (基於 ${st.dataYears}年)`;

            let divDisplay = '';
            if (st.dividendYield > 0) {
                const monthsStr = (st.payoutSchedule || []).map(p => p.month).join(', ');
                divDisplay = `<span class="stock-vol" style="color:var(--accent-purple)">預估殖利率 ${(st.dividendYield * 100).toFixed(2)}% (配息月: ${monthsStr})</span>`;
            }

            div.innerHTML = `
                <div class="stock-row">
                    <div class="form-group" style="flex:1">
                        <label class="form-label">股票代號</label>
                        <input type="text" class="form-input" value="${st.symbol}" data-field="stock-symbol" data-index="${i}" placeholder="AAPL 或 2330.TW">
                    </div>
                    <div class="form-group" style="flex:0.7">
                        <label class="form-label">股數</label>
                        <input type="number" class="form-input" value="${st.shares}" data-field="stock-shares" data-index="${i}" min="0">
                    </div>
                    <div class="form-group" style="flex:0.7">
                        <label class="form-label">預期年報酬率 (%)</label>
                        <input type="number" class="form-input" value="${+(expectedReturn * 100).toFixed(2)}" data-field="stock-return" data-index="${i}" step="0.5">
                    </div>
                    <div class="form-group" style="flex:0.4">
                        <button class="btn btn-sm btn-secondary btn-fetch" data-index="${i}">🔍 查價</button>
                    </div>
                    <button class="btn-remove" data-index="${i}">×</button>
                </div>
                <div class="stock-info ${st.currentPrice > 0 ? '' : 'hidden'}" id="stock-info-${i}">
                    <span class="stock-name">${st.shortName || st.symbol}</span>
                    <span class="stock-price">${priceDisplay}</span>
                    <span class="${changeClass}">${st.changePct ? (st.changePct >= 0 ? '+' : '') + st.changePct + '%' : ''}</span>
                    <span class="stock-vol text-cyan">${st.cagr !== undefined ? `歷史年化(CAGR) ${(st.cagr * 100).toFixed(2)}%` : ''}</span>
                    <span class="stock-vol">${volDisplay}</span>
                    ${divDisplay}
                    <span class="stock-exchange">${st.exchangeName || ''}</span>
                </div>
            `;

            div.querySelectorAll('input').forEach(input => {
                input.addEventListener('change', e => {
                    const idx = parseInt(e.target.dataset.index);
                    if (e.target.dataset.field === 'stock-symbol') state.stocks[idx].symbol = e.target.value.toUpperCase();
                    if (e.target.dataset.field === 'stock-shares') state.stocks[idx].shares = parseFloat(e.target.value) || 0;
                    if (e.target.dataset.field === 'stock-return') state.stocks[idx].expectedReturn = (parseFloat(e.target.value) || 0) / 100;
                });
            });
            div.querySelector('.btn-fetch').addEventListener('click', () => fetchStockPrice(i));
            div.querySelector('.btn-remove').addEventListener('click', () => {
                state.stocks.splice(i, 1);
                renderStockList();
            });
            c.appendChild(div);
        });
    }

    async function fetchStockPrice(index) {
        const st = state.stocks[index];
        if (!st.symbol) return;

        const btn = document.querySelector(`[data-index="${index}"].btn-fetch`);
        if (btn) { btn.textContent = '⏳ 查詢中...'; btn.disabled = true; }

        try {
            const resp = await fetch(`/api/stock/${encodeURIComponent(st.symbol)}`);
            const data = await resp.json();

            if (data.error) {
                alert(`查價失敗：${data.error}`);
                return;
            }

            state.stocks[index] = {
                ...st,
                currentPrice: data.currentPrice,
                currency: data.currency,
                exchangeName: data.exchangeName,
                volatility: data.volatility,
                shortName: data.shortName,
                changePct: data.changePct,
                cagr: data.cagr,
                dataYears: data.dataYears,
                expectedReturn: data.cagr, // Set default expected return to the fetched historical CAGR
                dividendYield: data.dividendYield,
                payoutSchedule: data.payoutSchedule,
                exchangeRate: data.currency === 'TWD' ? 1 : 32, // default exchange rate for non-TWD
            };
            renderStockList();
        } catch (err) {
            alert('無法連線到伺服器，請確認 server.js 正在運行');
        } finally {
            if (btn) { btn.textContent = '🔍 查價'; btn.disabled = false; }
        }
    }

    // ---- Debt List ----
    function renderDebtList() {
        const c = document.getElementById('debt-list');
        if (!c) return;
        c.innerHTML = '';
        state.debts.forEach((d, i) => {
            const div = document.createElement('div');
            div.className = 'expense-item expense-item-4col';
            div.innerHTML = `
                <div class="form-group">
                    <label class="form-label">負債名稱</label>
                    <input type="text" class="form-input" value="${d.name}" data-field="debt-name" data-index="${i}" placeholder="信貸/車貸">
                </div>
                <div class="form-group">
                    <label class="form-label">剩餘金額 (NT$)</label>
                    <input type="number" class="form-input" value="${d.totalRemaining}" data-field="debt-total" data-index="${i}" min="0">
                </div>
                <div class="form-group">
                    <label class="form-label">每月還款 (NT$)</label>
                    <input type="number" class="form-input" value="${d.monthlyPayment}" data-field="debt-monthly" data-index="${i}" min="0">
                </div>
                <div class="form-group">
                    <label class="form-label">剩餘期數 (月)</label>
                    <input type="number" class="form-input" value="${d.remainingPeriods}" data-field="debt-periods" data-index="${i}" min="0">
                </div>
                <button class="btn-remove" data-index="${i}">×</button>
            `;
            div.querySelectorAll('input').forEach(input => {
                input.addEventListener('change', e => {
                    const idx = parseInt(e.target.dataset.index);
                    if (e.target.dataset.field === 'debt-name') state.debts[idx].name = e.target.value;
                    if (e.target.dataset.field === 'debt-total') state.debts[idx].totalRemaining = parseFloat(e.target.value) || 0;
                    if (e.target.dataset.field === 'debt-monthly') state.debts[idx].monthlyPayment = parseFloat(e.target.value) || 0;
                    if (e.target.dataset.field === 'debt-periods') state.debts[idx].remainingPeriods = parseInt(e.target.value) || 0;
                });
            });
            div.querySelector('.btn-remove').addEventListener('click', () => {
                state.debts.splice(i, 1);
                renderDebtList();
            });
            c.appendChild(div);
        });
    }

    // ---- Add Buttons ----
    function bindAddButtons() {
        document.getElementById('btn-add-fixed')?.addEventListener('click', () => {
            state.fixedExpenses.push({ name: '', amount: 0, isInvestment: false, targetStock: '' });
            renderFixedExpenses();
        });
        document.getElementById('btn-add-variable')?.addEventListener('click', () => {
            state.variableExpenses.push({ name: '', amount: 0, fluctuation: 0 });
            renderVariableExpenses();
        });
        document.getElementById('btn-add-stock')?.addEventListener('click', () => {
            state.stocks.push({ symbol: '', shares: 0, currentPrice: 0, currency: '', exchangeName: '', volatility: 0.25, shortName: '', changePct: 0, exchangeRate: 32 });
            renderStockList();
        });
        document.getElementById('btn-add-debt')?.addEventListener('click', () => {
            state.debts.push({ name: '', totalRemaining: 0, monthlyPayment: 0, remainingPeriods: 0 });
            renderDebtList();
        });
    }

    // ---- Decision Cards ----
    function bindDecisionCards() {
        const cards = document.querySelectorAll('.decision-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                cards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                state.selectedDecision = card.dataset.type;

                const generalForm = document.getElementById('decision-form');
                const insuranceForm = document.getElementById('insurance-form');
                const houseForm = document.getElementById('house-form');

                if (state.selectedDecision === 'insurance') {
                    if (generalForm) generalForm.style.display = 'none';
                    if (houseForm) houseForm.style.display = 'none';
                    if (insuranceForm) { insuranceForm.style.display = 'block'; updateInsurancePreview(); }
                } else if (state.selectedDecision === 'house') {
                    if (generalForm) generalForm.style.display = 'none';
                    if (insuranceForm) insuranceForm.style.display = 'none';
                    if (houseForm) houseForm.style.display = 'block';
                } else {
                    if (insuranceForm) insuranceForm.style.display = 'none';
                    if (houseForm) houseForm.style.display = 'none';
                    if (generalForm) generalForm.style.display = 'block';
                    const nameInput = document.getElementById('decision-name');
                    const names = { car: '購買車輛', business: '創業投資', custom: '自訂決策' };
                    if (nameInput) nameInput.value = names[state.selectedDecision] || '自訂決策';
                }
            });
        });
    }

    // ---- Insurance Preview ----
    function bindInsurancePreview() {
        ['ins-yearly-premium', 'ins-base-rate', 'ins-rate-increment', 'ins-years', 'ins-exchange-rate', 'ins-premium-currency'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.addEventListener('input', updateInsurancePreview); el.addEventListener('change', updateInsurancePreview); }
        });
    }

    function updateInsurancePreview() {
        const container = document.getElementById('ins-preview');
        if (!container) return;

        const yearlyPremium = parseFloat(document.getElementById('ins-yearly-premium').value) || 0;
        const currency = document.getElementById('ins-premium-currency').value;
        const baseRate = (parseFloat(document.getElementById('ins-base-rate').value) || 0) / 100;
        const rateIncrement = (parseFloat(document.getElementById('ins-rate-increment').value) || 0) / 100;
        const years = parseInt(document.getElementById('ins-years').value) || 12;
        const exchangeRate = parseFloat(document.getElementById('ins-exchange-rate').value) || 32;
        const sym = currency === 'USD' ? 'US$' : 'NT$';

        let totalPremium = 0, totalDividend = 0;
        let html = `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;color:var(--text-secondary)">
            <thead><tr style="border-bottom:1px solid var(--border-subtle)">
                <th style="text-align:left;padding:8px 4px">年份</th>
                <th style="text-align:right;padding:8px 4px">年繳本金</th>
                <th style="text-align:right;padding:8px 4px">分紅利率</th>
                <th style="text-align:right;padding:8px 4px">分紅回饋</th>
                <th style="text-align:right;padding:8px 4px">累計分紅</th>
            </tr></thead><tbody>`;

        for (let y = 0; y < years; y++) {
            const rate = baseRate + rateIncrement * y;
            const dividend = yearlyPremium * rate;
            totalPremium += yearlyPremium;
            totalDividend += dividend;
            html += `<tr style="border-bottom:1px solid rgba(124,58,237,0.08)">
                <td style="padding:6px 4px">第 ${y + 1} 年</td>
                <td style="text-align:right;padding:6px 4px">${sym} ${yearlyPremium.toLocaleString()}</td>
                <td style="text-align:right;padding:6px 4px;color:var(--accent-cyan)">${(rate * 100).toFixed(1)}%</td>
                <td style="text-align:right;padding:6px 4px;color:var(--accent-green)">${sym} ${Math.round(dividend).toLocaleString()}</td>
                <td style="text-align:right;padding:6px 4px">${sym} ${Math.round(totalDividend).toLocaleString()}</td>
            </tr>`;
        }

        const roi = totalPremium > 0 ? ((totalDividend / totalPremium) * 100).toFixed(1) : '0';
        html += `</tbody><tfoot><tr style="border-top:2px solid var(--border-accent);font-weight:600">
            <td style="padding:8px 4px">合計</td>
            <td style="text-align:right;padding:8px 4px">${sym} ${totalPremium.toLocaleString()}</td>
            <td></td>
            <td style="text-align:right;padding:8px 4px;color:var(--accent-green)">${sym} ${Math.round(totalDividend).toLocaleString()}</td>
            <td style="text-align:right;padding:8px 4px;color:var(--accent-purple)">ROI ${roi}%</td>
        </tr></tfoot></table>`;

        if (currency === 'USD') {
            const ntdT = totalPremium * exchangeRate, ntdD = totalDividend * exchangeRate;
            html += `<p style="margin-top:8px;font-size:0.8rem;color:var(--text-dim)">
                換算台幣：繳費 NT$ ${Math.round(ntdT).toLocaleString()} / 分紅 NT$ ${Math.round(ntdD).toLocaleString()} / 月支出約 NT$ ${Math.round(ntdT / years / 12).toLocaleString()}
            </p>`;
        }
        container.innerHTML = html;
    }

    // ---- Timeline Tabs ----
    function bindTimelineTabs() {
        document.querySelectorAll('.timeline-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.timeline-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.currentScenario = tab.dataset.scenario;
                if (state.simulationResults) renderYearTimeline(state.simulationResults);
            });
        });
    }

    // ---- Sync all inputs ----
    function syncAllInputs() {
        document.querySelectorAll('[data-field="fixed-name"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.fixedExpenses[idx]) state.fixedExpenses[idx].name = input.value;
        });
        document.querySelectorAll('[data-field="fixed-amount"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.fixedExpenses[idx]) state.fixedExpenses[idx].amount = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="fixed-is-investment"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.fixedExpenses[idx]) state.fixedExpenses[idx].isInvestment = input.checked;
        });
        document.querySelectorAll('[data-field="fixed-stock"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.fixedExpenses[idx]) state.fixedExpenses[idx].targetStock = input.value;
        });
        document.querySelectorAll('[data-field="var-name"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.variableExpenses[idx]) state.variableExpenses[idx].name = input.value;
        });
        document.querySelectorAll('[data-field="var-amount"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.variableExpenses[idx]) state.variableExpenses[idx].amount = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="var-fluct"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.variableExpenses[idx]) state.variableExpenses[idx].fluctuation = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="debt-name"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.debts[idx]) state.debts[idx].name = input.value;
        });
        document.querySelectorAll('[data-field="debt-total"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.debts[idx]) state.debts[idx].totalRemaining = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="debt-monthly"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.debts[idx]) state.debts[idx].monthlyPayment = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="debt-periods"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.debts[idx]) state.debts[idx].remainingPeriods = parseInt(input.value) || 0;
        });
        document.querySelectorAll('[data-field="stock-symbol"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.stocks[idx]) state.stocks[idx].symbol = input.value.toUpperCase();
        });
        document.querySelectorAll('[data-field="stock-shares"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.stocks[idx]) state.stocks[idx].shares = parseFloat(input.value) || 0;
        });
        document.querySelectorAll('[data-field="stock-return"]').forEach(input => {
            const idx = parseInt(input.dataset.index);
            if (state.stocks[idx]) state.stocks[idx].expectedReturn = (parseFloat(input.value) || 0) / 100;
        });
    }

    // ---- Simulation ----
    function startSimulation() {
        const income = parseFloat(document.getElementById('income').value) || 0;
        const age = parseInt(document.getElementById('age').value) || 25;
        const retireAge = parseInt(document.getElementById('retire-age').value) || 65;
        const raiseRate = parseFloat(document.getElementById('raise-rate').value) / 100 || 0.03;
        const bonusMonths = parseFloat(document.getElementById('bonus-months').value) || 0;
        const savings = parseFloat(document.getElementById('savings').value) || 0;

        syncAllInputs();

        // Build decision
        let decision = null;
        if (state.selectedDecision === 'insurance') {
            const yearlyPremium = parseFloat(document.getElementById('ins-yearly-premium').value) || 0;
            const currency = document.getElementById('ins-premium-currency').value;
            const baseRate = (parseFloat(document.getElementById('ins-base-rate').value) || 0) / 100;
            const rateIncrement = (parseFloat(document.getElementById('ins-rate-increment').value) || 0) / 100;
            const years = parseInt(document.getElementById('ins-years').value) || 12;
            const exchangeRate = parseFloat(document.getElementById('ins-exchange-rate').value) || 32;
            const yearlyPremiumNTD = currency === 'USD' ? yearlyPremium * exchangeRate : yearlyPremium;
            decision = {
                type: 'insurance', name: document.getElementById('ins-name')?.value || '分紅保單',
                monthlyCost: 0, upfrontCost: 0, years,
                insurance: { yearlyPremium: yearlyPremiumNTD, baseRate, rateIncrement, originalCurrency: currency, exchangeRate, originalYearlyPremium: yearlyPremium },
            };
        } else if (state.selectedDecision === 'house') {
            decision = {
                type: 'house', name: document.getElementById('house-name')?.value || '購買房產',
                housePrice: parseFloat(document.getElementById('house-price').value) || 0,
                appreciationRate: parseFloat(document.getElementById('house-appreciation').value) / 100 || 0,
                upfrontCost: parseFloat(document.getElementById('house-upfront').value) || 0,
                monthlyCost: parseFloat(document.getElementById('house-monthly').value) || 0,
                years: parseInt(document.getElementById('house-years').value) || 30,
            };
        } else if (state.selectedDecision) {
            decision = {
                type: state.selectedDecision, name: document.getElementById('decision-name')?.value || '決策',
                monthlyCost: parseFloat(document.getElementById('decision-monthly').value) || 0,
                upfrontCost: parseFloat(document.getElementById('decision-upfront').value) || 0,
                years: parseInt(document.getElementById('decision-years').value) || 10,
            };
        }

        const config = {
            income, age, retireAge, bonusMonths,
            currentYear: new Date().getFullYear(),
            fixedExpenses: state.fixedExpenses.filter(e => e.amount > 0),
            variableExpenses: state.variableExpenses.filter(e => e.amount > 0),
            savings,
            debts: state.debts.filter(d => d.totalRemaining > 0),
            stocks: state.stocks.filter(s => s.shares > 0 && s.currentPrice > 0),
            decision,
            annualRaiseRate: raiseRate,
        };

        if (income <= 0) { alert('請輸入月收入'); showStep(0); return; }

        document.getElementById('wizard-section').classList.remove('active');
        document.getElementById('simulation-loading').classList.add('active');

        setTimeout(() => {
            const simulator = new FinancialSimulator(config);
            const results = simulator.runSimulation(5000);
            state.simulationResults = results;
            document.getElementById('simulation-loading').classList.remove('active');
            displayResults(results, config);
        }, 1500);
    }

    // ---- Display Results ----
    function displayResults(results) {
        const section = document.getElementById('results-section');
        section.classList.add('active');

        const rateEl = document.getElementById('success-rate-num');
        animateNumber(rateEl, 0, Math.round(results.successRate * 100), 1200);

        const rate = results.successRate;
        rateEl.style.color = rate >= 0.7 ? 'var(--accent-green)' : rate >= 0.4 ? 'var(--accent-yellow)' : 'var(--accent-red)';

        const stressBadge = document.getElementById('stress-badge');
        stressBadge.className = `stress-badge ${results.stressLevel}`;
        stressBadge.textContent = `財務壓力：${results.stressLabel}`;

        setStatValue('stat-shrink', (results.shrinkRate * 100).toFixed(1) + '%',
            results.shrinkRate < 0.2 ? 'text-green' : results.shrinkRate < 0.5 ? 'text-yellow' : 'text-red');
        setStatValue('stat-median', 'NT$ ' + fmtCur(results.medianNetWorth),
            results.medianNetWorth >= results.initialNetWorth ? 'text-green' : 'text-red');
        setStatValue('stat-retire-delay', results.retirementDelay + ' 年',
            results.retirementDelay <= 1 ? 'text-green' : results.retirementDelay <= 3 ? 'text-yellow' : 'text-red');
        setStatValue('stat-iterations', results.iterations.toLocaleString(), 'text-purple');

        document.getElementById('recommendation-text').textContent = results.recommendation;

        const initialNW = results.initialNetWorth;
        const growth = results.medianNetWorth - initialNW;
        const growthPct = initialNW > 0 ? ((growth / initialNW) * 100).toFixed(1) : 'N/A';
        document.getElementById('recommendation-details').innerHTML = `
            <div class="recommendation-detail"><span class="dot" style="background:${rate >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)'}"></span>
                資產增長成功率 ${Math.round(rate * 100)}%（初始 NT$ ${fmtCur(initialNW)} → 中位數 NT$ ${fmtCur(results.medianNetWorth)}）</div>
            <div class="recommendation-detail"><span class="dot" style="background:var(--accent-cyan)"></span>
                中位數資產成長 ${growthPct}%（${growth >= 0 ? '+' : ''}NT$ ${fmtCur(growth)}）</div>
            <div class="recommendation-detail"><span class="dot" style="background:var(--accent-purple)"></span>
                樂觀資產 NT$ ${fmtCur(results.p90)}</div>
            <div class="recommendation-detail"><span class="dot" style="background:var(--accent-yellow)"></span>
                保守資產 NT$ ${fmtCur(results.p10)}</div>
        `;

        // Insurance stats
        const insSection = document.getElementById('insurance-stats-section');
        if (results.insuranceStats) {
            insSection.style.display = 'block';
            setStatValue('stat-ins-total-premium', 'NT$ ' + fmtCur(results.insuranceStats.totalPremium), 'text-red');
            setStatValue('stat-ins-total-dividend', 'NT$ ' + fmtCur(results.insuranceStats.expectedTotalDividend), 'text-green');
            setStatValue('stat-ins-net-cost', 'NT$ ' + fmtCur(results.insuranceStats.netCost),
                results.insuranceStats.netCost > 0 ? 'text-red' : 'text-green');
            setStatValue('stat-ins-roi', results.insuranceStats.roi + '%',
                parseFloat(results.insuranceStats.roi) > 50 ? 'text-green' : 'text-yellow');
        } else {
            insSection.style.display = 'none';
        }

        chartRenderer.destroyAll();
        chartRenderer.renderSuccessRate('chart-success', results.successRate);
        chartRenderer.renderCashFlow('chart-cashflow', results);
        chartRenderer.renderDistribution('chart-distribution', results.finalNetWorths);
        chartRenderer.renderExpenseBreakdown('chart-expense', results.expenseBreakdown);

        // Year timeline
        renderYearTimeline(results);

        section.scrollIntoView({ behavior: 'smooth' });
    }

    // ---- Year-by-Year Timeline ----
    function renderYearTimeline(results) {
        const container = document.getElementById('year-timeline');
        if (!container) return;
        container.innerHTML = '';

        const scenario = state.currentScenario;
        const path = results.detailedPaths[scenario];
        if (!path || !path.monthlyDetails) return;

        const details = path.monthlyDetails;
        const years = results.years;
        const scenarioLabel = { optimistic: '🟢 樂觀', median: '📊 中位數', pessimistic: '🔴 保守' }[scenario];

        for (let y = 0; y < years; y++) {
            const yearMonths = details.filter(m => m.yearIndex === y);
            if (yearMonths.length === 0) continue;

            const lastMonth = yearMonths[yearMonths.length - 1];
            const firstMonth = yearMonths[0];
            const yearIncome = yearMonths.reduce((s, m) => s + m.income.total, 0);
            const yearExpense = yearMonths.reduce((s, m) => s + m.expenses.total, 0);
            const yearNet = yearIncome - yearExpense;

            const yearDiv = document.createElement('div');
            yearDiv.className = 'year-card';

            yearDiv.innerHTML = `
                <div class="year-header" data-year="${y}">
                    <div class="year-left">
                        <span class="year-badge">${lastMonth.calendarYear}</span>
                        <span class="year-age">${lastMonth.age} 歲</span>
                    </div>
                    <div class="year-center">
                        <span class="year-stat">收入 <span class="text-green">NT$ ${fmtCur(yearIncome)}</span></span>
                        <span class="year-stat">支出 <span class="text-red">NT$ ${fmtCur(yearExpense)}</span></span>
                        <span class="year-stat">淨值 <span class="${lastMonth.netWorth >= firstMonth.netWorth ? 'text-green' : 'text-red'}">NT$ ${fmtCur(lastMonth.netWorth)}</span></span>
                    </div>
                    <div class="year-right">
                        <span class="year-expand">▸</span>
                    </div>
                </div>
                <div class="year-detail" id="year-detail-${y}" style="display: none;">
                    ${renderMonthTable(yearMonths)}
                </div>
            `;

            yearDiv.querySelector('.year-header').addEventListener('click', () => {
                const detail = document.getElementById(`year-detail-${y}`);
                const expand = yearDiv.querySelector('.year-expand');
                if (detail.style.display === 'none') {
                    detail.style.display = 'block';
                    expand.textContent = '▾';
                    yearDiv.classList.add('expanded');
                } else {
                    detail.style.display = 'none';
                    expand.textContent = '▸';
                    yearDiv.classList.remove('expanded');
                }
            });

            container.appendChild(yearDiv);
        }
    }

    function renderMonthTable(months) {
        let html = `<div class="month-table-wrapper"><table class="month-table">
            <thead><tr>
                <th>月份</th><th>薪資</th><th>獎金</th><th>保單分紅</th><th>配息收入</th><th>未實現損益</th>
                <th>固定支出</th><th>變動支出</th><th>貸款還款</th><th>決策支出</th>
                <th>淨現金流</th><th>淨資產</th>
            </tr></thead><tbody>`;

        for (const m of months) {
            const cf = m.netCashFlow;

            // Build tooltips for exact breakdown
            const fixedDetails = Object.entries(m.expenses.fixed)
                .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
                .join('\n');
            const varDetails = Object.entries(m.expenses.variable)
                .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
                .join('\n');
            const debtDetails = Object.entries(m.expenses.debts)
                .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
                .join('\n');

            let decisionTooltip = '';
            if (m.expenses.decision > 0) {
                decisionTooltip = `${m.expenses.decisionName || '決策/保險支出'}: ${m.expenses.decision.toLocaleString()}`;
            }

            let stockDetails = "股價未實現漲跌";
            if (m.stockList && m.stockList.length > 0) {
                stockDetails = "【當月持股明細】\n" + m.stockList.map(st =>
                    `[${st.symbol}] 股價: ${st.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | 股數: ${st.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} | 市值: ${fmtCur(st.value)}`
                ).join('\n');
            }

            html += `<tr>
                <td>${m.monthInYear} 月</td>
                <td class="text-green" title="本薪">${fmtCur(m.income.salary)}</td>
                <td class="${m.income.bonus > 0 ? 'text-yellow' : ''}" title="年終">${m.income.bonus > 0 ? fmtCur(m.income.bonus) : '-'}</td>
                <td class="${m.income.insuranceDividend > 0 ? 'text-yellow' : ''}" title="保單年度分紅">${m.income.insuranceDividend > 0 ? fmtCur(m.income.insuranceDividend) : '-'}</td>
                <td class="${m.income.stockDividendIncome > 0 ? 'text-green' : ''}" title="現金股利">${m.income.stockDividendIncome > 0 ? fmtCur(m.income.stockDividendIncome) : '-'}</td>
                <td class="${m.income.stockReturn >= 0 ? 'text-green' : 'text-red'}" title="${stockDetails}">${m.income.stockReturn !== 0 ? fmtCur(m.income.stockReturn) : '-'}</td>
                <td class="text-red" title="${fixedDetails}">${fmtCur(m.expenses.totalFixed)}</td>
                <td class="text-red" title="${varDetails}">${fmtCur(m.expenses.totalVariable)}</td>
                <td class="${m.expenses.totalDebt > 0 ? 'text-red' : ''}" title="${debtDetails}">${m.expenses.totalDebt > 0 ? fmtCur(m.expenses.totalDebt) : '-'}</td>
                <td class="${m.expenses.decision > 0 ? 'text-red' : ''}" title="${decisionTooltip}">${m.expenses.decision > 0 ? fmtCur(m.expenses.decision) : '-'}</td>
                <td class="${cf >= 0 ? 'text-green' : 'text-red'}" style="font-weight:600">${cf >= 0 ? '+' : ''}${fmtCur(cf)}</td>
                <td style="font-weight:600">${fmtCur(m.netWorth)}</td>
            </tr>`;

            // Show variable expense breakdown on hover/tooltip via title
        }

        html += `</tbody></table></div>`;

        // Variable expense breakdown as sub-section
        const firstMonth = months[0];
        if (firstMonth) {
            html += `<div class="month-detail-sub">
                <strong>💡 小提示：</strong>將游標移到「固定支出」、「變動支出」、「貸款還款」或「決策支出」的數字上停留，即可看到該月的詳細項目與金額。
            </div>`;
        }

        return html;
    }

    // ---- Helpers ----
    function setStatValue(id, value, colorClass) {
        const el = document.getElementById(id);
        if (el) {
            el.querySelector('.stat-value').textContent = value;
            el.querySelector('.stat-value').className = 'stat-value ' + (colorClass || '');
        }
    }

    function fmtCur(val) {
        if (val === undefined || val === null) return '0';
        // Removed abbreviation to "萬/億" dynamically based on user request for precise numbers
        return Math.round(val).toLocaleString('zh-TW');
    }

    function animateNumber(el, from, to, duration) {
        const start = performance.now();
        function update(time) {
            const elapsed = time - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(from + (to - from) * eased);
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    function bindRestart() {
        document.getElementById('btn-restart')?.addEventListener('click', () => {
            document.getElementById('results-section').classList.remove('active');
            document.getElementById('wizard-section').classList.add('active');
            showStep(0);
            chartRenderer.destroyAll();
            state.simulationResults = null;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---- Data Management (Export/Import config & Export CSV) ----
    function bindDataManagement() {
        const btnExportConfig = document.getElementById('btn-export-config');
        const inputImportConfig = document.getElementById('import-config-file');
        const btnExportCsv = document.getElementById('btn-export-csv');

        // Export Config (JSON)
        btnExportConfig?.addEventListener('click', (e) => {
            e.preventDefault();
            // Gather current inputs from Step 0 and Step 4
            const configToSave = {
                income: document.getElementById('income').value,
                bonusMonths: document.getElementById('bonus-months').value,
                age: document.getElementById('age').value,
                retireAge: document.getElementById('retire-age').value,
                raiseRate: document.getElementById('raise-rate').value,
                savings: document.getElementById('savings').value,
                state: {
                    fixedExpenses: state.fixedExpenses,
                    variableExpenses: state.variableExpenses,
                    stocks: state.stocks,
                    debts: state.debts
                }
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(configToSave, null, 2));
            const anchor = document.createElement('a');
            anchor.setAttribute("href", dataStr);
            anchor.setAttribute("download", `life_budget_config_${new Date().toISOString().slice(0, 10)}.json`);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        });

        // Import Config (JSON)
        inputImportConfig?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const loadedConfig = JSON.parse(event.target.result);

                    // Restore Step 0 & 4 Inputs
                    if (loadedConfig.income) document.getElementById('income').value = loadedConfig.income;
                    if (loadedConfig.bonusMonths) document.getElementById('bonus-months').value = loadedConfig.bonusMonths;
                    if (loadedConfig.age) document.getElementById('age').value = loadedConfig.age;
                    if (loadedConfig.retireAge) document.getElementById('retire-age').value = loadedConfig.retireAge;
                    if (loadedConfig.raiseRate) document.getElementById('raise-rate').value = loadedConfig.raiseRate;
                    if (loadedConfig.savings) document.getElementById('savings').value = loadedConfig.savings;

                    // Restore State arrays
                    if (loadedConfig.state) {
                        state.fixedExpenses = loadedConfig.state.fixedExpenses || [];
                        state.variableExpenses = loadedConfig.state.variableExpenses || [];
                        state.stocks = loadedConfig.state.stocks || [];
                        state.debts = loadedConfig.state.debts || [];

                        // Re-render UI lists
                        renderFixedExpenses();
                        renderVariableExpenses();
                        renderStockList();
                        renderDebtList();
                    }

                    alert('設定已成功載入！');
                } catch (err) {
                    console.error('Failed to parse config:', err);
                    alert('讀取設定檔失敗，請確認檔案格式是否正確。');
                }
                // clear input so same file can be loaded again if needed
                inputImportConfig.value = "";
            };
            reader.readAsText(file);
        });

        // Export CSV
        btnExportCsv?.addEventListener('click', (e) => {
            e.preventDefault();
            if (!state.simulationResults || !state.simulationResults.detailedPaths) {
                alert('請先執行模擬才能匯出結果。');
                return;
            }

            const scenario = state.currentScenario; // 'median', 'optimistic', 'pessimistic'
            const path = state.simulationResults.detailedPaths[scenario];
            if (!path || !path.monthlyDetails) return;

            const scenarioName = { 'median': '中位數', 'optimistic': '樂觀', 'pessimistic': '保守' }[scenario];
            let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // Include BOM for Excel UTF-8

            // Header row
            csvContent += "年齡,年份,月份,薪資,獎金,保單分紅,現金股利,未實現損益,固定支出,變動支出,貸款還款,決策支出,淨現金流,現金存款,股票市值,負債餘額,總淨資產\n";

            // Data rows
            path.monthlyDetails.forEach(m => {
                const row = [
                    m.age,
                    m.calendarYear,
                    m.monthInYear,
                    m.income.salary,
                    m.income.bonus,
                    m.income.insuranceDividend || 0,
                    m.income.stockDividendIncome || 0,
                    m.income.stockReturn !== 0 ? m.income.stockReturn : 0,
                    m.expenses.totalFixed,
                    m.expenses.totalVariable,
                    m.expenses.totalDebt,
                    m.expenses.decision,
                    m.netCashFlow,
                    m.cashBalance,
                    m.stockValue,
                    m.debtRemaining,
                    m.netWorth
                ];
                csvContent += row.join(",") + "\n";
            });

            const anchor = document.createElement('a');
            anchor.setAttribute("href", encodeURI(csvContent));
            anchor.setAttribute("download", `life_budget_simulation_${scenarioName}_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        });
    }

})();
