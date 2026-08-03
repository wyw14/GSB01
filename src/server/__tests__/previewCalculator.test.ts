import * as assert from 'assert';
import { Plant, Genotype, Allele } from '../../shared/types';
import { calculateCrossBreedPreview } from '../genetics/previewCalculator';
import { getMutationRate, crossAndMutateGenotype, getSingleGeneDistribution } from '../genetics/mendel';
import { genotypeToPhenotype } from '../genetics/genotypeToPhenotype';

function makePlant(
  id: string,
  genotype: Genotype,
  generation = 0
): Plant {
  const phenotype = genotypeToPhenotype(genotype);
  return {
    id,
    name: `Test-${id}`,
    genotype,
    phenotype,
    generation,
    isMutant: false
  };
}

function makeGenotype(
  glowColor: [Allele, Allele],
  leafShape: [Allele, Allele],
  plantSize: [Allele, Allele],
  glowIntensity: [Allele, Allele],
  specialTrait: [Allele, Allele]
): Genotype {
  return { glowColor, leafShape, plantSize, glowIntensity, specialTrait };
}

const ALL_DOMINANT = makeGenotype(
  ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']
);
const ALL_RECESSIVE = makeGenotype(
  ['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'], ['e', 'e']
);
const ALL_HETEROZYGOUS = makeGenotype(
  ['A', 'a'], ['B', 'b'], ['C', 'c'], ['D', 'd'], ['E', 'e']
);

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

function approxEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) < epsilon;
}

function hasTwoDecimals(val: number): boolean {
  const rounded = Math.round(val * 100) / 100;
  return Math.abs(val - rounded) < 1e-9;
}

console.log('\n🧪 杂交预览计算器测试\n');

console.log('1. 纯合亲本测试 (UV=0)');

test('AA × aa 在UV=0时绝大多数为杂合显性表型（含极低突变率）', () => {
  const p1 = makePlant('p1', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['a', 'a'], ['b', 'b'], ['c', 'c'], ['d', 'd'], ['e', 'e']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const glowColor = preview.traitProbabilities.find(t => t.gene === 'glowColor')!;
  const cyan = glowColor.phenotypes.find(p => p.label === 'cyan')!;
  assert.ok(cyan.probability > 95, `Expected cyan >95%, got ${cyan.probability}%`);
  const sum = glowColor.phenotypes.reduce((a, p) => a + p.probability, 0);
  assert.ok(approxEqual(sum, 100, 0.01), `Sum should be 100%, got ${sum}%`);
});

test('纯合显性 × 纯合隐性，UV=0时表型几乎全为显性（基础突变率2%）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  for (const genePreview of preview.traitProbabilities) {
    const sum = genePreview.phenotypes.reduce((a, p) => a + p.probability, 0);
    assert.ok(approxEqual(sum, 100, 0.01),
      `${genePreview.gene} sum should be 100%, got ${sum}%`);
    const dominantP = genePreview.phenotypes.find(p =>
      p.label === 'cyan' || p.label === 'crystalline' || p.label === 'giant' ||
      p.label === 'bright' || p.label === 'floating'
    );
    assert.ok(dominantP, `Should have dominant phenotype for ${genePreview.gene}`);
    assert.ok(dominantP!.probability > 95,
      `${genePreview.gene} dominant should be >95%, got ${dominantP!.probability}%`);
  }
});

console.log('\n2. 杂合亲本测试 (UV=0)');

test('Aa × Aa 应产生约75%显性表型, 约25%隐性表型（含基础突变）', () => {
  const p1 = makePlant('p1', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const glowColor = preview.traitProbabilities.find(t => t.gene === 'glowColor')!;
  const cyan = glowColor.phenotypes.find(p => p.label === 'cyan')!;
  const magenta = glowColor.phenotypes.find(p => p.label === 'magenta')!;

  assert.ok(cyan.probability > 70 && cyan.probability < 80,
    `Expected cyan ~75%, got ${cyan.probability}%`);
  assert.ok(magenta.probability > 20 && magenta.probability < 30,
    `Expected magenta ~25%, got ${magenta.probability}%`);
  const sum = cyan.probability + magenta.probability;
  assert.ok(approxEqual(sum, 100, 0.01), `Sum should be 100%, got ${sum}%`);
});

test('全杂合 × 全杂合，每个性状显性概率应约为75%', () => {
  const p1 = makePlant('p1', ALL_HETEROZYGOUS);
  const p2 = makePlant('p2', ALL_HETEROZYGOUS);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  for (const genePreview of preview.traitProbabilities) {
    const sum = genePreview.phenotypes.reduce((acc, p) => acc + p.probability, 0);
    assert.ok(approxEqual(sum, 100, 0.02),
      `${genePreview.gene} probabilities should sum to 100%, got ${sum.toFixed(2)}%`);

    if (genePreview.gene !== 'specialTrait') {
      const dominantP = genePreview.phenotypes.find(p =>
        p.label === 'cyan' || p.label === 'crystalline' || p.label === 'giant' || p.label === 'bright'
      );
      if (dominantP) {
        assert.ok(dominantP.probability > 70 && dominantP.probability < 80,
          `${genePreview.gene} dominant should be ~75%, got ${dominantP.probability}%`);
      }
    }
  }
});

console.log('\n3. UV突变概率测试');

test('UV=0时突变概率应约为18.29%（10个等位基因，每个2%）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const expected = (1 - Math.pow(1 - 0.02, 10)) * 100;
  assert.ok(approxEqual(preview.mutationProbability, expected, 0.05),
    `Expected ~${expected.toFixed(2)}%, got ${preview.mutationProbability}%`);
});

test('UV=100时突变概率应约为65.13%（每个等位基因10%）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 100, []);

  const mutationRate = getMutationRate(100);
  const expected = (1 - Math.pow(1 - mutationRate, 10)) * 100;
  assert.ok(approxEqual(preview.mutationProbability, expected, 0.1),
    `Expected ~${expected.toFixed(2)}%, got ${preview.mutationProbability}%`);
  assert.ok(preview.mutationProbability > 50, 'UV=100 should have high mutation rate');
});

test('UV=100比UV=0有更高的突变概率', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview0 = calculateCrossBreedPreview(p1, p2, 0, []);
  const preview100 = calculateCrossBreedPreview(p1, p2, 100, []);

  assert.ok(preview100.mutationProbability > preview0.mutationProbability,
    `UV=100 (${preview100.mutationProbability}%) should be > UV=0 (${preview0.mutationProbability}%)`);
});

console.log('\n4. 概率合计测试');

test('每个性状的概率舍入后合计必须为100.00%', () => {
  const p1 = makePlant('p1', ALL_HETEROZYGOUS);
  const p2 = makePlant('p2', ALL_HETEROZYGOUS);

  for (const uv of [0, 25, 50, 75, 100]) {
    const preview = calculateCrossBreedPreview(p1, p2, uv, []);
    for (const genePreview of preview.traitProbabilities) {
      const sum = genePreview.phenotypes.reduce((acc, p) => acc + p.probability, 0);
      assert.ok(Math.abs(sum - 100) < 0.001,
        `UV=${uv}, ${genePreview.gene}: sum=${sum.toFixed(4)}%, should be 100.00%`);
    }
  }
});

test('所有概率值保留两位小数', () => {
  const p1 = makePlant('p1', ALL_HETEROZYGOUS);
  const p2 = makePlant('p2', makeGenotype(['A', 'A'], ['b', 'b'], ['C', 'c'], ['d', 'd'], ['E', 'e']));
  const preview = calculateCrossBreedPreview(p1, p2, 37, []);

  for (const genePreview of preview.traitProbabilities) {
    for (const entry of genePreview.phenotypes) {
      assert.ok(hasTwoDecimals(entry.probability),
        `${entry.label}: ${entry.probability} should have 2 decimal places`);
    }
  }
  assert.ok(hasTwoDecimals(preview.mutationProbability),
    `mutationProbability: ${preview.mutationProbability} should have 2 decimal places`);
  for (const sp of preview.speciesUnlockProbabilities) {
    assert.ok(hasTwoDecimals(sp.probability),
      `${sp.speciesName}: ${sp.probability} should have 2 decimal places`);
  }
});

console.log('\n5. 物种解锁概率测试');

test('全显 × 全隐（UV=0），后代全杂合，不应解锁星辉巨灵（需全显纯合）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const starlight = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'starlight-titan');
  assert.ok(!starlight || starlight.probability === 0,
    'starlight-titan should not be unlockable from this cross');
});

test('全显 × 全显（UV=0），后代几乎必为全显纯合，星辉巨灵概率应极高', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const starlight = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'starlight-titan');
  assert.ok(starlight, 'starlight-titan should appear in unlock probabilities');
  assert.ok(starlight!.probability > 80,
    `Expected >80%, got ${starlight!.probability}%`);
});

test('全隐 × 全隐（UV=0），后代几乎必为全隐纯合，深渊暗灵概率应极高', () => {
  const p1 = makePlant('p1', ALL_RECESSIVE);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const abyss = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'abyss-spirit');
  assert.ok(abyss, 'abyss-spirit should appear in unlock probabilities');
  assert.ok(abyss!.probability > 80,
    `Expected >80%, got ${abyss!.probability}%`);
});

test('多个物种条件重叠时，高优先级物种应阻止低优先级物种（主结果）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const starlight = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'starlight-titan');
  assert.ok(starlight && starlight.probability > 80, 'starlight-titan should be the primary result');

  const crystalMoss = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'crystal-moss');
  if (crystalMoss) {
    assert.ok(crystalMoss.probability < starlight!.probability,
      'crystal-moss should have lower probability than starlight-titan due to priority');
  }
});

test('已解锁的物种不应出现在解锁概率列表中', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);
  const preview = calculateCrossBreedPreview(p1, p2, 0, ['starlight-titan']);

  const starlight = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'starlight-titan');
  assert.ok(!starlight, 'Already unlocked species should not appear');

  const hasOtherSpecies = preview.speciesUnlockProbabilities.length > 0;
  assert.ok(hasOtherSpecies, 'Should show other locked species that can match');
});

test('浮空晶莲需要EE纯合，Ee × Ee 在无更高优先级物种干扰时有合理概率', () => {
  const p1 = makePlant('p1', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'c'], ['D', 'd'], ['E', 'e']));
  const p2 = makePlant('p2', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'c'], ['D', 'd'], ['E', 'e']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const floating = preview.speciesUnlockProbabilities.find(s => s.speciesId === 'floating-lotus');
  assert.ok(floating, 'floating-lotus should appear');
  assert.ok(floating!.probability > 15 && floating!.probability < 30,
    `Expected ~22% (accounting for overlapping species), got ${floating!.probability}%`);
});

test('七个物种均未解锁时，结果应包含全部7个物种（含概率0.00%）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  assert.strictEqual(preview.speciesUnlockProbabilities.length, 7,
    `应返回7个未解锁物种，实际${preview.speciesUnlockProbabilities.length}个`);

  const zeroCount = preview.speciesUnlockProbabilities.filter(s => s.probability === 0).length;
  assert.ok(zeroCount > 0, '应至少有一个物种概率为0.00%');

  const allHaveTwoDecimals = preview.speciesUnlockProbabilities.every(s =>
    Math.abs(Math.round(s.probability * 100) / 100 - s.probability) < 1e-9
  );
  assert.ok(allHaveTwoDecimals, '所有物种概率应保留两位小数');
});

test('已解锁部分物种时，只返回未解锁的物种', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);
  const preview = calculateCrossBreedPreview(p1, p2, 0, ['starlight-titan', 'crystal-moss']);

  assert.strictEqual(preview.speciesUnlockProbabilities.length, 5,
    '应返回5个未解锁物种');
  assert.ok(!preview.speciesUnlockProbabilities.find(s => s.speciesId === 'starlight-titan'),
    '已解锁物种不应出现');
  assert.ok(!preview.speciesUnlockProbabilities.find(s => s.speciesId === 'crystal-moss'),
    '已解锁物种不应出现');
});

console.log('\n6. 纯合与杂合组合测试');

test('AA × Aa 在UV=0时表型几乎全为显性', () => {
  const p1 = makePlant('p1', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const glowColor = preview.traitProbabilities.find(t => t.gene === 'glowColor')!;
  const cyan = glowColor.phenotypes.find(p => p.label === 'cyan')!;
  assert.ok(cyan.probability > 95, `Expected cyan >95%, got ${cyan.probability}%`);
});

test('aa × Aa 在UV=0时表型约50%显性50%隐性', () => {
  const p1 = makePlant('p1', makeGenotype(['a', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const glowColor = preview.traitProbabilities.find(t => t.gene === 'glowColor')!;
  const cyan = glowColor.phenotypes.find(p => p.label === 'cyan');
  const magenta = glowColor.phenotypes.find(p => p.label === 'magenta');

  assert.ok(cyan && cyan.probability > 40 && cyan.probability < 60,
    `Expected cyan ~50%, got ${cyan?.probability}%`);
  assert.ok(magenta && magenta.probability > 40 && magenta.probability < 60,
    `Expected magenta ~50%, got ${magenta?.probability}%`);
});

console.log('\n7. 只读性和无副作用测试');

test('多次连续预览应返回相同结果（无随机性）', () => {
  const p1 = makePlant('p1', ALL_HETEROZYGOUS);
  const p2 = makePlant('p2', ALL_HETEROZYGOUS);

  const results: string[] = [];
  for (let i = 0; i < 10; i++) {
    const preview = calculateCrossBreedPreview(p1, p2, 50, []);
    results.push(JSON.stringify(preview));
  }

  const allSame = results.every(r => r === results[0]);
  assert.ok(allSame, 'Preview should be deterministic');
});

test('预览不应修改亲本植物对象', () => {
  const p1Genotype = JSON.parse(JSON.stringify(ALL_HETEROZYGOUS));
  const p2Genotype = JSON.parse(JSON.stringify(ALL_HETEROZYGOUS));
  const p1 = makePlant('p1', p1Genotype);
  const p2 = makePlant('p2', p2Genotype);

  const p1Before = JSON.stringify(p1);
  const p2Before = JSON.stringify(p2);

  calculateCrossBreedPreview(p1, p2, 100, []);

  assert.strictEqual(JSON.stringify(p1), p1Before, 'Parent 1 should not be modified');
  assert.strictEqual(JSON.stringify(p2), p2Before, 'Parent 2 should not be modified');
});

console.log('\n8. UV突变对表型分布影响测试');

test('高UV应使纯合亲本后代出现更多隐性表型', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);

  const preview0 = calculateCrossBreedPreview(p1, p2, 0, []);
  const preview100 = calculateCrossBreedPreview(p1, p2, 100, []);

  const glow0 = preview0.traitProbabilities.find(t => t.gene === 'glowColor')!;
  const glow100 = preview100.traitProbabilities.find(t => t.gene === 'glowColor')!;

  const magenta0 = glow0.phenotypes.find(p => p.label === 'magenta');
  const magenta100 = glow100.phenotypes.find(p => p.label === 'magenta');

  const m0 = magenta0?.probability || 0;
  const m100 = magenta100?.probability || 0;
  assert.ok(m100 > m0,
    `UV=100 magenta (${m100}%) should be > UV=0 magenta (${m0}%)`);
  assert.ok(m100 > 0, 'UV=100 should produce some magenta offspring');
});

console.log('\n9. 边界情况测试');

test('UV=0时突变率为2%每等位基因', () => {
  assert.ok(approxEqual(getMutationRate(0), 0.02, 0.001), `Expected 0.02, got ${getMutationRate(0)}`);
});

test('UV=100时突变率为10%每等位基因', () => {
  assert.ok(approxEqual(getMutationRate(100), 0.10, 0.001), `Expected 0.10, got ${getMutationRate(100)}`);
});

test('预览结果包含全部5个性状', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const genes = preview.traitProbabilities.map(t => t.gene);
  assert.ok(genes.includes('glowColor'), 'Should include glowColor');
  assert.ok(genes.includes('leafShape'), 'Should include leafShape');
  assert.ok(genes.includes('plantSize'), 'Should include plantSize');
  assert.ok(genes.includes('glowIntensity'), 'Should include glowIntensity');
  assert.ok(genes.includes('specialTrait'), 'Should include specialTrait');
  assert.strictEqual(preview.traitProbabilities.length, 5);
});

test('特殊能力为ee时应几乎全为"无特殊能力"（含基础突变率）', () => {
  const p1 = makePlant('p1', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['e', 'e']));
  const p2 = makePlant('p2', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['e', 'e']));
  const preview = calculateCrossBreedPreview(p1, p2, 0, []);

  const special = preview.traitProbabilities.find(t => t.gene === 'specialTrait')!;
  const noneTrait = special.phenotypes.find(p => p.label === '无特殊能力');
  assert.ok(noneTrait, 'Should show 无特殊能力 for ee');
  assert.ok(noneTrait!.probability > 95,
    `Expected >95%, got ${noneTrait!.probability}%`);
  const sum = special.phenotypes.reduce((a, p) => a + p.probability, 0);
  assert.ok(approxEqual(sum, 100, 0.01), `Sum should be 100%, got ${sum}%`);
});

console.log('\n10. 预览与真实杂交规则一致性测试');

test('蒙特卡洛采样分布应与解析概率分布严格一致（Aa×Aa, UV=0）', () => {
  const p1g: [Allele, Allele] = ['A', 'a'];
  const p2g: [Allele, Allele] = ['A', 'a'];
  const mutationRate = getMutationRate(0);
  const dist = getSingleGeneDistribution(p1g, p2g, 'A', 'a', mutationRate);

  const N = 100000;
  let countDD = 0, countDd = 0, countdd = 0;
  // 确定性随机序列
  let seed = 42;
  const seededRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const p1 = makePlant('p1', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['A', 'a'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));

  for (let i = 0; i < N; i++) {
    const result = crossAndMutateGenotype(p1.genotype, p2.genotype, 0, seededRandom);
    const g = result.genotype.glowColor;
    if (g[0] === 'A' && g[1] === 'A') countDD++;
    else if (g[0] === 'a' && g[1] === 'a') countdd++;
    else countDd++;
  }

  const freqDD = countDD / N;
  const freqDd = countDd / N;
  const freqdd = countdd / N;

  // 5%容差（N=100000时标准误差约0.14%）
  assert.ok(Math.abs(freqDD - dist.homozygousDominant) < 0.02,
    `DD: expected ${dist.homozygousDominant.toFixed(4)}, got ${freqDD.toFixed(4)}`);
  assert.ok(Math.abs(freqDd - dist.heterozygous) < 0.02,
    `Dd: expected ${dist.heterozygous.toFixed(4)}, got ${freqDd.toFixed(4)}`);
  assert.ok(Math.abs(freqdd - dist.homozygousRecessive) < 0.02,
    `dd: expected ${dist.homozygousRecessive.toFixed(4)}, got ${freqdd.toFixed(4)}`);
});

test('蒙特卡洛采样分布应与解析概率分布一致（AA×aa, UV=100）', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_RECESSIVE);
  const mutationRate = getMutationRate(100);
  const dist = getSingleGeneDistribution(['A', 'A'], ['a', 'a'], 'A', 'a', mutationRate);

  const N = 100000;
  let countDD = 0, countDd = 0, countdd = 0;
  let seed = 123;
  const seededRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < N; i++) {
    const result = crossAndMutateGenotype(p1.genotype, p2.genotype, 100, seededRandom);
    const g = result.genotype.glowColor;
    if (g[0] === 'A' && g[1] === 'A') countDD++;
    else if (g[0] === 'a' && g[1] === 'a') countdd++;
    else countDd++;
  }

  const freqDD = countDD / N;
  const freqDd = countDd / N;
  const freqdd = countdd / N;

  assert.ok(Math.abs(freqDD - dist.homozygousDominant) < 0.02,
    `DD: expected ${dist.homozygousDominant.toFixed(4)}, got ${freqDD.toFixed(4)}`);
  assert.ok(Math.abs(freqDd - dist.heterozygous) < 0.02,
    `Dd: expected ${dist.heterozygous.toFixed(4)}, got ${freqDd.toFixed(4)}`);
  assert.ok(Math.abs(freqdd - dist.homozygousRecessive) < 0.02,
    `dd: expected ${dist.homozygousRecessive.toFixed(4)}, got ${freqdd.toFixed(4)}`);
});

test('采样突变率应与解析突变概率一致', () => {
  const p1 = makePlant('p1', ALL_DOMINANT);
  const p2 = makePlant('p2', ALL_DOMINANT);

  const N = 100000;
  let mutationCount = 0;
  let seed = 999;
  const seededRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < N; i++) {
    const result = crossAndMutateGenotype(p1.genotype, p2.genotype, 0, seededRandom);
    if (result.mutated) mutationCount++;
  }

  const expectedMutationRate = 1 - Math.pow(1 - 0.02, 10); // 10个等位基因，每个2%
  const observedRate = mutationCount / N;

  assert.ok(Math.abs(observedRate - expectedMutationRate) < 0.01,
    `Mutation rate: expected ${expectedMutationRate.toFixed(4)}, got ${observedRate.toFixed(4)}`);
});

test('mutationDetails.from应在任何突变前捕获原始基因型', () => {
  // 用受控随机数强制两个等位基因都突变
  let callCount = 0;
  const controlledRandom = (): number => {
    callCount++;
    // 遗传：总是选位置0；突变：总是<mutationRate
    return callCount % 3 === 1 ? 0.1 : 0.01;
  };

  const p1 = makePlant('p1', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));
  const p2 = makePlant('p2', makeGenotype(['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['E', 'E']));

  const result = crossAndMutateGenotype(p1.genotype, p2.genotype, 100, controlledRandom);
  if (result.mutationDetails) {
    // from 应该是突变前的基因型，不应该包含已突变的等位基因
    const from = result.mutationDetails.from;
    const to = result.mutationDetails.to;
    // 如果两个等位基因都从A突变为a，from应该是[A,A]而不是[a,A]
    if (to[0] === 'a' && to[1] === 'a') {
      assert.strictEqual(from[0], 'A', `from[0] should be A before mutation, got ${from[0]}`);
      assert.strictEqual(from[1], 'A', `from[1] should be A before mutation, got ${from[1]}`);
    }
  }
});

console.log('\n' + '='.repeat(50));
console.log(`测试结果: ${testsPassed} 通过, ${testsFailed} 失败`);
console.log('='.repeat(50) + '\n');

if (testsFailed > 0) {
  process.exit(1);
}
