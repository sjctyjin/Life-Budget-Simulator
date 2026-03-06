import numpy as np
years = 60
initial_savings = 500000 
monthly_income = 50000
monthly_expenses = 20000 + 10000 
monthly_savings = monthly_income - monthly_expenses
annual_contribution = monthly_savings * 12
annual_mean_return = 0.08
investment_values = [initial_savings]

for _ in range(years):
    new_value = investment_values[-1] * (1 + annual_mean_return) + annual_contribution
    investment_values.append(new_value)
    
print(f"Final Value after {years} years: {investment_values[-1]:,.0f}")
