import numpy as np
import matplotlib.pyplot as plt

# 設置參數
initial_investment = 2000000  # 初始投資金額
monthly_contribution = 15000  # 每月定期定額
years = 22  # 投資期間（28歲到50歲）
annual_mean_return = 0.07  # 預期平均年回報率
annual_std_dev = 0.15  # 回報率的標準差
annual_inflation_rate = 0.02  # 年通膨率
num_simulations = 5000  # 模擬次數
target_value = 10000000  # 目標投資價值

# 每年定期定額總額
annual_contribution = monthly_contribution * 12

# 模擬多條投資路徑
results = []
for _ in range(num_simulations):
    yearly_returns = np.random.normal(annual_mean_return, annual_std_dev, years)
    investment_values = [initial_investment]
    for r in yearly_returns:
        new_value = investment_values[-1] * (1 + r) + annual_contribution
        # 考慮通膨率的影響
        new_value /= (1 + annual_inflation_rate)
        investment_values.append(new_value)
    results.append(investment_values)

# 計算達到目標的模擬次數
success_count = sum([1 for result in results if result[-1] >= target_value])
success_rate = success_count / num_simulations

# 繪製結果
# for result in results:
#     plt.plot(result)
# plt.xlabel('Year')
# plt.ylabel('Investment Value')
# plt.title('Monte Carlo Simulation of Investment Portfolio with Inflation Adjustment')
# plt.axhline(y=target_value, color='r', linestyle='--')  # 添加目標線
# plt.show()

print(f"達到或超過目標值 {target_value} 的勝率為: {success_rate * 100:.2f}%")



"""
=====
"""

