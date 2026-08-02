import { Allele, Genotype } from '../../shared/types';
import { GENE_INFO } from '../data/species';

// ============================================================================
// 服务端遗传规则的唯一真源（无副作用）。
// 真实杂交“抽样”得到一个后代，预览“枚举”得到精确分布——二者都只依赖本文件里
// 同一套原语：配子分离(pickAllele) + 等位基因翻转(flipAllele) + 突变决策(shouldMutate)。
// 任何一处修改这些原语，真实杂交与预览会同时改变，从而保证两条流程口径永远一致。
// ============================================================================

// 随机源抽象：默认用 Math.random，测试可注入确定性序列以验证抽样遵循同一规则。
export type RandomSource = () => number;

export const defaultRandomSource: RandomSource = () => Math.random();

// ---- 原语 1：配子分离 ----
// 一个亲本在某基因位点贡献哪个槽位：按随机数选槽位 0 或 1（各 0.5）。
export function pickSlot(draw: number): 0 | 1 {
  return draw < 0.5 ? 0 : 1;
}

// 兼容旧签名：直接返回选中的等位基因。
export function pickAllele(pair: [Allele, Allele], draw: number): Allele {
  return pair[pickSlot(draw)];
}

// ---- 原语 2：等位基因翻转（突变的确定性部分） ----
export function flipAllele(allele: Allele, gene: keyof Genotype): Allele {
  const info = GENE_INFO[gene];
  return allele === info.dominantAllele ? info.recessiveAllele : info.dominantAllele;
}

// ---- 原语 3：突变决策（突变的随机部分） ----
export function shouldMutate(draw: number, mutationRate: number): boolean {
  return draw < mutationRate;
}

// 对单个等位基因槽位应用突变（供旧调用点复用）。
export function maybeMutate(allele: Allele, gene: keyof Genotype, draw: number, mutationRate: number): Allele {
  return shouldMutate(draw, mutationRate) ? flipAllele(allele, gene) : allele;
}

// ============================================================================
// 唯一决策函数：给定“选中的槽位”和“是否突变”，产出贡献到后代的等位基因。
// 真实杂交的抽样与预览的枚举都必须经由本函数——它是两条流程的单一真源，
// 因此二者不可能出现遗传结果不一致（改这里，两边同时改变）。
// ============================================================================
export function contributeAllele(
  sourcePair: [Allele, Allele],
  gene: keyof Genotype,
  slot: 0 | 1,
  mutate: boolean
): Allele {
  const inherited = sourcePair[slot];
  return mutate ? flipAllele(inherited, gene) : inherited;
}

// 单株每个等位基因位点独立发生突变的概率。基础 2%，UV 0-100 线性放大 1~5 倍。
export function getMutationRate(uvLevel: number): number {
  const baseMutationRate = 0.02;
  const uvMultiplier = 1 + (uvLevel / 100) * 4;
  return baseMutationRate * uvMultiplier;
}

// ---- 抽样：真实杂交从规则中取一个结果 ----
// 抽两个随机数（分离 + 突变），交给唯一决策函数 contributeAllele 产出结果。
export function sampleContributedAllele(
  sourcePair: [Allele, Allele],
  gene: keyof Genotype,
  mutationRate: number,
  rng: RandomSource
): Allele {
  const slot = pickSlot(rng());
  const mutate = shouldMutate(rng(), mutationRate);
  return contributeAllele(sourcePair, gene, slot, mutate);
}

// ---- 枚举：预览从规则中得到精确分布 ----
export type AlleleOutcome = { allele: Allele; probability: number };

// 枚举 sampleContributedAllele 的完整决策空间：槽位 {0,1} 各占 0.5，
// 每个槽位再按突变率展开 {突变, 不突变}。每个分支都调用同一 contributeAllele，
// 保证枚举出的分布正是抽样的精确分布。
export function enumerateContributedAllele(
  sourcePair: [Allele, Allele],
  gene: keyof Genotype,
  mutationRate: number
): AlleleOutcome[] {
  const outcomes = new Map<Allele, number>();
  const add = (allele: Allele, probability: number): void => {
    outcomes.set(allele, (outcomes.get(allele) ?? 0) + probability);
  };

  const slots: (0 | 1)[] = [0, 1];
  const slotWeight = 0.5;
  for (const slot of slots) {
    // 突变发生：权重 = mutationRate。
    add(contributeAllele(sourcePair, gene, slot, true), slotWeight * mutationRate);
    // 突变未发生：权重 = 1 - mutationRate。
    add(contributeAllele(sourcePair, gene, slot, false), slotWeight * (1 - mutationRate));
  }

  return [...outcomes.entries()].map(([allele, probability]) => ({ allele, probability }));
}
