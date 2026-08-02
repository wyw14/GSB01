/**
 * 将一组 0~1 的精确概率转换为 0~100、保留两位小数的百分比字符串。
 * 使用最大余数法：先按 0.01% 为最小单位向下取整，再把剩余单位依次分给
 * 小数部分最大的项，保证舍入后的百分比合计恰好为 100.00%。
 * 前提：输入概率构成完整分布（合计为 1，允许微小浮点误差）。
 */
export function roundPercentages(probabilities: number[]): string[] {
  if (probabilities.length === 0) return [];

  const TOTAL_UNITS = 10000; // 100.00% 按 0.01% 一个单位
  const exact = probabilities.map(p => p * TOTAL_UNITS);
  // +1e-9 抵消浮点误差，避免 0.109375*10000=1093.749999... 被错误取整
  const base = exact.map(v => Math.floor(v + 1e-9));
  let remaining = TOTAL_UNITS - base.reduce((sum, v) => sum + v, 0);

  const byFraction = exact
    .map((v, i) => ({ i, fraction: v - Math.floor(v + 1e-9) }))
    .sort((a, b) => b.fraction - a.fraction);

  // 正常分布下 0 <= remaining < 项数；循环取模仅作浮点异常的兜底
  for (let k = 0; remaining > 0; k = (k + 1) % byFraction.length) {
    base[byFraction[k].i] += 1;
    remaining -= 1;
  }

  return base.map(units => (units / 100).toFixed(2));
}
