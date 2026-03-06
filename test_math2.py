import numpy as np

# Average Taiwan scenario
years = 60 # Age 25 to 85
initial_investment = 500000 
monthly_contribution = 15000 
annual_mean_return = 0.08  
annual_inflation_rate = 0.02

# 1. No inflation adjustment (Nominal value)
investment_values_nominal = [initial_investment]
for _ in range(years):
    new_value = investment_values_nominal[-1] * (1 + annual_mean_return) + (monthly_contribution * 12)
    investment_values_nominal.append(new_value)

# 2. With inflation adjustment (Real value)
investment_values_real = [initial_investment]
for _ in range(years):
    new_value = investment_values_real[-1] * (1 + annual_mean_return) + (monthly_contribution * 12)
    new_value /= (1 + annual_inflation_rate)
    investment_values_real.append(new_value)

print(f"年化報酬8%, 每月存1.5萬, 經過60年 (25歲到85歲):")
print(f"-> 帳面數字 (無通膨折現): {investment_values_nominal[-1]:,.0f} 元")
print(f"-> 實質購買力 (通膨2%折現): {investment_values_real[-1]:,.0f} 元")
