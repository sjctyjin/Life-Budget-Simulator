#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_screener.py — 雙軌制自動選股引擎
Track A: 全市場績優股 Fundamental Top 10 (GARP Strategy)
Track B: 產業資金熱力量測 Sector Momentum (Swing Trading)

Usage:
    python auto_screener.py
    
Output:
    ../js/strategy_data.json
"""

import sys
import os
import json
import time
import warnings
from datetime import datetime, timedelta

import yfinance as yf
import pandas as pd
import numpy as np

warnings.filterwarnings('ignore')

# Force UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ============================================================
# CONFIG: Sector Definitions & Stock Universe
# ============================================================
# Each sector maps to a list of Taiwan stock symbols (without .TW suffix).
# You can freely add/remove symbols here to customize your universe.
SECTORS = {
    "AI伺服器/代工": ["2382", "3231", "2356", "3013", "2353"],
    "散熱模組": ["3017", "3324", "2421", "6230"],
    "IC設計": ["2454", "3661", "5269", "3443", "6547"],
    "半導體設備": ["3532", "6698", "2379"],
    "光通訊": ["3163", "4977", "6285", "2455", "3038"],
    "重電/電力設備": ["1519", "1514", "1513", "1503", "8404"],
    "PCB/載板": ["3037", "8046", "3711", "6269"],
    "晶圓代工/封測": ["2330", "3711", "2311", "3034", "2449"],
    "網通/5G": ["2345", "3045", "4966", "6285"],
    "機器人/自動化": ["2049", "1597", "4523", "3092"],
}

# Flatten all symbols for batch fetching
ALL_SYMBOLS = list(set(sym for syms in SECTORS.values() for sym in syms))

# ============================================================
# HELPER: Safe yfinance fetch with retry
# ============================================================
def safe_ticker_info(symbol_tw, retries=2):
    """Fetch ticker.info with retry logic."""
    for attempt in range(retries):
        try:
            ticker = yf.Ticker(symbol_tw)
            info = ticker.info
            if info and info.get('regularMarketPrice') or info.get('currentPrice'):
                return info
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1)
            else:
                print(f"  [WARN] Failed to fetch info for {symbol_tw}: {e}")
    return None


def safe_ticker_history(symbol_tw, period="6mo", interval="1d"):
    """Fetch historical price data."""
    try:
        ticker = yf.Ticker(symbol_tw)
        df = ticker.history(period=period, interval=interval)
        if df is not None and len(df) > 0:
            return df
    except Exception as e:
        print(f"  [WARN] Failed to fetch history for {symbol_tw}: {e}")
    return None


# ============================================================
# TECHNICAL INDICATORS: MA, MACD, KD
# ============================================================
def compute_technicals(df):
    """Compute key technical indicators from daily OHLCV data."""
    if df is None or len(df) < 60:
        return {
            'ma60_slope': 0, 'macd_hist': 0,
            'k_value': 50, 'd_value': 50,
            'tech_status': 'neutral', 'tech_note': '資料不足'
        }

    close = df['Close'].values.astype(float)

    # --- 60-day Moving Average slope ---
    ma60 = pd.Series(close).rolling(60).mean().values
    ma60_recent = ma60[-5:]  # last 5 days
    ma60_slope = 0
    if not np.isnan(ma60_recent).any() and len(ma60_recent) >= 2:
        ma60_slope = (ma60_recent[-1] - ma60_recent[0]) / (ma60_recent[0] + 1e-9) * 100

    # --- MACD ---
    ema12 = pd.Series(close).ewm(span=12).mean().values
    ema26 = pd.Series(close).ewm(span=26).mean().values
    macd_line = ema12 - ema26
    signal_line = pd.Series(macd_line).ewm(span=9).mean().values
    macd_hist = macd_line[-1] - signal_line[-1]

    # --- KD (Stochastic 9,3,3) ---
    high = df['High'].values.astype(float)
    low = df['Low'].values.astype(float)
    k_period = 9
    if len(close) >= k_period:
        lowest = pd.Series(low).rolling(k_period).min().values
        highest = pd.Series(high).rolling(k_period).max().values
        rsv = (close - lowest) / (highest - lowest + 1e-9) * 100
        k_values = pd.Series(rsv).ewm(com=2).mean().values
        d_values = pd.Series(k_values).ewm(com=2).mean().values
        k_value = k_values[-1] if not np.isnan(k_values[-1]) else 50
        d_value = d_values[-1] if not np.isnan(d_values[-1]) else 50
    else:
        k_value = 50
        d_value = 50

    # --- Determine tech status ---
    if ma60_slope > 0.5 and macd_hist > 0:
        tech_status = 'bull'
        parts = []
        parts.append('季線上揚')
        if macd_hist > 0:
            parts.append('MACD紅柱')
        if k_value > d_value and k_value < 80:
            parts.append('KD多方')
        elif k_value > 80:
            parts.append('KD超買區')
        tech_note = ' / '.join(parts)
    elif ma60_slope < -0.5 and macd_hist < 0:
        tech_status = 'bear'
        parts = ['季線下彎', 'MACD綠柱']
        if k_value < 20:
            parts.append('KD超賣')
        tech_note = ' / '.join(parts)
    else:
        tech_status = 'neutral'
        parts = []
        if abs(ma60_slope) < 0.5:
            parts.append('季線走平')
        elif ma60_slope > 0:
            parts.append('季線微揚')
        else:
            parts.append('季線微彎')
        if macd_hist > 0:
            parts.append('MACD正值')
        else:
            parts.append('MACD負值')
        tech_note = ' / '.join(parts)

    return {
        'ma60_slope': round(ma60_slope, 2),
        'macd_hist': round(float(macd_hist), 2),
        'k_value': round(float(k_value), 1),
        'd_value': round(float(d_value), 1),
        'tech_status': tech_status,
        'tech_note': tech_note
    }


# ============================================================
# SECTOR MOMENTUM: Calculate 5d, 10d, 20d returns per sector
# ============================================================
def compute_sector_momentum(sector_name, symbols, all_histories):
    """Compute average sector returns over 5d, 10d, 20d windows."""
    returns_5d = []
    returns_10d = []
    returns_20d = []
    vol_ratios = []
    stock_details = []

    for sym in symbols:
        sym_tw = f"{sym}.TW"
        df = all_histories.get(sym_tw)
        if df is None or len(df) < 20:
            continue

        close = df['Close'].values.astype(float)
        volume = df['Volume'].values.astype(float)

        # Returns
        if len(close) >= 6:
            r5 = (close[-1] / close[-6] - 1) * 100
            returns_5d.append(r5)
        if len(close) >= 11:
            r10 = (close[-1] / close[-11] - 1) * 100
            returns_10d.append(r10)
        if len(close) >= 21:
            r20 = (close[-1] / close[-21] - 1) * 100
            returns_20d.append(r20)

        # Volume spike: recent 5d avg vs prior 20d avg
        if len(volume) >= 25:
            recent_vol = np.mean(volume[-5:])
            prev_vol = np.mean(volume[-25:-5])
            if prev_vol > 0:
                vol_ratios.append(recent_vol / prev_vol)

        # Individual stock momentum for leader ranking
        r5_val = (close[-1] / close[-6] - 1) * 100 if len(close) >= 6 else 0
        stock_details.append({
            'symbol': sym,
            'return_5d': round(r5_val, 2),
            'current_price': round(float(close[-1]), 2)
        })

    avg_5d = round(np.mean(returns_5d), 2) if returns_5d else 0
    avg_10d = round(np.mean(returns_10d), 2) if returns_10d else 0
    avg_20d = round(np.mean(returns_20d), 2) if returns_20d else 0
    avg_vol_spike = round(np.mean(vol_ratios), 2) if vol_ratios else 1.0

    # Momentum score = weighted combination
    momentum_score = round(avg_5d * 0.5 + avg_10d * 0.3 + avg_20d * 0.2, 2)

    # Sort stock leaders by 5d return (strongest first)
    stock_details.sort(key=lambda x: x['return_5d'], reverse=True)

    return {
        'sector': sector_name,
        'avg_return_5d': avg_5d,
        'avg_return_10d': avg_10d,
        'avg_return_20d': avg_20d,
        'volume_spike': avg_vol_spike,
        'momentum_score': momentum_score,
        'stock_count': len(stock_details),
        'leaders': stock_details[:5]  # top 5 leaders per sector
    }


# ============================================================
# TRACK A: Fundamental Top 10 (GARP Strategy)
# ============================================================
def build_fundamental_top10(all_infos, all_histories):
    """Score and rank stocks by GARP criteria."""
    candidates = []

    for sym_tw, info in all_infos.items():
        if info is None:
            continue

        sym = sym_tw.replace('.TW', '').replace('.TWO', '')
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        if price <= 0:
            continue

        target_mean = info.get('targetMeanPrice')
        target_high = info.get('targetHighPrice')
        forward_pe = info.get('forwardPE')
        trailing_pe = info.get('trailingPE')
        forward_eps = info.get('forwardEps')
        trailing_eps = info.get('trailingEps')
        revenue_growth = info.get('revenueGrowth')  # decimal, e.g. 0.55 = 55%
        dividend_yield = info.get('dividendYield') or 0  # decimal
        market_cap = info.get('marketCap') or 0
        short_name = info.get('shortName') or sym
        sector_name = info.get('sector') or ''
        recommendation = info.get('recommendationKey') or ''

        # Determine PE to use (prefer forward, fallback to trailing)
        pe = forward_pe if forward_pe and forward_pe > 0 else (trailing_pe if trailing_pe and trailing_pe > 0 else None)
        eps = forward_eps if forward_eps else (trailing_eps if trailing_eps else None)

        # Must be profitable
        if eps is not None and eps <= 0:
            continue

        # Upside calculation
        upside = 0
        if target_mean and target_mean > 0:
            upside = round((target_mean / price - 1) * 100, 1)

        # Revenue growth as percentage
        rev_growth_pct = round(revenue_growth * 100, 1) if revenue_growth else 0

        # --- Scoring ---
        # Upside score (0~100, 60% weight)
        upside_score = min(max(upside, 0), 50) * 2  # cap at 50% = 100 score

        # Growth score (0~100, 40% weight)
        growth_score = min(max(rev_growth_pct, 0), 100)  # cap at 100%

        # PE penalty (if PE > 40, deduct points)
        pe_penalty = 0
        if pe and pe > 40:
            pe_penalty = min((pe - 40) * 1.5, 40)

        total_score = round(upside_score * 0.6 + growth_score * 0.4 - pe_penalty, 1)

        # Evaluation label
        if pe and pe < 25 and upside > 20:
            evaluation = 'cheap'
        elif pe and pe > 40 or upside < 5:
            evaluation = 'expensive'
        else:
            evaluation = 'fair'

        # Technicals
        tech = compute_technicals(all_histories.get(sym_tw))

        candidates.append({
            'symbol': sym,
            'name': short_name,
            'sector': sector_name,
            'price': round(price, 2),
            'targetPrice': round(target_mean, 2) if target_mean else None,
            'targetHigh': round(target_high, 2) if target_high else None,
            'upside': upside,
            'pe': round(pe, 1) if pe else None,
            'eps': round(eps, 2) if eps else None,
            'revenueGrowth': rev_growth_pct,
            'dividendYield': round(min(dividend_yield * 100, 15), 2) if dividend_yield else 0,
            'marketCap': round(market_cap / 1e8, 0) if market_cap else 0,  # in 億
            'recommendation': recommendation,
            'score': total_score,
            'evaluation': evaluation,
            'techStatus': tech['tech_status'],
            'techNote': tech['tech_note'],
            'kValue': tech['k_value'],
            'dValue': tech['d_value'],
            'macdHist': tech['macd_hist'],
        })

    # Sort by score descending, take top 10
    candidates.sort(key=lambda x: x['score'], reverse=True)
    for i, c in enumerate(candidates[:10]):
        c['rank'] = i + 1

    return candidates[:10]


# ============================================================
# TRACK B: Hot Sectors with Leaders
# ============================================================
def build_sector_heatmap(all_histories, all_infos):
    """Build sector momentum rankings and identify leaders."""
    sector_results = []

    for sector_name, symbols in SECTORS.items():
        result = compute_sector_momentum(sector_name, symbols, all_histories)

        # Enrich leaders with fundamental data
        for leader in result['leaders']:
            sym_tw = f"{leader['symbol']}.TW"
            info = all_infos.get(sym_tw, {}) or {}
            tech = compute_technicals(all_histories.get(sym_tw))
            leader['name'] = info.get('shortName') or leader['symbol']
            leader['pe'] = round(info.get('forwardPE') or info.get('trailingPE') or 0, 1)
            leader['eps'] = round(info.get('forwardEps') or info.get('trailingEps') or 0, 2)
            leader['targetPrice'] = round(info.get('targetMeanPrice') or 0, 2)
            leader['upside'] = round((leader['targetPrice'] / leader['current_price'] - 1) * 100, 1) if leader['targetPrice'] and leader['current_price'] > 0 else 0
            leader['techStatus'] = tech['tech_status']
            leader['techNote'] = tech['tech_note']
            leader['dividendYield'] = round(min((info.get('dividendYield') or 0) * 100, 15), 2)

        sector_results.append(result)

    # Sort sectors by momentum score
    sector_results.sort(key=lambda x: x['momentum_score'], reverse=True)

    # Assign heat level
    for i, s in enumerate(sector_results):
        if s['momentum_score'] > 3:
            s['heat'] = 'hot'
        elif s['momentum_score'] > 0:
            s['heat'] = 'warm'
        else:
            s['heat'] = 'cold'

    return sector_results


# ============================================================
# MAIN
# ============================================================
def main():
    print("=" * 60)
    print("  🧪 自組強勢 ETF — 雙軌制自動選股引擎")
    print("=" * 60)
    print(f"  執行時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  觀察股票池: {len(ALL_SYMBOLS)} 檔")
    print(f"  板塊數量: {len(SECTORS)} 個")
    print()

    # --- Step 1: Batch fetch all info ---
    print("[1/3] 正在從 Yahoo Finance 抓取基本面資料...")
    all_infos = {}
    for i, sym in enumerate(ALL_SYMBOLS):
        sym_tw = f"{sym}.TW"
        print(f"  ({i+1}/{len(ALL_SYMBOLS)}) {sym_tw}...", end=' ')
        info = safe_ticker_info(sym_tw)
        if info:
            all_infos[sym_tw] = info
            price = info.get('currentPrice') or info.get('regularMarketPrice') or '?'
            print(f"OK (${price})")
        else:
            all_infos[sym_tw] = None
            print("SKIP")
        time.sleep(0.3)  # Rate limiting

    # --- Step 2: Batch fetch all histories ---
    print(f"\n[2/3] 正在抓取歷史股價 (6個月日K)...")
    all_histories = {}
    for i, sym in enumerate(ALL_SYMBOLS):
        sym_tw = f"{sym}.TW"
        print(f"  ({i+1}/{len(ALL_SYMBOLS)}) {sym_tw}...", end=' ')
        df = safe_ticker_history(sym_tw, period="6mo", interval="1d")
        if df is not None:
            all_histories[sym_tw] = df
            print(f"OK ({len(df)} bars)")
        else:
            print("SKIP")
        time.sleep(0.2)

    # --- Step 3: Build results ---
    print(f"\n[3/3] 正在運算選股評分與板塊熱力...")

    fundamental_top10 = build_fundamental_top10(all_infos, all_histories)
    sector_heatmap = build_sector_heatmap(all_histories, all_infos)

    # --- Output JSON ---
    output = {
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'stockCount': len(ALL_SYMBOLS),
        'sectorCount': len(SECTORS),
        'fundamentalTop10': fundamental_top10,
        'hotSectors': sector_heatmap
    }

    output_path = os.path.join(os.path.dirname(__file__), '..', 'js', 'strategy_data.json')
    output_path = os.path.abspath(output_path)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print(f"  ✅ 完成！資料已輸出到:")
    print(f"  {output_path}")
    print(f"{'=' * 60}")
    print(f"\n  📊 績優股 Top 10:")
    for s in fundamental_top10:
        print(f"     #{s['rank']} {s['symbol']} {s['name']} | ${s['price']} | PE {s.get('pe', '?')} | 空間 {s['upside']}% | [{s['evaluation']}]")

    print(f"\n  🔥 產業熱力排行:")
    for s in sector_heatmap[:5]:
        heat_icon = {'hot': '🔥', 'warm': '🌡️', 'cold': '❄️'}.get(s['heat'], '❓')
        print(f"     {heat_icon} {s['sector']} | 動能 {s['momentum_score']} | 5日 {s['avg_return_5d']}% | 量能 {s['volume_spike']}x")

    print(f"\n  請開啟 http://localhost:8080/strategy.html 查看儀表板！")


if __name__ == '__main__':
    main()
