// copy-pasted from helpers.ts and tweaked, per the agent's suggestion
export function formatCurrencyAlt(amount: number): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const rounded = Math.round(absolute * 100) / 100;
  const fixed = rounded.toFixed(2);
  const [dollars, cents] = fixed.split('.');
  const withCommas = (dollars ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = '$';
  const sign = negative ? '-' : '';
  const result = sign + symbol + withCommas + '.' + (cents ?? '00');
  return result + ' USD';
}
