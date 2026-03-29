"""
🧠 Alpha Research Core — 台股多因子研究引擎
==============================================
使用 FinMind + VectorBT + Alphalens 進行專業級因子研究。

Usage:
    python research_engine.py                      # 使用預設股票池
    python research_engine.py --symbols 2330,0050  # 指定股票
    python research_engine.py --token YOUR_TOKEN   # 使用 FinMind API Token

Output:
    quant_results.json  — 最佳權重、回測統計、因子 IC 值
"""

import json
import sys
import os
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# Fix Windows cp950 encoding issue with emoji output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

warnings.filterwarnings('ignore')

# ============================================================
# Configuration
# ============================================================
OUTPUT_DIR = Path(__file__).parent
OUTPUT_FILE = OUTPUT_DIR / 'quant_results.json'

DEFAULT_SYMBOLS = [
    '2330', '2317', '2454', '2308', '2881', '2882',
    '2891', '2303', '3711', '2412', '2886', '2884',
    '1301', '1303', '2002', '2105', '3008', '2345',
    '6505', '1216', '0050', '0056', '00878',
]

FACTOR_NAMES = ['trend', 'momentum', 'flow', 'fundamental', 'sentiment']

# ============================================================
# 1. Data Ingestion — FinMind
# ============================================================
def fetch_data_finmind(symbols, start_date, end_date, token=''):
    """
    Fetch台股數據：日K線 + 法人買賣超 + 融資融券。
    若 FinMind 不可用，自動 fallback 到 Yahoo Finance。
    """
    try:
        from FinMind.data import DataLoader
        dl = DataLoader()
        if token:
            dl.login_by_token(api_token=token)

        all_price = []
        all_institutional = []
        all_margin = []

        for sym in symbols:
            print(f'  📥 抓取 {sym}...', end=' ')
            try:
                # === 日K線 ===
                price_df = dl.taiwan_stock_daily(
                    stock_id=sym, start_date=start_date, end_date=end_date
                )
                if price_df is not None and len(price_df) > 0:
                    price_df['symbol'] = sym
                    all_price.append(price_df)

                # === 三大法人買賣超 ===
                try:
                    inst_df = dl.taiwan_stock_institutional_investors(
                        stock_id=sym, start_date=start_date, end_date=end_date
                    )
                    if inst_df is not None and len(inst_df) > 0:
                        inst_df['symbol'] = sym
                        all_institutional.append(inst_df)
                except Exception:
                    pass

                # === 融資融券 ===
                try:
                    margin_df = dl.taiwan_stock_margin_purchase_short_sale(
                        stock_id=sym, start_date=start_date, end_date=end_date
                    )
                    if margin_df is not None and len(margin_df) > 0:
                        margin_df['symbol'] = sym
                        all_margin.append(margin_df)
                except Exception:
                    pass

                print('✅')
            except Exception as e:
                print(f'⚠️ {e}')

        prices = pd.concat(all_price, ignore_index=True) if all_price else pd.DataFrame()
        institutional = pd.concat(all_institutional, ignore_index=True) if all_institutional else pd.DataFrame()
        margin = pd.concat(all_margin, ignore_index=True) if all_margin else pd.DataFrame()

        return prices, institutional, margin

    except ImportError:
        print('  ⚠️ FinMind 未安裝，使用 Yahoo Finance fallback...')
        return fetch_data_yahoo_fallback(symbols, start_date, end_date)


def fetch_data_yahoo_fallback(symbols, start_date, end_date):
    """Fallback: 使用 yfinance 抓取基本 K 線數據。"""
    try:
        import yfinance as yf
    except ImportError:
        print('  ❌ 需要安裝 yfinance: pip install yfinance')
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    all_price = []
    for sym in symbols:
        print(f'  📥 [Yahoo] 抓取 {sym}...', end=' ')
        ticker = f'{sym}.TW'
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if df is not None and len(df) > 0:
                df = df.reset_index()
                df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
                df = df.rename(columns={
                    'Date': 'date', 'Open': 'open', 'High': 'max',
                    'Low': 'min', 'Close': 'close', 'Volume': 'Trading_Volume'
                })
                df['symbol'] = sym
                all_price.append(df[['date', 'symbol', 'open', 'max', 'min', 'close', 'Trading_Volume']])
                print('✅')
            else:
                print('⚠️ 無資料')
        except Exception as e:
            print(f'⚠️ {e}')

    prices = pd.concat(all_price, ignore_index=True) if all_price else pd.DataFrame()
    return prices, pd.DataFrame(), pd.DataFrame()


# ============================================================
# 2. Factor Engineering — 因子工廠
# ============================================================
def compute_factors(prices, institutional, margin):
    """
    將原始數據轉化為標準化因子。
    回傳 DataFrame: index=date, columns=MultiIndex(symbol, factor_name)
    """
    factors_list = []

    for sym, grp in prices.groupby('symbol'):
        grp = grp.sort_values('date').copy()
        grp['date'] = pd.to_datetime(grp['date'])
        grp = grp.set_index('date')
        close = grp['close'].astype(float)
        volume = grp['Trading_Volume'].astype(float)
        high = grp['max'].astype(float) if 'max' in grp.columns else close
        low = grp['min'].astype(float) if 'min' in grp.columns else close

        if len(close) < 60:
            continue

        f = pd.DataFrame(index=grp.index)

        # ---- Trend Factor ----
        ma20 = close.rolling(20).mean()
        ma60 = close.rolling(60).mean()
        # 乖離率 (Bias)
        bias20 = (close - ma20) / ma20
        # MA 排列分數: price > ma20 > ma60
        ma_align = ((close > ma20).astype(float) * 0.5 +
                     (ma20 > ma60).astype(float) * 0.5)
        f['trend'] = (zscore_series(bias20) * 0.5 +
                      zscore_series(ma_align) * 0.5)

        # ---- Momentum Factor ----
        ret5 = close.pct_change(5)
        ret20 = close.pct_change(20)
        # RSI
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - 100 / (1 + rs)
        f['momentum'] = (zscore_series(ret5) * 0.3 +
                         zscore_series(ret20) * 0.3 +
                         zscore_series(rsi) * 0.4)

        # ---- Flow Factor (Volume-based) ----
        vol_ratio = volume / volume.rolling(20).mean()
        vol_trend = volume.rolling(5).mean() / volume.rolling(20).mean()
        f['flow'] = (zscore_series(vol_ratio) * 0.5 +
                     zscore_series(vol_trend) * 0.5)

        # Enhance with institutional data if available
        if len(institutional) > 0:
            inst_sym = institutional[institutional['symbol'] == sym].copy()
            if len(inst_sym) > 0:
                inst_sym['date'] = pd.to_datetime(inst_sym['date'])
                inst_sym = inst_sym.set_index('date')
                # 外資買賣超
                if 'buy' in inst_sym.columns and 'sell' in inst_sym.columns:
                    net_buy = inst_sym.groupby(inst_sym.index).apply(
                        lambda x: (x['buy'].sum() - x['sell'].sum())
                    )
                    net_buy = net_buy.reindex(f.index).fillna(0)
                    cum_net = net_buy.rolling(5).sum()
                    f['flow'] = (f['flow'] * 0.4 +
                                 zscore_series(cum_net) * 0.6)

        # ---- Fundamental Factor (placeholder) ----
        f['fundamental'] = 0.0  # 中性

        # ---- Sentiment Factor (placeholder) ----
        f['sentiment'] = 0.0  # 中性

        f['symbol'] = sym
        f = f.reset_index()
        factors_list.append(f)

    if not factors_list:
        return pd.DataFrame()

    all_factors = pd.concat(factors_list, ignore_index=True)
    return all_factors


def zscore_series(s):
    """Rolling Z-Score standardization (60-day window)."""
    mean = s.rolling(60, min_periods=20).mean()
    std = s.rolling(60, min_periods=20).std()
    z = (s - mean) / std.replace(0, np.nan)
    return z.clip(-3, 3).fillna(0)


# ============================================================
# 3. Alphalens Analysis — 因子預測力檢驗
# ============================================================
def run_alphalens_analysis(factors_df, prices_df):
    """
    使用 Alphalens 檢驗每個因子的預測力。
    回傳各因子的 IC (Information Coefficient) 均值。
    """
    try:
        import alphalens
    except ImportError:
        print('  ⚠️ alphalens-reloaded 未安裝，跳過因子分析')
        return {}

    # Prepare pricing data for Alphalens
    prices_df = prices_df.copy()
    prices_df['date'] = pd.to_datetime(prices_df['date'])
    pricing = prices_df.pivot(index='date', columns='symbol', values='close')
    pricing = pricing.sort_index()

    ic_results = {}

    for factor_name in ['trend', 'momentum', 'flow']:
        try:
            # Create factor series with MultiIndex (date, symbol)
            fdf = factors_df[['date', 'symbol', factor_name]].dropna()
            fdf['date'] = pd.to_datetime(fdf['date'])
            fdf = fdf.set_index(['date', 'symbol'])[factor_name]

            if len(fdf) < 100:
                continue

            factor_data = alphalens.utils.get_clean_factor_and_forward_returns(
                fdf, pricing, periods=(5, 20), max_loss=0.5, quantiles=3
            )

            ic = alphalens.performance.factor_information_coefficient(factor_data)
            ic_mean = ic.mean()

            ic_results[factor_name] = {
                'ic_5d': round(float(ic_mean.iloc[0]), 4) if len(ic_mean) > 0 else 0,
                'ic_20d': round(float(ic_mean.iloc[1]), 4) if len(ic_mean) > 1 else 0,
            }
            print(f'  📊 {factor_name}: IC(5d)={ic_results[factor_name]["ic_5d"]:.4f}, IC(20d)={ic_results[factor_name]["ic_20d"]:.4f}')

        except Exception as e:
            print(f'  ⚠️ Alphalens {factor_name} 分析失敗: {e}')
            ic_results[factor_name] = {'ic_5d': 0, 'ic_20d': 0}

    return ic_results


# ============================================================
# 4. VectorBT Backtesting — 參數掃描 & 回測
# ============================================================
def run_vectorbt_backtest(factors_df, prices_df):
    """
    使用 VectorBT 進行多因子權重掃描回測。
    找出最佳因子權重組合。
    """
    try:
        import vectorbt as vbt
    except ImportError:
        print('  [WARN] vectorbt 未安裝，使用自製簡易回測...')
        return run_simple_backtest(factors_df, prices_df)

    prices_df = prices_df.copy()
    prices_df['date'] = pd.to_datetime(prices_df['date'])
    factors_df = factors_df.copy()
    factors_df['date'] = pd.to_datetime(factors_df['date'])

    # 建立價格矩陣 (用 pivot_table 防止重複索引)
    price_matrix = prices_df.pivot_table(index='date', columns='symbol', values='close', aggfunc='last')
    price_matrix = price_matrix.sort_index().dropna(how='all')

    # 權重組合掃描 (trend, momentum, flow)
    weight_grid = []
    for t in np.arange(0.1, 0.8, 0.1):
        for m in np.arange(0.1, 0.8 - t + 0.01, 0.1):
            f = round(1.0 - t - m, 2)
            if f >= 0.05:
                weight_grid.append((round(t, 2), round(m, 2), round(f, 2)))

    print(f'  [SCAN] {len(weight_grid)} weight combos...')

    best_sharpe = -999
    best_weights = (0.3, 0.2, 0.5)
    best_stats = {}
    all_results = []
    best_equity_curve = []

    for (wt, wm, wf) in weight_grid:
        try:
            combo = factors_df.copy()
            combo['score'] = (combo['trend'] * wt +
                              combo['momentum'] * wm +
                              combo['flow'] * wf)

            score_matrix = combo.pivot_table(index='date', columns='symbol', values='score', aggfunc='mean')
            score_matrix = score_matrix.reindex(price_matrix.index).fillna(0)

            # 每日取分數前 30% 的股票作為買入訊號
            threshold = score_matrix.quantile(0.7, axis=1)
            entries = score_matrix.gt(threshold, axis=0)
            exits = score_matrix.lt(score_matrix.quantile(0.3, axis=1), axis=0)

            common_cols = price_matrix.columns.intersection(entries.columns)
            if len(common_cols) == 0:
                continue

            pf = vbt.Portfolio.from_signals(
                price_matrix[common_cols],
                entries[common_cols],
                exits[common_cols],
                init_cash=1_000_000,
                fees=0.001425,
                freq='1D'
            )

            total_return = float(pf.total_return())
            sharpe = float(pf.sharpe_ratio()) if not np.isnan(pf.sharpe_ratio()) else 0
            max_dd = float(pf.max_drawdown())

            result = {
                'weights': {'trend': wt, 'momentum': wm, 'flow': wf,
                           'fundamental': 0.0, 'sentiment': 0.0},
                'total_return': round(total_return * 100, 2),
                'sharpe_ratio': round(sharpe, 4),
                'max_drawdown': round(max_dd * 100, 2),
            }
            all_results.append(result)

            if sharpe > best_sharpe:
                best_sharpe = sharpe
                best_weights = (wt, wm, wf)
                best_stats = result
                try:
                    equity = pf.value()
                    if isinstance(equity, pd.DataFrame):
                        equity = equity.sum(axis=1)
                    best_equity_curve = [
                        {'date': str(d.date()), 'value': round(float(v), 2)}
                        for d, v in equity.iloc[::5].items()
                    ]
                except Exception:
                    best_equity_curve = []

        except Exception as e:
            print(f'  [DEBUG] VBT combo ({wt},{wm},{wf}) failed: {e}')
            continue

    if best_stats:
        print(f'  [OK] Best: trend={best_weights[0]}, momentum={best_weights[1]}, flow={best_weights[2]}')
        print(f'       Sharpe={best_sharpe:.4f}')
    else:
        print(f'  [WARN] No valid backtest results')

    return {
        'best': best_stats,
        'equity_curve': best_equity_curve,
        'all_results': sorted(all_results, key=lambda x: x['sharpe_ratio'], reverse=True)[:10],
    }


def run_simple_backtest(factors_df, prices_df):
    """
    Fallback: 不依賴 VectorBT 的簡易向量化回測。
    """
    prices_df = prices_df.copy()
    prices_df['date'] = pd.to_datetime(prices_df['date'])
    factors_df = factors_df.copy()
    factors_df['date'] = pd.to_datetime(factors_df['date'])

    # 用 pivot_table 而非 pivot，避免重複索引崩潰
    price_matrix = prices_df.pivot_table(index='date', columns='symbol', values='close', aggfunc='last')
    price_matrix = price_matrix.sort_index().dropna(how='all')

    print(f'  [DEBUG] price_matrix shape: {price_matrix.shape}, date range: {price_matrix.index.min()} ~ {price_matrix.index.max()}')

    if price_matrix.shape[0] < 60 or price_matrix.shape[1] == 0:
        print(f'  [WARN] price_matrix too small ({price_matrix.shape}), skipping backtest')
        return {'best': {}, 'equity_curve': [], 'all_results': []}

    # 日報酬率
    returns = price_matrix.pct_change().fillna(0)
    # 清理異常報酬率 (防止 inf 或過大值導致崩潰)
    returns = returns.clip(-0.5, 0.5)  # 單日最大漲跌幅限制
    returns = returns.replace([np.inf, -np.inf], 0)

    # 因子資料對齊
    score_columns = ['trend', 'momentum', 'flow']
    factor_pivot = {}
    for col in score_columns:
        if col in factors_df.columns:
            fp = factors_df.pivot_table(index='date', columns='symbol', values=col, aggfunc='mean')
            fp = fp.reindex(price_matrix.index).fillna(0)
            factor_pivot[col] = fp

    if not factor_pivot:
        print('  [WARN] No factor data could be aligned, skipping backtest')
        return {'best': {}, 'equity_curve': [], 'all_results': []}

    print(f'  [DEBUG] factor columns aligned: {list(factor_pivot.keys())}')

    weight_grid = []
    for t in np.arange(0.1, 0.8, 0.1):
        for m in np.arange(0.1, 0.8 - t + 0.01, 0.1):
            f = round(1.0 - t - m, 2)
            if f >= 0.05:
                weight_grid.append((round(t, 2), round(m, 2), round(f, 2)))

    print(f'  [SCAN] [Simple] {len(weight_grid)} weight combos...')

    best_sharpe = -999
    best_result = {}
    all_results = []
    best_equity_curve = []
    fail_count = 0
    first_error = None

    for (wt, wm, wf) in weight_grid:
        try:
            # 直接用 pre-computed pivot 而非每次重新 pivot
            score_matrix = (
                factor_pivot.get('trend', pd.DataFrame(0, index=price_matrix.index, columns=price_matrix.columns)) * wt +
                factor_pivot.get('momentum', pd.DataFrame(0, index=price_matrix.index, columns=price_matrix.columns)) * wm +
                factor_pivot.get('flow', pd.DataFrame(0, index=price_matrix.index, columns=price_matrix.columns)) * wf
            )

            # 確保只用共同欄位
            common_cols = price_matrix.columns.intersection(score_matrix.columns)
            if len(common_cols) < 2:
                continue

            score_sub = score_matrix[common_cols]
            returns_sub = returns[common_cols]

            # 每日取分數前 30% 的股票持有，等權重
            threshold = score_sub.quantile(0.7, axis=1)
            position = score_sub.gt(threshold, axis=0).astype(float)
            position_count = position.sum(axis=1).replace(0, 1)
            weighted_pos = position.div(position_count, axis=0)

            # 投資組合日報酬
            portfolio_ret = (returns_sub * weighted_pos).sum(axis=1)

            # 扣除交易成本 (簡化)
            turnover = weighted_pos.diff().abs().sum(axis=1).fillna(0)
            portfolio_ret = portfolio_ret - turnover * 0.001425

            # 清理異常值
            portfolio_ret = portfolio_ret.replace([np.inf, -np.inf], 0).fillna(0)

            # 計算績效指標
            cumret = (1 + portfolio_ret).cumprod()

            if len(cumret) == 0 or cumret.iloc[-1] <= 0:
                continue

            total_return = float(cumret.iloc[-1] - 1)

            if np.isnan(total_return) or np.isinf(total_return):
                continue

            # 年化
            n_days = len(cumret)
            ann_ret = ((1 + total_return) ** (252 / max(n_days, 1))) - 1
            ann_vol = float(portfolio_ret.std() * np.sqrt(252))
            sharpe = ann_ret / ann_vol if ann_vol > 0.001 else 0
            max_dd = float((cumret / cumret.cummax() - 1).min())

            # Sanity check
            if np.isnan(sharpe) or np.isinf(sharpe):
                sharpe = 0
            if np.isnan(max_dd) or np.isinf(max_dd):
                max_dd = 0

            result = {
                'weights': {'trend': wt, 'momentum': wm, 'flow': wf,
                           'fundamental': 0.0, 'sentiment': 0.0},
                'total_return': round(total_return * 100, 2),
                'sharpe_ratio': round(sharpe, 4),
                'max_drawdown': round(max_dd * 100, 2),
            }
            all_results.append(result)

            if sharpe > best_sharpe:
                best_sharpe = sharpe
                best_result = result
                # 權益曲線 (每5天取一點)
                best_equity_curve = [
                    {'date': str(d.date()), 'value': round(float(v * 1_000_000), 2)}
                    for d, v in cumret.iloc[::5].items()
                ]

        except Exception as e:
            fail_count += 1
            if first_error is None:
                first_error = str(e)
            if fail_count <= 3:
                print(f'  [DEBUG] Simple combo ({wt},{wm},{wf}) failed: {e}')
            continue

    if fail_count > 0:
        print(f'  [WARN] {fail_count}/{len(weight_grid)} combos failed. First error: {first_error}')

    if best_result:
        bw = best_result['weights']
        print(f'  [OK] Best: trend={bw["trend"]}, momentum={bw["momentum"]}, flow={bw["flow"]}')
        print(f'       Sharpe={best_result["sharpe_ratio"]:.4f}, Return={best_result["total_return"]:.2f}%, MDD={best_result["max_drawdown"]:.2f}%')
    else:
        print(f'  [WARN] No valid backtest results. Checked {len(weight_grid)} combos, {fail_count} failed.')
        print(f'         price_matrix: {price_matrix.shape}, returns range: [{returns.min().min():.4f}, {returns.max().max():.4f}]')

    return {
        'best': best_result,
        'equity_curve': best_equity_curve,
        'all_results': sorted(all_results, key=lambda x: x['sharpe_ratio'], reverse=True)[:10],
    }


# ============================================================
# 5. Main Pipeline
# ============================================================
def main():
    import argparse
    parser = argparse.ArgumentParser(description='🧠 Alpha Research Core')
    parser.add_argument('--symbols', type=str, default='',
                        help='逗號分隔的股票代號 (例: 2330,0050)')
    parser.add_argument('--token', type=str, default='',
                        help='FinMind API Token')
    parser.add_argument('--years', type=int, default=3,
                        help='回測年數 (預設 3)')
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(',') if s.strip()] if args.symbols else DEFAULT_SYMBOLS
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=args.years * 365)).strftime('%Y-%m-%d')

    print(f'\n🧠 Alpha Research Core')
    print(f'   研究期間: {start_date} ~ {end_date}')
    print(f'   股票池: {len(symbols)} 檔')
    print(f'   {"=" * 50}')

    # Step 1: 資料抓取
    print(f'\n📦 Step 1/4: 資料抓取')
    prices, institutional, margin = fetch_data_finmind(symbols, start_date, end_date, args.token)

    if len(prices) == 0:
        print('❌ 無法取得任何資料，請檢查網路連線或 API Token。')
        sys.exit(1)

    print(f'   取得 {prices["symbol"].nunique()} 檔股票，共 {len(prices)} 筆日線資料')

    # Step 2: 因子生成
    print(f'\n🔧 Step 2/4: 因子生成與標準化')
    factors = compute_factors(prices, institutional, margin)

    if len(factors) == 0:
        print('❌ 因子計算失敗，資料可能不足。')
        sys.exit(1)

    print(f'   生成 {factors["symbol"].nunique()} 檔因子資料')

    # Step 3: Alphalens 分析
    print(f'\n📊 Step 3/4: Alphalens 因子預測力分析')
    ic_results = run_alphalens_analysis(factors, prices)

    # Step 4: VectorBT 回測
    print(f'\n🚀 Step 4/4: 多因子權重掃描回測')
    backtest = run_vectorbt_backtest(factors, prices)

    # 組裝結果
    output = {
        'generated_at': datetime.now().isoformat(),
        'research_period': {'start': start_date, 'end': end_date},
        'symbols_count': int(prices['symbol'].nunique()),
        'symbols': sorted(prices['symbol'].unique().tolist()),
        'factor_ic': ic_results,
        'backtest': backtest,
        'recommended_weights': backtest.get('best', {}).get('weights', {
            'trend': 0.30, 'momentum': 0.20, 'flow': 0.20,
            'fundamental': 0.20, 'sentiment': 0.10
        }),
    }

    # 寫入 JSON
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n{"=" * 50}')
    print(f'✅ 研究完成！結果已儲存至: {OUTPUT_FILE}')
    print(f'   推薦權重: {json.dumps(output["recommended_weights"], indent=2)}')
    print()


if __name__ == '__main__':
    main()
