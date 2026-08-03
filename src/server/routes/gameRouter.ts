import { Router, Request, Response } from 'express';
import {
  loadGameState,
  loadGameStateReadOnly,
  saveGameState,
  resetGameState,
  addPlant,
  removePlant,
  unlockSpecies,
  setUVLevel,
  selectParent,
  generateId
} from '../storage/jsonStorage';
import { crossAndMutateGenotype } from '../genetics/geneticCore';
import { generateRandomGenotype } from '../genetics/mendel';
import { genotypeToPhenotype, generateName } from '../genetics/genotypeToPhenotype';
import { checkNewSpecies } from '../genetics/speciesDetector';
import { calculateCrossBreedPreview } from '../genetics/previewCalculator';
import { SPECIES } from '../data/species';
import { CrossBreedRequest, CrossBreedResponse, CrossBreedPreviewRequest, Plant, PreviewErrorCode } from '../../shared/types';

const router = Router();

router.get('/state', (req: Request, res: Response) => {
  try {
    const state = loadGameState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load game state' });
  }
});

router.get('/species', (req: Request, res: Response) => {
  try {
    res.json(SPECIES);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load species' });
  }
});

router.post('/reset', (req: Request, res: Response) => {
  try {
    const state = resetGameState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset game state' });
  }
});

function isValidUV(uvLevel: unknown): uvLevel is number {
  return typeof uvLevel === 'number' && !isNaN(uvLevel) && uvLevel >= 0 && uvLevel <= 100;
}

router.post('/crossbreed', (req: Request, res: Response) => {
  try {
    const { parent1Id, parent2Id, uvLevel }: CrossBreedRequest = req.body;

    if (!parent1Id || !parent2Id) {
      return res.status(400).json({ error: 'Both parents must be selected' });
    }

    if (parent1Id === parent2Id) {
      return res.status(400).json({ error: 'Parents must be two different plants' });
    }

    if (!isValidUV(uvLevel)) {
      return res.status(400).json({ error: 'UV level must be between 0 and 100' });
    }

    const state = loadGameState();

    const parent1 = state.plants.find(p => p.id === parent1Id);
    const parent2 = state.plants.find(p => p.id === parent2Id);

    if (!parent1 || !parent2) {
      return res.status(404).json({ error: 'One or both parents not found' });
    }

    // 使用与预览共享的统一核心函数进行遗传+突变
    const mutationResult = crossAndMutateGenotype(parent1.genotype, parent2.genotype, uvLevel);
    const offspringGenotype = mutationResult.genotype;

    const offspringPhenotype = genotypeToPhenotype(offspringGenotype);
    const maxGeneration = Math.max(parent1.generation, parent2.generation);

    const offspring: Plant = {
      id: generateId(),
      name: generateName(offspringPhenotype),
      genotype: offspringGenotype,
      phenotype: offspringPhenotype,
      generation: maxGeneration + 1,
      isMutant: mutationResult.mutated
    };

    let newState = addPlant(state, offspring);
    const newSpecies = checkNewSpecies(offspring, newState.unlockedSpecies);

    if (newSpecies) {
      newState = unlockSpecies(newState, newSpecies.id);
    }

    // 持久化请求中的UV，保证预览与本次杂交使用同一个当前UV
    newState = setUVLevel(newState, uvLevel);

    newState.selectedParent1 = null;
    newState.selectedParent2 = null;

    saveGameState(newState);

    const response: CrossBreedResponse = {
      offspring,
      mutationOccurred: mutationResult.mutated,
      mutationDetails: mutationResult.mutationDetails,
      newSpeciesUnlocked: newSpecies || undefined
    };

    res.json(response);
  } catch (error) {
    console.error('Crossbreed error:', error);
    res.status(500).json({ error: 'Failed to crossbreed' });
  }
});

router.post('/preview', (req: Request, res: Response) => {
  try {
    const { parent1Id, parent2Id, uvLevel }: CrossBreedPreviewRequest = req.body;

    // 先做参数校验，校验失败也不写存档（只读加载在后面）
    if (!parent1Id || !parent2Id) {
      const code: PreviewErrorCode = 'MISSING_PARENT';
      return res.status(400).json({ error: '必须选择两个亲本', code });
    }

    if (parent1Id === parent2Id) {
      const code: PreviewErrorCode = 'SAME_PARENT';
      return res.status(400).json({ error: '两个亲本不能是同一株植物', code });
    }

    if (!isValidUV(uvLevel)) {
      const code: PreviewErrorCode = 'UV_OUT_OF_RANGE';
      return res.status(400).json({ error: '紫外线强度必须在 0 到 100 之间', code });
    }

    // 严格只读加载：绝不创建、修复或重写存档
    const state = loadGameStateReadOnly();

    if (!state) {
      const code: PreviewErrorCode = 'PARENT_NOT_FOUND';
      return res.status(404).json({ error: '存档不存在或已损坏，无法预览', code });
    }

    const parent1 = state.plants.find(p => p.id === parent1Id);
    const parent2 = state.plants.find(p => p.id === parent2Id);

    if (!parent1 || !parent2) {
      const code: PreviewErrorCode = 'PARENT_NOT_FOUND';
      return res.status(404).json({ error: '一个或两个亲本不存在（可能已被删除）', code });
    }

    const preview = calculateCrossBreedPreview(parent1, parent2, uvLevel, state.unlockedSpecies);
    res.json(preview);
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: '获取杂交预览失败' });
  }
});

router.post('/uv', (req: Request, res: Response) => {
  try {
    const { uvLevel } = req.body;

    if (uvLevel === undefined || uvLevel === null) {
      return res.status(400).json({ error: 'UV level is required' });
    }

    const state = loadGameState();
    const newState = setUVLevel(state, uvLevel);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to set UV level' });
  }
});

router.post('/select', (req: Request, res: Response) => {
  try {
    const { plantId, slot } = req.body;

    if (!plantId || !slot) {
      return res.status(400).json({ error: 'Plant ID and slot are required' });
    }

    if (slot !== 1 && slot !== 2) {
      return res.status(400).json({ error: 'Slot must be 1 or 2' });
    }

    const state = loadGameState();

    if (!state.plants.find(p => p.id === plantId)) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const newState = selectParent(state, plantId, slot);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to select parent' });
  }
});

router.delete('/plants/:plantId', (req: Request, res: Response) => {
  try {
    const { plantId } = req.params;
    const state = loadGameState();

    if (!state.plants.find(p => p.id === plantId)) {
      return res.status(404).json({ error: 'Plant not found' });
    }

    const newState = removePlant(state, plantId);
    saveGameState(newState);
    res.json(newState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove plant' });
  }
});

router.post('/generate', (req: Request, res: Response) => {
  try {
    const state = loadGameState();
    const genotype = generateRandomGenotype();
    const phenotype = genotypeToPhenotype(genotype);

    const newPlant: Plant = {
      id: generateId(),
      name: generateName(phenotype),
      genotype,
      phenotype,
      generation: 0,
      isMutant: false
    };

    let newState = addPlant(state, newPlant);
    const newSpecies = checkNewSpecies(newPlant, newState.unlockedSpecies);

    if (newSpecies) {
      newState = unlockSpecies(newState, newSpecies.id);
    }

    saveGameState(newState);
    res.json({ plant: newPlant, newSpecies: newSpecies || undefined });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate new plant' });
  }
});

export default router;
