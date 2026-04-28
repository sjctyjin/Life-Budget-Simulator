import yfinance as yf
import json

symbols = ['2330.TW', '3017.TW', '2382.TW', 'AAPL']
results = {}

for sym in symbols:
    ticker = yf.Ticker(sym)
    info = ticker.info
    results[sym] = {
        'currentPrice': info.get('currentPrice'),
        'targetMeanPrice': info.get('targetMeanPrice'),
        'targetHighPrice': info.get('targetHighPrice'),
        'forwardPE': info.get('forwardPE'),
        'trailingPE': info.get('trailingPE'),
        'forwardEps': info.get('forwardEps'),
        'trailingEps': info.get('trailingEps'),
        'recommendationKey': info.get('recommendationKey')
    }

print(json.dumps(results, indent=2))
