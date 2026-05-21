/**
 * 📓 Journal Engine — 當沖交易日誌 AI 顧問引擎
 * 
 * 規則式 AI 引擎，評估當沖交易者是否應該進場。
 * 偵測 FOMO、報復性交易、衝動交易，並檢查 VWAP 紀律。
 * 
 * 功能模組：
 * - 關鍵字字典：FOMO / 衝動 / 主觀 / 報復 / 追高 / 接刀 / 紀律 / VWAP
 * - 核心評估：evaluateConsultation() 綜合評分與建議
 * - 儲存管理：localStorage CRUD 操作
 * - 統計計算：勝率、損益、情緒分析、標籤分析
 */

const JournalEngine = (() => {
    'use strict';

    // ==================== 常數定義 ====================
    const STORAGE_KEY = 'daytrading_journal';

    // ==================== 關鍵字字典 ====================

    /** FOMO 關鍵字 — 怕錯過行情的心態 */
    const FOMO_KEYWORDS = [
        '怕來不及', '要漲了', '再不買就來不及', '趕快', '錯過',
        '來不及', '快要噴了', '不想錯過', '大家都在買', '一定會漲',
        '穩賺', '飆股', '噴出', '起漲'
    ];

    /** 衝動關鍵字 — 缺乏計畫的衝動行為 */
    const IMPULSE_KEYWORDS = [
        '追', '衝', '直接買', '馬上', '立刻',
        '先買再說', '梭哈', 'all in', '全押'
    ];

    /** 主觀判斷關鍵字 — 無客觀依據的猜測 */
    const SUBJECTIVE_KEYWORDS = [
        '感覺', '應該會', '一定', '肯定', '覺得',
        '看起來', '好像', '大概'
    ];

    /** 報復性交易關鍵字 — 想贏回虧損的不理性行為 */
    const REVENGE_KEYWORDS = [
        '賺回來', '扳回', '不甘心', '回本', '輸不起',
        '討回來', '把之前的', '攤平', '加碼攤'
    ];

    /** 追高關鍵字 — 在高點追進 */
    const CHASE_KEYWORDS = [
        '追高', '開盤追', '急拉', '噴出買', '漲停追',
        '衝上去', '開盤直接買'
    ];

    /** 接刀關鍵字 — 在下跌中抄底 */
    const KNIFE_KEYWORDS = [
        '抄底', '很低了', '便宜', '跌深', '跌夠了',
        '不會再跌', '接刀', '摸底', '跌到底', '很便宜'
    ];

    /** 紀律/計畫關鍵字 — 正面加分項 */
    const PLANNED_KEYWORDS = [
        'VWAP', '回測', '量縮', '止跌', '突破', '壓力', '支撐',
        '計畫', '紀律', '條件', '確認', 'MA', '均線', '量能',
        '停損', '停利', '風險報酬比', 'R/R'
    ];

    /** VWAP 做多關鍵字 */
    const VWAP_LONG_KEYWORDS = [
        'VWAP上方', 'VWAP之上', '站上VWAP', '回測VWAP',
        'VWAP支撐', 'VWAP止跌', 'VWAP斜率向上'
    ];

    /** VWAP 做空關鍵字 */
    const VWAP_SHORT_KEYWORDS = [
        'VWAP下方', 'VWAP之下', '跌破VWAP', '反抽VWAP',
        'VWAP壓力', 'VWAP上影線', 'VWAP斜率向下'
    ];

    // ==================== UUID 生成器 ====================

    /**
     * 生成唯一識別碼
     * 優先使用 crypto.randomUUID()，不支援時降級為 Date.now + Math.random
     * @returns {string} UUID 字串
     */
    function generateUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        // 降級方案：使用時間戳 + 隨機數
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Date.now() + Math.random() * 16) % 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // ==================== 關鍵字偵測工具 ====================

    /**
     * 在文字中搜尋關鍵字，回傳匹配的關鍵字陣列
     * 使用不區分大小寫的比對
     * @param {string} text - 待搜尋文字
     * @param {string[]} keywords - 關鍵字清單
     * @returns {string[]} 匹配到的關鍵字
     */
    function findKeywords(text, keywords) {
        if (!text || !keywords) return [];
        const lowerText = text.toLowerCase();
        return keywords.filter(kw => lowerText.includes(kw.toLowerCase()));
    }

    // ==================== 核心功能 ====================

    /**
     * 取得 VWAP 數據
     * @param {string} symbol - 股票代號
     * @returns {Promise<Object>} - VWAP 資料 {vwap, currentPrice, position, slope}
     */
    async function fetchVWAP(symbol) {
        if (!symbol) return null;
        try {
            const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}/vwap`);
            if (!res.ok) throw new Error('API error');
            const data = await res.json();
            return data;
        } catch (err) {
            console.error('Error fetching VWAP:', err);
            return null;
        }
    }

    // ==================== 歷史統計分析 ====================

    /**
     * 取得特定股票的歷史交易統計
     * @param {string} symbol - 股票代碼
     * @param {Array} trades - 歷史交易紀錄陣列
     * @returns {Object} { winRate, trades, wins, losses, avgPnl }
     */
    function getHistoricalStats(symbol, trades) {
        if (!symbol || !trades || trades.length === 0) {
            return { winRate: 0, trades: 0, wins: 0, losses: 0, avgPnl: 0 };
        }

        const filtered = trades.filter(t => t.symbol === symbol);
        const total = filtered.length;

        if (total === 0) {
            return { winRate: 0, trades: 0, wins: 0, losses: 0, avgPnl: 0 };
        }

        const wins = filtered.filter(t => (t.pnl || 0) > 0).length;
        const losses = filtered.filter(t => (t.pnl || 0) < 0).length;
        const totalPnl = filtered.reduce((sum, t) => sum + (t.pnl || 0), 0);

        return {
            winRate: Math.round((wins / total) * 100) / 100,
            trades: total,
            wins,
            losses,
            avgPnl: Math.round(totalPnl / total),
        };
    }

    /**
     * 取得特定情緒狀態下的歷史交易統計
     * @param {string} emotion - 情緒標籤 ('calm' | 'fomo' | 'revenge' | 'hesitant' | 'overconfident')
     * @param {Array} trades - 歷史交易紀錄陣列
     * @returns {Object} { winRate, trades, wins }
     */
    function getEmotionStats(emotion, trades) {
        if (!emotion || !trades || trades.length === 0) {
            return { winRate: 0, trades: 0, wins: 0 };
        }

        const filtered = trades.filter(t => t.emotion === emotion);
        const total = filtered.length;

        if (total === 0) {
            return { winRate: 0, trades: 0, wins: 0 };
        }

        const wins = filtered.filter(t => (t.pnl || 0) > 0).length;

        return {
            winRate: Math.round((wins / total) * 100) / 100,
            trades: total,
            wins,
        };
    }

    // ==================== 情緒標籤對照表 ====================

    const EMOTION_LABELS = {
        calm: '冷靜',
        fomo: 'FOMO',
        revenge: '報復心態',
        hesitant: '猶豫不決',
        overconfident: '過度自信',
    };

    // ==================== 核心評估引擎 ====================

    /**
     * 綜合評估交易諮詢
     * 
     * 評分邏輯：
     * - 基礎分 70 分（中性）
     * - FOMO 關鍵字：每個 -8
     * - 衝動關鍵字：每個 -10
     * - 主觀關鍵字：每個 -5
     * - 報復關鍵字：每個 -12
     * - 追高/接刀：每個 -8
     * - 紀律關鍵字：每個 +5
     * - VWAP 方向匹配：每個 +8
     * - 情緒修正：calm +10, hesitant -5, fomo -15, revenge -20, overconfident -10
     * - 當日虧損 > 50% 上限：-15
     * - 當日虧損 > 上限（熔斷）：-25
     * - 歷史勝率 < 30%：-10
     * - 情緒勝率 < 30%：-10
     * - 最終分數限制在 0-100
     * - 判定：green ≥ 70, yellow ≥ 40, red < 40
     * 
     * @param {Object} data - 諮詢輸入資料
     * @param {string} data.symbol - 股票代碼
     * @param {string} data.direction - 方向 ('long' | 'short')
     * @param {string} data.reason - 進場理由（自由文字）
     * @param {string} data.emotion - 當前情緒
     * @param {number} data.dailyLoss - 今日累計虧損（TWD）
     * @param {number} data.meltdownLimit - 每日最大虧損上限（TWD）
     * @returns {Object} 評估結果
     */
    function evaluateConsultation(data) {
        const {
            symbol = '',
            direction = 'long',
            reason = '',
            emotion = 'calm',
            dailyLoss = 0,
            meltdownLimit = 5000,
            sectorContext = null,
        } = data || {};

        // 載入歷史交易紀錄供統計分析
        const journal = loadJournal();
        const allTrades = journal.trades || [];

        // ---------- 關鍵字偵測 ----------
        const fomoHits = findKeywords(reason, FOMO_KEYWORDS);
        const impulseHits = findKeywords(reason, IMPULSE_KEYWORDS);
        const subjectiveHits = findKeywords(reason, SUBJECTIVE_KEYWORDS);
        const revengeHits = findKeywords(reason, REVENGE_KEYWORDS);
        const chaseHits = findKeywords(reason, CHASE_KEYWORDS);
        const knifeHits = findKeywords(reason, KNIFE_KEYWORDS);
        const plannedHits = findKeywords(reason, PLANNED_KEYWORDS);

        // 根據方向選擇對應的 VWAP 關鍵字
        const vwapKeywords = direction === 'long' ? VWAP_LONG_KEYWORDS : VWAP_SHORT_KEYWORDS;
        const vwapHits = findKeywords(reason, vwapKeywords);

        // 檢查是否有任何 VWAP 相關描述（不限方向）
        const anyVwapMention = findKeywords(reason, [...VWAP_LONG_KEYWORDS, ...VWAP_SHORT_KEYWORDS, 'VWAP', 'vwap']);

        // ---------- 評分計算 ----------
        let score = 70; // 基礎中性分數

        // 負面關鍵字扣分
        score -= fomoHits.length * 8;
        score -= impulseHits.length * 10;
        score -= subjectiveHits.length * 5;
        score -= revengeHits.length * 12;
        score -= chaseHits.length * 8;
        score -= knifeHits.length * 8;

        // 正面關鍵字加分
        score += plannedHits.length * 5;
        score += vwapHits.length * 8;

        // 情緒修正
        const emotionModifiers = {
            calm: 10,
            hesitant: -5,
            fomo: -15,
            revenge: -20,
            overconfident: -10,
        };
        score += emotionModifiers[emotion] || 0;

        // 當日虧損修正
        const dailyLossAbs = Math.abs(dailyLoss);
        let isMeltdown = false;
        if (meltdownLimit > 0) {
            if (dailyLossAbs > meltdownLimit) {
                score -= 25;
                isMeltdown = true;
            } else if (dailyLossAbs > meltdownLimit * 0.5) {
                score -= 15;
            }
        }

        // 歷史統計修正
        const historicalStats = getHistoricalStats(symbol, allTrades);
        if (historicalStats.trades >= 3 && historicalStats.winRate < 0.3) {
            score -= 10;
        }

        const emotionStats = getEmotionStats(emotion, allTrades);
        if (emotionStats.trades >= 3 && emotionStats.winRate < 0.3) {
            score -= 10;
        }

        // 族群動能修正
        if (sectorContext) {
            if (sectorContext.sectorAlert) {
                score += 10; // 熱門族群加分
            } else if (sectorContext.sectorMomentum === 'strong') {
                score += 5;
            } else if (sectorContext.sectorMomentum === 'weak') {
                score -= 5; // 冷門族群扣分
            }
            if (sectorContext.hotStocks >= 3) {
                score += 5; // 族群連動加分
            }
        }

        // 限制分數範圍
        score = Math.max(0, Math.min(100, score));

        // ---------- 判定等級 ----------
        let verdict, verdictText;
        if (score >= 70) {
            verdict = 'green';
            verdictText = '🟢 綠燈 — 條件符合，可考慮進場';
        } else if (score >= 40) {
            verdict = 'yellow';
            verdictText = '🟡 黃燈 — 條件尚可，請謹慎評估';
        } else {
            verdict = 'red';
            verdictText = '🔴 紅燈 — 強烈建議放棄此筆交易';
        }

        // ---------- 彙整偵測標記 ----------
        const flags = [];
        if (fomoHits.length > 0) flags.push('FOMO');
        if (impulseHits.length > 0) flags.push('衝動交易');
        if (subjectiveHits.length > 0) flags.push('主觀判斷');
        if (revengeHits.length > 0) flags.push('報復性交易');
        if (chaseHits.length > 0) flags.push('追高');
        if (knifeHits.length > 0) flags.push('接刀');
        if (anyVwapMention.length === 0) flags.push('無VWAP依據');
        if (isMeltdown) flags.push('已觸發熔斷');

        // ---------- 詳細分析項目 ----------
        const details = [];

        // FOMO 偵測
        if (fomoHits.length > 0) {
            details.push({
                type: 'danger',
                icon: '🚫',
                text: `偵測到 FOMO 關鍵字：「${fomoHits.join('、')}」`,
            });
        }

        // 衝動偵測
        if (impulseHits.length > 0) {
            details.push({
                type: 'danger',
                icon: '⚡',
                text: `偵測到衝動關鍵字：「${impulseHits.join('、')}」— 缺乏計畫的進場`,
            });
        }

        // 主觀判斷
        if (subjectiveHits.length > 0) {
            details.push({
                type: 'warning',
                icon: '🧠',
                text: `偵測到主觀判斷：「${subjectiveHits.join('、')}」— 缺乏客觀技術依據`,
            });
        }

        // 報復性交易
        if (revengeHits.length > 0 || emotion === 'revenge') {
            const emotionNote = emotion === 'revenge' ? '且情緒為急躁/想回本' : '';
            const lossNote = dailyLossAbs > 0
                ? `今日已虧損 $${dailyLossAbs.toLocaleString()}`
                : '注意報復性交易傾向';
            details.push({
                type: 'danger',
                icon: '💢',
                text: `報復性交易：${lossNote}${emotionNote ? '，' + emotionNote : ''}`,
            });
        }

        // 追高
        if (chaseHits.length > 0) {
            details.push({
                type: 'danger',
                icon: '📈',
                text: `偵測到追高行為：「${chaseHits.join('、')}」— 追漲殺跌風險極高`,
            });
        }

        // 接刀
        if (knifeHits.length > 0) {
            details.push({
                type: 'danger',
                icon: '🔪',
                text: `偵測到接刀行為：「${knifeHits.join('、')}」— 下跌趨勢中抄底極危險`,
            });
        }

        // VWAP 檢查
        if (anyVwapMention.length === 0) {
            details.push({
                type: 'warning',
                icon: '⚠️',
                text: '理由中沒有提到 VWAP 條件 — 當沖必須以 VWAP 為核心依據',
            });
        } else if (vwapHits.length > 0) {
            details.push({
                type: 'success',
                icon: '✅',
                text: `VWAP 條件明確：「${vwapHits.join('、')}」— 方向與 VWAP 一致`,
            });
        } else {
            // 有提到 VWAP 但方向關鍵字不匹配
            details.push({
                type: 'warning',
                icon: '⚠️',
                text: `有提到 VWAP，但未見明確的${direction === 'long' ? '做多' : '做空'}方向條件`,
            });
        }

        // 紀律關鍵字
        if (plannedHits.length > 0) {
            details.push({
                type: 'success',
                icon: '📋',
                text: `偵測到紀律關鍵字：「${plannedHits.join('、')}」— 進場有計畫`,
            });
        }

        // 熔斷警告
        if (isMeltdown) {
            details.push({
                type: 'danger',
                icon: '🔥',
                text: `已觸發熔斷！今日虧損 $${dailyLossAbs.toLocaleString()} 已超過上限 $${meltdownLimit.toLocaleString()}，應立即停止交易`,
            });
        } else if (meltdownLimit > 0 && dailyLossAbs > meltdownLimit * 0.5) {
            details.push({
                type: 'warning',
                icon: '⚠️',
                text: `今日虧損 $${dailyLossAbs.toLocaleString()} 已超過熔斷上限的 50%（上限 $${meltdownLimit.toLocaleString()}），請格外謹慎`,
            });
        }

        // 歷史勝率統計
        if (historicalStats.trades >= 3) {
            const pct = Math.round(historicalStats.winRate * 100);
            const icon = pct >= 50 ? '📊' : '📉';
            details.push({
                type: pct >= 50 ? 'info' : 'warning',
                icon,
                text: `過去此股交易勝率：${pct}%（${historicalStats.wins}勝${historicalStats.losses}敗，共 ${historicalStats.trades} 筆）`,
            });
        }

        // 情緒歷史勝率
        if (emotionStats.trades >= 3) {
            const pct = Math.round(emotionStats.winRate * 100);
            const emotionLabel = EMOTION_LABELS[emotion] || emotion;
            details.push({
                type: pct >= 50 ? 'info' : 'warning',
                icon: '🎭',
                text: `在「${emotionLabel}」情緒下的歷史勝率：${pct}%（${emotionStats.trades} 筆交易）`,
            });
        }
        // 族群動能檢查
        if (sectorContext) {
            if (sectorContext.sectorAlert) {
                details.push({
                    type: 'success',
                    icon: '🔥',
                    text: `族群動能強勁！${sectorContext.sectorName} VR=${sectorContext.sectorVR}x，族群平均漲跌 ${sectorContext.sectorChange >= 0 ? '+' : ''}${sectorContext.sectorChange}%，${sectorContext.hotStocks}/${sectorContext.totalStocks} 檔熱門股`,
                });
            } else if (sectorContext.sectorMomentum === 'strong') {
                details.push({
                    type: 'info',
                    icon: '📊',
                    text: `族群動能尚可：${sectorContext.sectorName} VR=${sectorContext.sectorVR}x`,
                });
            } else if (sectorContext.sectorMomentum === 'weak') {
                details.push({
                    type: 'warning',
                    icon: '⚠️',
                    text: `族群動能偏弱：${sectorContext.sectorName} VR=${sectorContext.sectorVR}x — 資金不在此族群，當沖勝率低`,
                });
            } else {
                details.push({
                    type: 'info',
                    icon: '📡',
                    text: `族群動能正常：${sectorContext.sectorName} VR=${sectorContext.sectorVR}x`,
                });
            }
        } else {
            details.push({
                type: 'info',
                icon: '📡',
                text: '尚未掃描族群動能，建議點擊上方「📡 掃描」確認資金是否在此族群',
            });
        }

        // ---------- 產生建議 ----------
        const advice = generateAdvice({
            score,
            verdict,
            flags,
            fomoHits,
            impulseHits,
            subjectiveHits,
            revengeHits,
            chaseHits,
            knifeHits,
            plannedHits,
            vwapHits,
            anyVwapMention,
            emotion,
            dailyLossAbs,
            meltdownLimit,
            isMeltdown,
            historicalStats,
            emotionStats,
            direction,
            symbol,
        });

        return {
            score,
            verdict,
            verdictText,
            flags,
            details,
            advice,
            historicalStats: historicalStats.trades > 0 ? historicalStats : null,
        };
    }

    // ==================== 建議生成器 ====================

    /**
     * 根據評估結果產生詳細的中文建議
     * @param {Object} evaluation - 內部評估資料
     * @returns {string} 建議文字
     */
    function generateAdvice(evaluation) {
        const {
            score, verdict, flags, fomoHits, impulseHits, subjectiveHits,
            revengeHits, chaseHits, knifeHits, plannedHits, vwapHits,
            anyVwapMention, emotion, dailyLossAbs, meltdownLimit,
            isMeltdown, historicalStats, emotionStats, direction, symbol,
        } = evaluation;

        const parts = [];

        // ---- 總體判斷 ----
        if (verdict === 'red') {
            parts.push('⛔ 綜合評估：此筆交易風險極高，強烈建議放棄。');
        } else if (verdict === 'yellow') {
            parts.push('⚠️ 綜合評估：此筆交易存在疑慮，請仔細檢視以下問題後再決定。');
        } else {
            parts.push('✅ 綜合評估：基本條件符合，但仍需確認停損停利計畫。');
        }

        // ---- 熔斷優先 ----
        if (isMeltdown) {
            parts.push(`\n🔥 熔斷警告：你今天已經虧損 $${dailyLossAbs.toLocaleString()}，超過了你自己設定的上限 $${meltdownLimit.toLocaleString()}。請立即關閉所有看盤軟體，今天不要再交易了。虧損的錢不會因為你多做幾筆而回來，反而更可能越虧越多。`);
            return parts.join('\n');
        }

        // ---- FOMO 建議 ----
        if (fomoHits.length > 0) {
            parts.push(`\n📌 FOMO 偵測：你的理由中出現了「${fomoHits.join('、')}」等關鍵字。這代表你正在被「怕錯過」的情緒驅動，而不是根據客觀條件進場。請記住：市場每天都有機會，錯過一班車不代表你要跳上正在加速的火車。`);
        }

        // ---- 衝動交易建議 ----
        if (impulseHits.length > 0) {
            parts.push(`\n📌 衝動交易：你使用了「${impulseHits.join('、')}」等字眼，這代表你可能沒有經過完整的進場條件確認就想下單。建議你先暫停 3 分鐘，寫下你的停損價與目標價再決定。`);
        }

        // ---- 主觀判斷建議 ----
        if (subjectiveHits.length > 0) {
            parts.push(`\n📌 主觀判斷：你的理由包含「${subjectiveHits.join('、')}」等主觀用語。交易決策應基於可量化的技術指標（如 VWAP 位置、量能變化），而非感覺或猜測。`);
        }

        // ---- 報復性交易建議 ----
        if (revengeHits.length > 0 || emotion === 'revenge') {
            parts.push(`\n📌 報復性交易警告：你正在試圖「賺回來」。這是虧損螺旋的開始 — 當你帶著怒氣或不甘心進場時，判斷力會嚴重下降，部位會不自覺加大。請離開螢幕，休息至少 15 分鐘。`);
        }

        // ---- 追高建議 ----
        if (chaseHits.length > 0) {
            parts.push(`\n📌 追高風險：你正打算追漲已經大幅拉高的股票。追高的勝率在統計上顯著低於等待拉回再進場。建議等待股價回測 VWAP 或 5 分 K 均線支撐再考慮進場。`);
        }

        // ---- 接刀建議 ----
        if (knifeHits.length > 0) {
            parts.push(`\n📌 接刀風險：你正打算在下跌中抄底。「看起來很便宜」不是進場理由 — 便宜可以更便宜。建議等待出現止跌訊號（如 VWAP 止跌回升、量縮價穩）再進場。`);
        }

        // ---- VWAP 紀律建議 ----
        if (anyVwapMention.length === 0) {
            const dirText = direction === 'long' ? '做多需要股價在 VWAP 上方' : '做空需要股價在 VWAP 下方';
            parts.push(`\n📌 VWAP 紀律：你的進場理由沒有提到任何 VWAP 相關條件。${dirText}，這是當沖最基本的方向判斷依據。沒有 VWAP 確認的交易等於矇眼射飛鏢。`);
        }

        // ---- 當日虧損提醒 ----
        if (!isMeltdown && meltdownLimit > 0 && dailyLossAbs > meltdownLimit * 0.5) {
            const pct = Math.round((dailyLossAbs / meltdownLimit) * 100);
            parts.push(`\n📌 虧損提醒：今日已虧損 $${dailyLossAbs.toLocaleString()}，已達熔斷上限的 ${pct}%。接下來每一筆交易的部位都應該減半，並且只做勝率最高的 A+ 機會。`);
        }

        // ---- 歷史勝率建議 ----
        if (historicalStats && historicalStats.trades >= 3 && historicalStats.winRate < 0.3) {
            parts.push(`\n📌 歷史數據：你過去操作 ${symbol} 的勝率僅 ${Math.round(historicalStats.winRate * 100)}%（${historicalStats.wins}勝${historicalStats.losses}敗）。這支股票可能不適合你的策略，建議換一檔更熟悉的標的。`);
        }

        // ---- 情緒歷史建議 ----
        if (emotionStats && emotionStats.trades >= 3 && emotionStats.winRate < 0.3) {
            const emotionLabel = EMOTION_LABELS[emotion] || emotion;
            parts.push(`\n📌 情緒統計：你在「${emotionLabel}」情緒狀態下的歷史勝率僅 ${Math.round(emotionStats.winRate * 100)}%。數據告訴你，帶著這種情緒進場通常不會有好結果。`);
        }

        // ---- 正面回饋 ----
        if (plannedHits.length > 0 && verdict !== 'red') {
            parts.push(`\n✅ 正面回饋：你的理由中包含「${plannedHits.join('、')}」等紀律關鍵字，代表你有經過思考和計畫。繼續保持這個好習慣！`);
        }

        if (vwapHits.length > 0 && verdict !== 'red') {
            parts.push(`\n✅ VWAP 確認：你有明確的 VWAP 方向條件（${vwapHits.join('、')}），這是好的紀律表現。`);
        }

        // ---- 行動建議 ----
        if (verdict === 'green') {
            parts.push('\n💡 行動建議：條件大致符合。進場前請再次確認：(1) 停損價位明確 (2) 部位大小合理 (3) 風險報酬比至少 1:2。');
        } else if (verdict === 'yellow') {
            parts.push('\n💡 行動建議：建議修正上述問題後再重新評估。如果修正後仍無法達到綠燈，今天就放棄這筆交易。');
        } else {
            parts.push('\n💡 行動建議：請關閉這個交易視窗，離開螢幕休息 10 分鐘。如果你堅持要做，至少將部位縮小到平時的 1/3。');
        }

        return parts.join('\n');
    }

    // ==================== 儲存管理 ====================

    /**
     * 從 localStorage 載入交易日誌
     * @returns {Object} { trades: [], consultations: [] }
     */
    function loadJournal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    trades: Array.isArray(parsed.trades) ? parsed.trades : [],
                    consultations: Array.isArray(parsed.consultations) ? parsed.consultations : [],
                };
            }
        } catch (e) {
            console.warn('[JournalEngine] 載入日誌失敗，將使用空白日誌：', e);
        }
        return { trades: [], consultations: [] };
    }

    /**
     * 將交易日誌存入 localStorage
     * @param {Object} journal - { trades: [], consultations: [] }
     */
    function saveJournal(journal) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
        } catch (e) {
            console.error('[JournalEngine] 儲存日誌失敗：', e);
        }
    }

    /**
     * 新增一筆交易紀錄
     * 自動附加 UUID 和時間戳
     * @param {Object} trade - 交易資料
     * @returns {Object} 含 id 的完整交易紀錄
     */
    function addTrade(trade) {
        const journal = loadJournal();
        const newTrade = {
            id: generateUUID(),
            createdAt: new Date().toISOString(),
            ...trade,
        };
        journal.trades.push(newTrade);
        saveJournal(journal);
        return newTrade;
    }

    /**
     * 更新指定交易紀錄
     * @param {string} id - 交易 UUID
     * @param {Object} updates - 要更新的欄位
     * @returns {Object|null} 更新後的交易紀錄，找不到則回傳 null
     */
    function updateTrade(id, updates) {
        const journal = loadJournal();
        const index = journal.trades.findIndex(t => t.id === id);
        if (index === -1) {
            console.warn(`[JournalEngine] 找不到交易紀錄 ID：${id}`);
            return null;
        }
        journal.trades[index] = {
            ...journal.trades[index],
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        saveJournal(journal);
        return journal.trades[index];
    }

    /**
     * 刪除指定交易紀錄
     * @param {string} id - 交易 UUID
     * @returns {boolean} 是否成功刪除
     */
    function deleteTrade(id) {
        const journal = loadJournal();
        const initialLength = journal.trades.length;
        journal.trades = journal.trades.filter(t => t.id !== id);
        if (journal.trades.length === initialLength) {
            console.warn(`[JournalEngine] 找不到要刪除的交易紀錄 ID：${id}`);
            return false;
        }
        saveJournal(journal);
        return true;
    }

    /**
     * 新增一筆諮詢紀錄（evaluateConsultation 的結果）
     * 自動附加 UUID 和時間戳
     * @param {Object} consultation - 諮詢資料及評估結果
     * @returns {Object} 含 id 的完整諮詢紀錄
     */
    function addConsultation(consultation) {
        const journal = loadJournal();
        const newConsultation = {
            id: generateUUID(),
            createdAt: new Date().toISOString(),
            ...consultation,
        };
        journal.consultations.push(newConsultation);
        saveJournal(journal);
        return newConsultation;
    }

    /**
     * 取得所有交易紀錄
     * @returns {Array} 交易紀錄陣列
     */
    function getAllTrades() {
        return loadJournal().trades;
    }

    /**
     * 依股票代碼篩選交易紀錄
     * @param {string} symbol - 股票代碼
     * @returns {Array} 符合條件的交易紀錄
     */
    function getTradesBySymbol(symbol) {
        return loadJournal().trades.filter(t => t.symbol === symbol);
    }

    /**
     * 依日期區間篩選交易紀錄
     * @param {string} startDate - 起始日期（ISO 字串或 YYYY-MM-DD）
     * @param {string} endDate - 結束日期（ISO 字串或 YYYY-MM-DD）
     * @returns {Array} 符合條件的交易紀錄
     */
    function getTradesByDateRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        // 將結束日期設為當天的 23:59:59 以包含整天
        end.setHours(23, 59, 59, 999);

        return loadJournal().trades.filter(t => {
            const tradeDate = new Date(t.date || t.createdAt);
            return tradeDate >= start && tradeDate <= end;
        });
    }

    // ==================== 統計計算器 ====================

    /**
     * 計算綜合交易統計
     * 
     * @param {Array} trades - 交易紀錄陣列
     * @returns {Object} 完整統計資料
     *   - totalTrades, wins, losses, winRate
     *   - totalPnl, avgPnl, maxWin, maxLoss
     *   - byDirection: { long: {...}, short: {...} }
     *   - byEmotion: { calm: {...}, fomo: {...}, revenge: {...}, ... }
     *   - byTag: { 'FOMO': {...}, '追高': {...}, ... }
     *   - pnlByDate: [{ date, pnl, cumPnl }]  // 供圖表用
     *   - disciplineRate: VWAP 紀律比率
     */
    function calculateStats(trades) {
        if (!trades || trades.length === 0) {
            return {
                totalTrades: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnl: 0,
                avgPnl: 0,
                maxWin: 0,
                maxLoss: 0,
                byDirection: { long: _emptyStats(), short: _emptyStats() },
                byEmotion: {},
                byTag: {},
                pnlByDate: [],
                disciplineRate: 0,
            };
        }

        const totalTrades = trades.length;
        const pnls = trades.map(t => t.pnl || 0);
        const wins = pnls.filter(p => p > 0).length;
        const losses = pnls.filter(p => p < 0).length;
        const totalPnl = pnls.reduce((sum, p) => sum + p, 0);
        const maxWin = Math.max(...pnls, 0);
        const maxLoss = Math.min(...pnls, 0);

        // ---- 依方向分類 ----
        const byDirection = { long: _emptyStats(), short: _emptyStats() };
        for (const dir of ['long', 'short']) {
            const dirTrades = trades.filter(t => t.direction === dir);
            byDirection[dir] = _calcGroupStats(dirTrades);
        }

        // ---- 依情緒分類 ----
        const emotionSet = new Set(trades.map(t => t.emotion).filter(Boolean));
        const byEmotion = {};
        for (const em of emotionSet) {
            const emTrades = trades.filter(t => t.emotion === em);
            byEmotion[em] = _calcGroupStats(emTrades);
        }

        // ---- 依標籤分類 ----
        // 從每筆交易的 flags 或 tags 陣列中展開
        const tagSet = new Set();
        for (const t of trades) {
            const tags = t.flags || t.tags || [];
            for (const tag of tags) tagSet.add(tag);
        }
        const byTag = {};
        for (const tag of tagSet) {
            const tagTrades = trades.filter(t => {
                const tags = t.flags || t.tags || [];
                return tags.includes(tag);
            });
            byTag[tag] = _calcGroupStats(tagTrades);
        }

        // ---- 每日損益曲線（供圖表用） ----
        // 依日期排序並彙總
        const dateMap = new Map();
        for (const t of trades) {
            const date = (t.date || t.createdAt || '').slice(0, 10); // 取 YYYY-MM-DD
            if (!date) continue;
            dateMap.set(date, (dateMap.get(date) || 0) + (t.pnl || 0));
        }

        const sortedDates = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        let cumPnl = 0;
        const pnlByDate = sortedDates.map(([date, pnl]) => {
            cumPnl += pnl;
            return { date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) };
        });

        // ---- VWAP 紀律比率 ----
        // 檢查每筆交易的理由中是否包含 VWAP 相關關鍵字
        const allVwapKeywords = [...VWAP_LONG_KEYWORDS, ...VWAP_SHORT_KEYWORDS, 'VWAP', 'vwap'];
        let disciplinedCount = 0;
        for (const t of trades) {
            const reason = t.reason || '';
            if (findKeywords(reason, allVwapKeywords).length > 0) {
                disciplinedCount++;
            }
        }
        const disciplineRate = totalTrades > 0
            ? Math.round((disciplinedCount / totalTrades) * 100)
            : 0;

        return {
            totalTrades,
            wins,
            losses,
            winRate: Math.round((wins / totalTrades) * 100) / 100,
            totalPnl: Math.round(totalPnl),
            avgPnl: Math.round(totalPnl / totalTrades),
            maxWin: Math.round(maxWin),
            maxLoss: Math.round(maxLoss),
            byDirection,
            byEmotion,
            byTag,
            pnlByDate,
            disciplineRate,
        };
    }

    /**
     * 計算一組交易的統計（內部輔助函式）
     * @param {Array} trades - 交易子集
     * @returns {Object} 群組統計
     */
    function _calcGroupStats(trades) {
        if (!trades || trades.length === 0) return _emptyStats();

        const total = trades.length;
        const pnls = trades.map(t => t.pnl || 0);
        const wins = pnls.filter(p => p > 0).length;
        const losses = pnls.filter(p => p < 0).length;
        const totalPnl = pnls.reduce((sum, p) => sum + p, 0);

        return {
            trades: total,
            wins,
            losses,
            winRate: Math.round((wins / total) * 100) / 100,
            totalPnl: Math.round(totalPnl),
            avgPnl: Math.round(totalPnl / total),
        };
    }

    /**
     * 回傳空白統計物件（內部輔助函式）
     * @returns {Object}
     */
    function _emptyStats() {
        return { trades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0, avgPnl: 0 };
    }

    // ==================== 匯出公開 API ====================

    const api = {
        // 常數
        STORAGE_KEY,

        // 關鍵字字典（供外部參考或測試用）
        FOMO_KEYWORDS,
        IMPULSE_KEYWORDS,
        SUBJECTIVE_KEYWORDS,
        REVENGE_KEYWORDS,
        CHASE_KEYWORDS,
        KNIFE_KEYWORDS,
        PLANNED_KEYWORDS,
        VWAP_LONG_KEYWORDS,
        VWAP_SHORT_KEYWORDS,

        // 核心評估
        evaluateConsultation,
        fetchVWAP: fetchVWAP,
        getHistoricalStats,
        getEmotionStats,
        generateAdvice,

        // 儲存管理
        loadJournal,
        saveJournal,
        addTrade,
        updateTrade,
        deleteTrade,
        addConsultation,
        getAllTrades,
        getTradesBySymbol,
        getTradesByDateRange,

        // 統計計算
        calculateStats,

        // 工具函式
        generateUUID,
        findKeywords,

        // 情緒標籤
        EMOTION_LABELS,
    };

    return api;
})();

// 掛載為全域物件
window.JournalEngine = JournalEngine;
