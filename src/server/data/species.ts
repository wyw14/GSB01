import { Species } from '../../shared/types';
import { GENE_INFO, GENE_KEYS } from '../../shared/constants';

export { GENE_INFO, GENE_KEYS };

export const SPECIES: Species[] = [
  {
    id: 'crystal-moss',
    name: '晶光苔',
    description: '散发着青色冷光的晶体苔藓，外星生态中最基础的发光植物。',
    requiredGenotype: {
      glowColor: ['A', 'a'],
      leafShape: ['B', 'B']
    },
    requiredPhenotype: {
      glowColor: 'cyan',
      leafShape: 'crystalline'
    },
    rarity: 'common',
    image: '🌿'
  },
  {
    id: 'magenta-vine',
    name: '紫蔓藤',
    description: '触手状的藤蔓植物，在黑暗中散发出品红色幽光。',
    requiredGenotype: {
      glowColor: ['a', 'a'],
      leafShape: ['b', 'b']
    },
    requiredPhenotype: {
      glowColor: 'magenta',
      leafShape: 'tentacle'
    },
    rarity: 'common',
    image: '🌾'
  },
  {
    id: 'giant-glow-crystal',
    name: '巨光晶',
    description: '体型巨大的晶体植物，明亮的光芒能照亮整片区域。',
    requiredGenotype: {
      plantSize: ['C', 'C'],
      glowIntensity: ['D', 'D']
    },
    requiredPhenotype: {
      plantSize: 'giant',
      glowIntensity: 'bright'
    },
    rarity: 'uncommon',
    image: '🌳'
  },
  {
    id: 'dim-sprite',
    name: '幽暗微灵',
    description: '矮小的幽光植物，光芒微弱却蕴含神秘能量。',
    requiredGenotype: {
      plantSize: ['c', 'c'],
      glowIntensity: ['d', 'd']
    },
    requiredPhenotype: {
      plantSize: 'dwarf',
      glowIntensity: 'dim'
    },
    rarity: 'uncommon',
    image: '🌱'
  },
  {
    id: 'floating-lotus',
    name: '浮空晶莲',
    description: '拥有浮空能力的晶莲，花瓣脱离引力悬浮于空中。',
    requiredGenotype: {
      specialTrait: ['E', 'E']
    },
    requiredPhenotype: {
      specialTrait: 'floating'
    },
    rarity: 'rare',
    image: '🌸'
  },
  {
    id: 'abyss-spirit',
    name: '深渊暗灵',
    description: '全部隐性基因纯合的暗灵植物，潜伏于星域最深处的黑暗中。',
    requiredGenotype: {
      glowColor: ['a', 'a'],
      leafShape: ['b', 'b'],
      plantSize: ['c', 'c'],
      glowIntensity: ['d', 'd'],
      specialTrait: ['e', 'e']
    },
    requiredPhenotype: {
      glowColor: 'magenta',
      leafShape: 'tentacle',
      plantSize: 'dwarf',
      glowIntensity: 'dim'
    },
    rarity: 'rare',
    image: '🌑'
  },
  {
    id: 'starlight-titan',
    name: '星辉巨灵',
    description: '传说中全部显性基因纯合的至高生命体，集万千光辉于一身，象征外星植物的终极形态。',
    requiredGenotype: {
      glowColor: ['A', 'A'],
      leafShape: ['B', 'B'],
      plantSize: ['C', 'C'],
      glowIntensity: ['D', 'D'],
      specialTrait: ['E', 'E']
    },
    requiredPhenotype: {
      glowColor: 'cyan',
      leafShape: 'crystalline',
      plantSize: 'giant',
      glowIntensity: 'bright',
      specialTrait: 'floating'
    },
    rarity: 'legendary',
    image: '✨'
  }
];
