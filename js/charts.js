/**
 * Chart Renderer
 * 使用 Chart.js 繪製財務模擬圖表
 */

class ChartRenderer {
    constructor() {
        this.charts = {};
        this.colors = {
            primary: '#7c3aed',
            primaryLight: 'rgba(124, 58, 237, 0.3)',
            secondary: '#06b6d4',
            secondaryLight: 'rgba(6, 182, 212, 0.3)',
            success: '#10b981',
            successLight: 'rgba(16, 185, 129, 0.3)',
            danger: '#ef4444',
            dangerLight: 'rgba(239, 68, 68, 0.3)',
            warning: '#f59e0b',
            warningLight: 'rgba(245, 158, 11, 0.3)',
            text: '#e2e8f0',
            textDim: '#94a3b8',
            grid: 'rgba(148, 163, 184, 0.1)',
            palette: [
                '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
                '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#6366f1',
                '#84cc16', '#e879f9',
            ]
        };
    }

    destroyAll() {
        Object.values(this.charts).forEach(c => c.destroy());
        this.charts = {};
    }

    formatCurrency(val) {
        if (Math.abs(val) >= 1e8) return (val / 1e8).toFixed(1) + ' 億';
        if (Math.abs(val) >= 1e4) return (val / 1e4).toFixed(0) + ' 萬';
        return val.toLocaleString('zh-TW');
    }

    /**
     * Success Rate Doughnut Chart
     */
    renderSuccessRate(canvasId, successRate) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (this.charts[canvasId]) this.charts[canvasId].destroy();

        const rate = Math.round(successRate * 100);
        const color = rate >= 70 ? this.colors.success : rate >= 40 ? this.colors.warning : this.colors.danger;

        this.charts[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['成功', '失敗'],
                datasets: [{
                    data: [rate, 100 - rate],
                    backgroundColor: [color, 'rgba(30, 30, 60, 0.5)'],
                    borderColor: ['transparent', 'transparent'],
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '78%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                },
                animation: {
                    animateRotate: true,
                    duration: 1500,
                }
            }
        });
    }

    /**
     * Cash Flow Trend Line Chart
     */
    renderCashFlow(canvasId, results, baselineResults) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (this.charts[canvasId]) this.charts[canvasId].destroy();

        const months = results.medianPath.length;
        // Show yearly labels
        const labels = [];
        for (let i = 0; i < months; i++) {
            if (i % 12 === 0) labels.push(`第 ${i / 12} 年`);
            else labels.push('');
        }

        const datasets = [
            {
                label: '樂觀 (P90)',
                data: results.p90Path.map((v, i) => window.deflate ? window.deflate(v, i / 12) : v),
                borderColor: this.colors.success,
                backgroundColor: this.colors.successLight,
                fill: false,
                borderWidth: 1.5,
                pointRadius: 0,
                borderDash: [4, 2],
            },
            {
                label: '中位數 (P50)',
                data: results.medianPath.map((v, i) => window.deflate ? window.deflate(v, i / 12) : v),
                borderColor: this.colors.primary,
                backgroundColor: this.colors.primaryLight,
                fill: false,
                borderWidth: 2.5,
                pointRadius: 0,
            },
            {
                label: '保守 (P10)',
                data: results.p10Path.map((v, i) => window.deflate ? window.deflate(v, i / 12) : v),
                borderColor: this.colors.danger,
                backgroundColor: this.colors.dangerLight,
                fill: false,
                borderWidth: 1.5,
                pointRadius: 0,
                borderDash: [4, 2],
            },
        ];

        if (baselineResults && baselineResults.medianPath) {
            datasets.push({
                label: '⚖️ 比較基準 (中位數)',
                data: baselineResults.medianPath.map((v, i) => window.deflate ? window.deflate(v, i / 12) : v),
                borderColor: this.colors.textDim,
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 2,
                pointRadius: 0,
                borderDash: [5, 5],
            });
        }

        if (results.milestones) {
            const leanFIREData = Array(months).fill().map((_, i) => window.deflate ? window.deflate(results.milestones.leanFireTarget, i / 12) : results.milestones.leanFireTarget);
            datasets.push({
                label: '🎯 基礎退休目標',
                data: leanFIREData,
                borderColor: '#FF9800',
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 1.5,
                pointRadius: 0,
                borderDash: [3, 3],
            });

            const fatFIREData = Array(months).fill().map((_, i) => window.deflate ? window.deflate(results.milestones.fatFireTarget, i / 12) : results.milestones.fatFireTarget);
            datasets.push({
                label: '🌴 寬裕退休目標',
                data: fatFIREData,
                borderColor: '#2196F3',
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 1.5,
                pointRadius: 0,
                borderDash: [3, 3],
            });
        }

        const self = this;
        this.charts[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        labels: { color: this.colors.text, font: { size: 12 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 35, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(124, 58, 237, 0.3)',
                        borderWidth: 1,
                        callbacks: {
                            label: function (ctx) {
                                return ctx.dataset.label + ': NT$ ' + self.formatCurrency(ctx.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: this.colors.textDim,
                            maxTicksLimit: 15,
                            callback: function (val, index) {
                                const label = this.getLabelForValue(val);
                                return label || null;
                            }
                        },
                        grid: { color: this.colors.grid },
                    },
                    y: {
                        ticks: {
                            color: this.colors.textDim,
                            callback: function (val) {
                                return 'NT$ ' + self.formatCurrency(val);
                            }
                        },
                        grid: { color: this.colors.grid },
                    }
                }
            }
        });
    }

    /**
     * Final Net Worth Distribution Histogram
     */
    renderDistribution(canvasId, finalNetWorths, years = 40) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (this.charts[canvasId]) this.charts[canvasId].destroy();

        // Deflate if active
        const adjustedNW = finalNetWorths.map(val => window.deflate ? window.deflate(val, years) : val);

        // Create histogram bins
        const min = Math.min(...adjustedNW);
        const max = Math.max(...adjustedNW);
        const binCount = 30;
        const binWidth = (max - min) / binCount || 1;
        const bins = new Array(binCount).fill(0);

        for (const val of adjustedNW) {
            let idx = Math.floor((val - min) / binWidth);
            if (idx >= binCount) idx = binCount - 1;
            if (idx < 0) idx = 0;
            bins[idx]++;
        }

        const labels = [];
        const barColors = [];
        for (let i = 0; i < binCount; i++) {
            const binStart = min + i * binWidth;
            labels.push(this.formatCurrency(Math.round(binStart)));
            barColors.push(binStart >= 0 ? this.colors.primary : this.colors.danger);
        }

        const self = this;
        this.charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: '模擬次數',
                    data: bins,
                    backgroundColor: barColors.map(c => c + '99'),
                    borderColor: barColors,
                    borderWidth: 1,
                    borderRadius: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 35, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        callbacks: {
                            title: function (items) {
                                return 'NT$ ' + items[0].label;
                            },
                            label: function (ctx) {
                                return ctx.raw + ' 次模擬';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: this.colors.textDim,
                            maxTicksLimit: 8,
                            maxRotation: 0,
                        },
                        grid: { display: false },
                    },
                    y: {
                        ticks: { color: this.colors.textDim },
                        grid: { color: this.colors.grid },
                    }
                }
            }
        });
    }

    /**
     * Monthly Expense Breakdown Pie Chart
     */
    renderExpenseBreakdown(canvasId, expenseBreakdown) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        if (this.charts[canvasId]) this.charts[canvasId].destroy();

        const labels = Object.keys(expenseBreakdown);
        const data = Object.values(expenseBreakdown);

        const self = this;
        this.charts[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: this.colors.palette.slice(0, labels.length).map(c => c + 'cc'),
                    borderColor: this.colors.palette.slice(0, labels.length),
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '40%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: this.colors.text,
                            font: { size: 12 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 15, 35, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        callbacks: {
                            label: function (ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((ctx.raw / total) * 100).toFixed(1);
                                return `NT$ ${self.formatCurrency(ctx.raw)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
}

window.ChartRenderer = ChartRenderer;
