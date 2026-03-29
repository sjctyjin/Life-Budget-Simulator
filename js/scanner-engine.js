/**
 * 🧠 Scanner Engine — Multi-Factor Stock Decision Engine
 * Pure calculation module, no DOM operations.
 * 
 * Contains:
 * - TechnicalCalculator: MA, RSI, KD, MACD, Bollinger, ATR, VolumeRatio, S/R
 * - FactorScorer: 5-factor scoring (Trend, Momentum, Flow, Fundamental, Sentiment)
 * - StrategyAdvisor: Classification + entry/exit/position advice
 */

const ScannerEngine = (() => {
    'use strict';

    // ==================== Technical Calculator ====================
    const TC = {
        /**
         * Simple Moving Average
         */
        calcMA(closes, period) {
            const result = [];
            for (let i = 0; i < closes.length; i++) {
                if (i < period - 1) { result.push(null); continue; }
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) sum += closes[j];
                result.push(Math.round((sum / period) * 100) / 100);
            }
            return result;
        },

        /**
         * RSI (Relative Strength Index)
         */
        calcRSI(closes, period = 14) {
            const result = new Array(closes.length).fill(null);
            if (closes.length < period + 1) return result;

            let gainSum = 0, lossSum = 0;
            for (let i = 1; i <= period; i++) {
                const diff = closes[i] - closes[i - 1];
                if (diff > 0) gainSum += diff; else lossSum -= diff;
            }
            let avgGain = gainSum / period;
            let avgLoss = lossSum / period;
            result[period] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;

            for (let i = period + 1; i < closes.length; i++) {
                const diff = closes[i] - closes[i - 1];
                const gain = diff > 0 ? diff : 0;
                const loss = diff < 0 ? -diff : 0;
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
                result[i] = avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
            }
            return result;
        },

        /**
         * KD (Stochastic Oscillator)
         */
        calcKD(highs, lows, closes, period = 9) {
            const len = closes.length;
            const K = new Array(len).fill(null);
            const D = new Array(len).fill(null);
            let prevK = 50, prevD = 50;

            for (let i = 0; i < len; i++) {
                if (i < period - 1) continue;
                let highestHigh = -Infinity, lowestLow = Infinity;
                for (let j = i - period + 1; j <= i; j++) {
                    if (highs[j] > highestHigh) highestHigh = highs[j];
                    if (lows[j] < lowestLow) lowestLow = lows[j];
                }
                const RSV = highestHigh === lowestLow ? 50 : ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
                const k = (2 / 3) * prevK + (1 / 3) * RSV;
                const d = (2 / 3) * prevD + (1 / 3) * k;
                K[i] = Math.round(k * 100) / 100;
                D[i] = Math.round(d * 100) / 100;
                prevK = k;
                prevD = d;
            }
            return { K, D };
        },

        /**
         * MACD
         */
        calcMACD(closes, fast = 12, slow = 26, signal = 9) {
            const len = closes.length;
            const macdLine = new Array(len).fill(null);
            const signalLine = new Array(len).fill(null);
            const histogram = new Array(len).fill(null);

            // EMA helper
            function ema(data, period) {
                const result = new Array(data.length).fill(null);
                const k = 2 / (period + 1);
                let emaPrev = null;
                for (let i = 0; i < data.length; i++) {
                    if (data[i] === null) continue;
                    if (emaPrev === null) { emaPrev = data[i]; result[i] = data[i]; continue; }
                    emaPrev = data[i] * k + emaPrev * (1 - k);
                    result[i] = emaPrev;
                }
                return result;
            }

            const emaFast = ema(closes, fast);
            const emaSlow = ema(closes, slow);

            for (let i = 0; i < len; i++) {
                if (emaFast[i] !== null && emaSlow[i] !== null) {
                    macdLine[i] = Math.round((emaFast[i] - emaSlow[i]) * 100) / 100;
                }
            }

            const sigArr = ema(macdLine, signal);
            for (let i = 0; i < len; i++) {
                if (macdLine[i] !== null && sigArr[i] !== null) {
                    signalLine[i] = Math.round(sigArr[i] * 100) / 100;
                    histogram[i] = Math.round((macdLine[i] - signalLine[i]) * 100) / 100;
                }
            }

            return { macdLine, signalLine, histogram };
        },

        /**
         * Bollinger Bands
         */
        calcBollingerBands(closes, period = 20, stdDev = 2) {
            const len = closes.length;
            const upper = new Array(len).fill(null);
            const middle = new Array(len).fill(null);
            const lower = new Array(len).fill(null);
            const bandwidth = new Array(len).fill(null);

            for (let i = period - 1; i < len; i++) {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) sum += closes[j];
                const mean = sum / period;

                let sqSum = 0;
                for (let j = i - period + 1; j <= i; j++) sqSum += Math.pow(closes[j] - mean, 2);
                const std = Math.sqrt(sqSum / period);

                middle[i] = Math.round(mean * 100) / 100;
                upper[i] = Math.round((mean + stdDev * std) * 100) / 100;
                lower[i] = Math.round((mean - stdDev * std) * 100) / 100;
                bandwidth[i] = mean > 0 ? Math.round(((upper[i] - lower[i]) / mean) * 10000) / 10000 : 0;
            }
            return { upper, middle, lower, bandwidth };
        },

        /**
         * ATR (Average True Range)
         */
        calcATR(highs, lows, closes, period = 14) {
            const len = closes.length;
            const result = new Array(len).fill(null);
            const tr = [];

            for (let i = 0; i < len; i++) {
                if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
                tr.push(Math.max(
                    highs[i] - lows[i],
                    Math.abs(highs[i] - closes[i - 1]),
                    Math.abs(lows[i] - closes[i - 1])
                ));
            }

            if (tr.length >= period) {
                let sum = 0;
                for (let i = 0; i < period; i++) sum += tr[i];
                result[period - 1] = Math.round((sum / period) * 100) / 100;
                for (let i = period; i < len; i++) {
                    result[i] = Math.round(((result[i - 1] * (period - 1) + tr[i]) / period) * 100) / 100;
                }
            }
            return result;
        },

        /**
         * Volume Ratio (current vol / avg vol)
         */
        calcVolumeRatio(volumes, period = 20) {
            const len = volumes.length;
            const result = new Array(len).fill(null);
            for (let i = period - 1; i < len; i++) {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) sum += volumes[j];
                const avg = sum / period;
                result[i] = avg > 0 ? Math.round((volumes[i] / avg) * 100) / 100 : 0;
            }
            return result;
        },

        /**
         * Find support and resistance levels
         */
        findSupportResistance(highs, lows, closes, lookback = 60) {
            const len = closes.length;
            const start = Math.max(0, len - lookback);
            const currentPrice = closes[len - 1];

            // Find swing highs and lows
            const levels = [];
            for (let i = start + 2; i < len - 2; i++) {
                if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
                    levels.push({ price: highs[i], type: 'resistance' });
                }
                if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
                    levels.push({ price: lows[i], type: 'support' });
                }
            }

            // Cluster nearby levels (within 1.5%)
            const clustered = [];
            const used = new Set();
            for (let i = 0; i < levels.length; i++) {
                if (used.has(i)) continue;
                let sum = levels[i].price, count = 1;
                for (let j = i + 1; j < levels.length; j++) {
                    if (used.has(j)) continue;
                    if (Math.abs(levels[j].price - levels[i].price) / levels[i].price < 0.015) {
                        sum += levels[j].price;
                        count++;
                        used.add(j);
                    }
                }
                const avgPrice = Math.round((sum / count) * 100) / 100;
                clustered.push({
                    price: avgPrice,
                    type: avgPrice > currentPrice ? 'resistance' : 'support',
                    strength: count
                });
            }

            clustered.sort((a, b) => b.price - a.price);

            const supports = clustered.filter(l => l.type === 'support').slice(0, 3);
            const resistances = clustered.filter(l => l.type === 'resistance').slice(0, 3);

            return { supports, resistances, currentPrice };
        },

        /**
         * Calculate recent N-day return
         */
        calcReturn(closes, days = 5) {
            const len = closes.length;
            if (len < days + 1) return 0;
            return Math.round(((closes[len - 1] / closes[len - 1 - days]) - 1) * 10000) / 100;
        },

        /**
         * Check if price broke above recent high
         */
        checkBreakout(highs, closes, lookback = 20) {
            const len = closes.length;
            if (len < lookback + 1) return false;
            let recentHigh = -Infinity;
            for (let i = len - lookback - 1; i < len - 1; i++) {
                if (highs[i] > recentHigh) recentHigh = highs[i];
            }
            return closes[len - 1] > recentHigh;
        },

        /**
         * Check MA direction (slope over last N days)
         */
        maDirection(maArr, days = 5) {
            const len = maArr.length;
            let last = null, prev = null;
            for (let i = len - 1; i >= 0; i--) {
                if (maArr[i] !== null) { if (last === null) last = maArr[i]; break; }
            }
            for (let i = len - 1 - days; i >= 0; i--) {
                if (maArr[i] !== null) { prev = maArr[i]; break; }
            }
            if (last === null || prev === null) return 0;
            return last > prev ? 1 : last < prev ? -1 : 0;
        }
    };

    // ==================== Factor Scorer ====================
    function scoreStock(days, weights = null) {
        if (!days || days.length < 30) return null;

        const closes = days.map(d => d.close);
        const highs = days.map(d => d.high);
        const lows = days.map(d => d.low);
        const volumes = days.map(d => d.volume);
        const len = closes.length;
        const last = closes[len - 1];

        // Compute all indicators
        const ma5 = TC.calcMA(closes, 5);
        const ma20 = TC.calcMA(closes, 20);
        const ma60 = TC.calcMA(closes, 60);
        const ma120 = TC.calcMA(closes, 120);
        const rsi = TC.calcRSI(closes, 14);
        const kd = TC.calcKD(highs, lows, closes, 9);
        const macd = TC.calcMACD(closes);
        const bb = TC.calcBollingerBands(closes, 20);
        const atr = TC.calcATR(highs, lows, closes, 14);
        const volRatio = TC.calcVolumeRatio(volumes, 20);
        const sr = TC.findSupportResistance(highs, lows, closes);

        const latestMA5 = ma5[len - 1];
        const latestMA20 = ma20[len - 1];
        const latestMA60 = ma60[len - 1];
        const latestMA120 = ma120[len - 1];
        const latestRSI = rsi[len - 1];
        const latestK = kd.K[len - 1];
        const latestD = kd.D[len - 1];
        const prevK = kd.K[len - 2];
        const prevD = kd.D[len - 2];
        const latestMACD = macd.histogram[len - 1];
        const prevMACD = macd.histogram[len - 2];
        const latestVolRatio = volRatio[len - 1];
        const latestATR = atr[len - 1];
        const latestBBWidth = bb.bandwidth[len - 1];

        // ---- Trend Score (0-100) ----
        let trendScore = 0;
        if (latestMA20 && last > latestMA20) trendScore += 15;        // above MA20
        if (latestMA20 && TC.maDirection(ma20) > 0) trendScore += 10; // MA20 rising
        if (latestMA60 && last > latestMA60) trendScore += 15;        // above MA60
        if (latestMA20 && latestMA60 && latestMA20 > latestMA60) trendScore += 15; // MA20 > MA60
        if (latestMA120 && last > latestMA120) trendScore += 10;      // above MA120
        if (TC.checkBreakout(highs, closes, 20)) trendScore += 20;    // breakout
        if (latestVolRatio && latestVolRatio > 1.5 && closes[len - 1] > closes[len - 2]) trendScore += 15; // volume breakout
        trendScore = Math.min(trendScore, 100);

        // ---- Momentum Score (0-100) ----
        let momentumScore = 0;
        if (latestRSI && latestRSI >= 50 && latestRSI <= 70) momentumScore += 20;
        else if (latestRSI && latestRSI > 70) momentumScore += 5; // overbought penalty
        else if (latestRSI && latestRSI >= 40) momentumScore += 10;

        // KD golden cross
        if (latestK && latestD && prevK && prevD) {
            if (latestK > latestD && prevK <= prevD) momentumScore += 20; // golden cross
            else if (latestK > latestD) momentumScore += 10;
        }

        // MACD histogram
        if (latestMACD !== null && latestMACD > 0) momentumScore += 15;
        if (latestMACD !== null && prevMACD !== null && latestMACD > prevMACD) momentumScore += 10;

        // Recent 5-day return
        const ret5 = TC.calcReturn(closes, 5);
        if (ret5 > 3) momentumScore += 20;
        else if (ret5 > 1) momentumScore += 15;
        else if (ret5 > 0) momentumScore += 10;
        momentumScore = Math.min(momentumScore, 100);

        // ---- Flow Score (volume-based, 0-100) ----
        let flowScore = 50; // base 50 since we lack chipflow data
        if (latestVolRatio) {
            if (latestVolRatio > 2.0) flowScore += 25;
            else if (latestVolRatio > 1.5) flowScore += 20;
            else if (latestVolRatio > 1.2) flowScore += 15;
            else if (latestVolRatio > 0.8) flowScore += 5;
            else flowScore -= 10; // shrinking volume
        }
        // Volume trend (avg of last 5 vs prior 5)
        if (len >= 10) {
            let recentVol = 0, priorVol = 0;
            for (let i = len - 5; i < len; i++) recentVol += volumes[i];
            for (let i = len - 10; i < len - 5; i++) priorVol += volumes[i];
            if (priorVol > 0 && recentVol > priorVol * 1.3) flowScore += 10;
        }
        flowScore = Math.max(0, Math.min(flowScore, 100));

        // ---- Fundamental Score (placeholder) ----
        const fundamentalScore = 50; // neutral default

        // ---- Sentiment Score (placeholder) ----
        const sentimentScore = 50; // neutral default

        // Default weights
        const w = weights || { trend: 0.30, momentum: 0.20, flow: 0.20, fundamental: 0.20, sentiment: 0.10 };
        const totalScore = Math.round(
            trendScore * w.trend +
            momentumScore * w.momentum +
            flowScore * w.flow +
            fundamentalScore * w.fundamental +
            sentimentScore * w.sentiment
        );

        // Indicators object for display
        const indicators = {
            ma5: latestMA5, ma20: latestMA20, ma60: latestMA60, ma120: latestMA120,
            rsi: latestRSI,
            k: latestK, d: latestD,
            macdHist: latestMACD, macdLine: macd.macdLine[len - 1], signalLine: macd.signalLine[len - 1],
            atr: latestATR, atrPct: latestATR && last > 0 ? Math.round(latestATR / last * 10000) / 100 : null,
            bbUpper: bb.upper[len - 1], bbMiddle: bb.middle[len - 1], bbLower: bb.lower[len - 1], bbWidth: latestBBWidth,
            volRatio: latestVolRatio,
            return5d: ret5,
            return20d: TC.calcReturn(closes, 20),
        };

        // Chart data arrays (last 120 days for display)
        const chartDays = Math.min(120, len);
        const chartSlice = {
            dates: days.slice(-chartDays).map(d => d.date),
            closes: closes.slice(-chartDays),
            highs: highs.slice(-chartDays),
            lows: lows.slice(-chartDays),
            volumes: volumes.slice(-chartDays),
            ma5: ma5.slice(-chartDays),
            ma20: ma20.slice(-chartDays),
            ma60: ma60.slice(-chartDays),
        };

        return {
            scores: { trend: trendScore, momentum: momentumScore, flow: flowScore, fundamental: fundamentalScore, sentiment: sentimentScore },
            totalScore,
            indicators,
            sr,
            chartData: chartSlice,
            weights: w,
        };
    }

    // ==================== Strategy Advisor ====================
    function classifyStock(result) {
        if (!result) return { category: 'unknown', label: '資料不足', color: '#64748b' };

        const { scores, totalScore, indicators } = result;
        const { trend, momentum } = scores;
        const { rsi, k, ma20, ma60, volRatio, bbWidth } = indicators;
        const last = result.chartData.closes[result.chartData.closes.length - 1];

        // Category 4: 接刀風險
        if (trend <= 20 && momentum <= 30) {
            return { category: 'falling-knife', label: '⚠️ 接刀風險', color: '#ef4444', advice: '避免接刀，等待底部確認訊號', badgeClass: 'badge-danger' };
        }

        // Category 1: 趨勢股
        if (last > (ma20 || 0) && (ma20 || 0) > (ma60 || 0) && trend >= 60) {
            return { category: 'trending', label: '🔥 趨勢強勢', color: '#10b981', advice: '可順勢操作，回檔不破 MA20 可考慮加碼', badgeClass: 'badge-success' };
        }

        // Category 2: 盤整待突破
        if (bbWidth && bbWidth < 0.08 && trend >= 30 && trend <= 65) {
            return { category: 'consolidation', label: '⏳ 盤整待突破', color: '#f59e0b', advice: '波動收斂中，等待方向選擇，突破時可跟進', badgeClass: 'badge-warning' };
        }

        // Category 3: 弱勢反彈
        if (last < (ma20 || Infinity) && k && k < 30 && momentum >= 20) {
            return { category: 'weak-bounce', label: '📉 弱勢反彈', color: '#f97316', advice: '短線反彈但中期趨勢向下，不宜重倉', badgeClass: 'badge-warning' };
        }

        // Default classification based on total score
        if (totalScore >= 70) {
            return { category: 'strong', label: '💪 綜合強勢', color: '#10b981', advice: '多項指標偏多，可考慮分批佈局', badgeClass: 'badge-success' };
        } else if (totalScore >= 50) {
            return { category: 'neutral', label: '🔄 中性觀望', color: '#f59e0b', advice: '訊號不明確，建議觀察等待更明確方向', badgeClass: 'badge-warning' };
        } else {
            return { category: 'weak', label: '📉 偏空弱勢', color: '#ef4444', advice: '多項指標偏空，建議減碼或觀望', badgeClass: 'badge-danger' };
        }
    }

    function generateAdvice(result) {
        if (!result) return {};
        const { totalScore, scores, indicators } = result;
        const classification = classifyStock(result);

        // Entry condition check
        const entrySignals = [];
        if (totalScore >= 75) entrySignals.push('✅ 總分 ≥ 75，符合進場條件');
        if (scores.trend >= 70) entrySignals.push('✅ 趨勢分數強勢 ≥ 70');
        if (indicators.volRatio && indicators.volRatio >= 1.5) entrySignals.push('✅ 成交量 ≥ 1.5 倍均量');

        // Exit warning check
        const exitWarnings = [];
        if (totalScore < 55) exitWarnings.push('⚠️ 總分跌破 55，考慮減碼');
        if (indicators.rsi && indicators.rsi > 80) exitWarnings.push('⚠️ RSI 過熱 > 80');
        if (indicators.rsi && indicators.rsi < 20) exitWarnings.push('⚠️ RSI 極度超賣 < 20');

        // Position sizing
        let positionAdvice = '單股不超過總資產 10%';
        if (indicators.atrPct && indicators.atrPct > 3) {
            positionAdvice = '高波動股，建議不超過 5%';
        }

        // Stop loss reference
        const closes = result.chartData.closes;
        const last = closes[closes.length - 1];
        const stopLoss5 = Math.round(last * 0.95 * 100) / 100;
        const takeProfit10 = Math.round(last * 1.10 * 100) / 100;
        const takeProfit15 = Math.round(last * 1.15 * 100) / 100;
        const ma20StopLoss = indicators.ma20 ? Math.round(indicators.ma20 * 100) / 100 : null;

        return {
            classification,
            entrySignals,
            exitWarnings,
            positionAdvice,
            keyPrices: {
                stopLoss5pct: stopLoss5,
                takeProfit10pct: takeProfit10,
                takeProfit15pct: takeProfit15,
                ma20Support: ma20StopLoss,
                supports: result.sr.supports,
                resistances: result.sr.resistances,
            }
        };
    }

    // ==================== Public API ====================
    return {
        TC,
        scoreStock,
        classifyStock,
        generateAdvice,
    };
})();

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScannerEngine;
}
