initial_savings = 1000000
stock_0050 = 8295 * 76.75
stock_006208 = 3000 * 178.15
stock_00878 = 10000 * 22.37
stock_2367 = 1000 * 68.7
stock_2885 = 7400 * 45.85
stock_00679B = 7000 * 27.65
stock_00933B = 10000 * 16.43
stock_tsla = 20 * 405.55 * 32

total_stock_value = stock_0050 + stock_006208 + stock_00878 + stock_2367 + stock_2885 + stock_00679B + stock_00933B + stock_tsla

monthly_income = 59000
bonus = 59000 * 2.5
annual_income = monthly_income * 12 + bonus

monthly_fixed = 12500 + 2000 + 1000 + 4500 + 2500 # 22500
monthly_var = 7000 + 3000 + 3000 + 1500 + 12000 # 26500
monthly_debt = 10527 # ends in 5 years
annual_expenses = (monthly_fixed + monthly_var + monthly_debt) * 12

print(f"Initial Stocks: {total_stock_value:,.0f}")
print(f"Annual Income: {annual_income:,.0f}")
print(f"Annual Expenses: {annual_expenses:,.0f}")
print(f"Net Yearly Cash Flow (Yr 1-5): {annual_income - annual_expenses:,.0f}")

# Weighted Return
weights = [stock_0050, stock_006208, stock_00878, stock_2367, stock_2885, stock_00679B, stock_00933B, stock_tsla]
returns = [0.1281, 0.1376, 0.0736, 0.0895, 0.0788, -0.0343, 0.015, 0.10]
weighted_return = sum([w/total_stock_value * r for w, r in zip(weights, returns)])

print(f"Weighted Return: {weighted_return:.2%}")

# Quick compound for 56 years (age 29 to 85)
current_nw = initial_savings + total_stock_value - 600000
print(f"Initial Net Worth: {current_nw:,.0f}")

current_portfolio = total_stock_value
for year in range(56):
    current_portfolio *= (1 + weighted_return)
    # add some savings
    if year > 5:
        annual_expenses = (monthly_fixed + monthly_var) * 12 
    annual_income *= 1.02 # 2% raise
    savings = annual_income - annual_expenses
    if savings > 0:
        current_portfolio += savings

print(f"Final Portfolio at 85 (Nominal): {current_portfolio:,.0f}")
