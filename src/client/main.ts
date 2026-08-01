import { api } from './api';
import {
  GameState,
  Species,
  Plant,
  Phenotype
} from '../shared/types';

const GENE_INFO = {
  glowColor: {
    gene: 'glowColor',
    dominantAllele: 'A',
    recessiveAllele: 'a',
    dominantTrait: 'cyan',
    recessiveTrait: 'magenta'
  },
  leafShape: {
    gene: 'leafShape',
    dominantAllele: 'B',
    recessiveAllele: 'b',
    dominantTrait: 'crystalline',
    recessiveTrait: 'tentacle'
  },
  plantSize: {
    gene: 'plantSize',
    dominantAllele: 'C',
    recessiveAllele: 'c',
    dominantTrait: 'giant',
    recessiveTrait: 'dwarf'
  },
  glowIntensity: {
    gene: 'glowIntensity',
    dominantAllele: 'D',
    recessiveAllele: 'd',
    dominantTrait: 'bright',
    recessiveTrait: 'dim'
  },
  specialTrait: {
    gene: 'specialTrait',
    dominantAllele: 'E',
    recessiveAllele: 'e',
    dominantTrait: 'floating',
    recessiveTrait: 'none'
  }
} as const;

const GENE_KEYS = [
  'glowColor',
  'leafShape',
  'plantSize',
  'glowIntensity',
  'specialTrait'
];

let gameState: GameState | null = null;
let allSpecies: Species[] = [];

const DOM = {
  tabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  uvSlider: document.getElementById('uv-slider') as HTMLInputElement,
  uvValue: document.getElementById('uv-value'),
  parent1Slot: document.getElementById('parent1-slot'),
  parent2Slot: document.getElementById('parent2-slot'),
  parent1Content: document.getElementById('parent1-content'),
  parent2Content: document.getElementById('parent2-content'),
  crossbreedBtn: document.getElementById('crossbreed-btn') as HTMLButtonElement,
  generateBtn: document.getElementById('generate-btn') as HTMLButtonElement,
  plantsGrid: document.getElementById('plants-grid'),
  geneticsDetail: document.getElementById('genetics-detail'),
  collectionGrid: document.getElementById('collection-grid'),
  modal: document.getElementById('modal'),
  modalBody: document.getElementById('modal-body'),
  closeModalBtn: document.querySelector('.close-btn') as HTMLSpanElement
};

function init(): void {
  setupEventListeners();
  loadData();
}

function setupEventListeners(): void {
  DOM.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      switchTab(tabName!);
    });
  });

  DOM.uvSlider.addEventListener('input', handleUVChange);
  DOM.crossbreedBtn.addEventListener('click', handleCrossbreed);
  DOM.generateBtn.addEventListener('click', handleGenerate);
  DOM.closeModalBtn.addEventListener('click', closeModal);
  DOM.modal.addEventListener('click', (e) => {
    if (e.target === DOM.modal) closeModal();
  });
}

function switchTab(tabName: string): void {
  DOM.tabs.forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
  });
  DOM.tabContents.forEach(content => {
    content.classList.toggle('active', content.getAttribute('id') === tabName);
  });
}

async function loadData(): Promise<void> {
  try {
    [gameState, allSpecies] = await Promise.all([
      api.getState(),
      api.getSpecies()
    ]);
    updateUI();
  } catch (error) {
    console.error('Failed to load data:', error);
    showError('加载数据失败，请刷新页面重试');
  }
}

function updateUI(): void {
  if (!gameState) return;

  DOM.uvSlider.value = gameState.uvLevel.toString();
  DOM.uvValue!.textContent = `${gameState.uvLevel}%`;
  updateParentSlots();
  updateCrossbreedButton();
  renderPlants();
  renderCollection();
}

function updateParentSlots(): void {
  if (!gameState) return;

  const parent1 = gameState.plants.find(p => p.id === gameState!.selectedParent1);
  const parent2 = gameState.plants.find(p => p.id === gameState!.selectedParent2);

  updateSlot(DOM.parent1Slot!, DOM.parent1Content!, parent1, 1);
  updateSlot(DOM.parent2Slot!, DOM.parent2Content!, parent2, 2);
}

function updateSlot(slot: HTMLElement, content: HTMLElement, plant: Plant | undefined, slotNum: number): void {
  if (plant) {
    slot.classList.add('selected');
    content.innerHTML = `
      <div class="plant-visual ${plant.phenotype.specialTrait === 'floating' ? 'floating' : ''} ${plant.phenotype.plantSize}">
        ${getPlantEmoji(plant.phenotype)}
      </div>
      <div class="plant-name">${plant.name}</div>
    `;
  } else {
    slot.classList.remove('selected');
    content.innerHTML = '<span class="empty-hint">点击植物选择</span>';
  }
}

function updateCrossbreedButton(): void {
  if (!gameState) return;
  const canBreed = Boolean(
    gameState.selectedParent1 &&
    gameState.selectedParent2 &&
    gameState.selectedParent1 !== gameState.selectedParent2
  );
  DOM.crossbreedBtn.disabled = !canBreed;
}

function getPlantEmoji(phenotype: Phenotype): string {
  const baseEmoji = phenotype.leafShape === 'crystalline' ? '🌿' : '🌾';
  return baseEmoji;
}

function getGlowClass(phenotype: Phenotype): string {
  let classes = '';
  if (phenotype.glowColor === 'cyan') classes += 'glow-cyan ';
  if (phenotype.glowColor === 'magenta') classes += 'glow-magenta ';
  if (phenotype.glowIntensity === 'bright') classes += 'glow-bright ';
  if (phenotype.glowIntensity === 'dim') classes += 'glow-dim ';
  return classes.trim();
}

function renderPlants(): void {
  if (!gameState || !DOM.plantsGrid) return;

  DOM.plantsGrid.innerHTML = gameState.plants.map(plant => {
    const isSelected1 = plant.id === gameState!.selectedParent1;
    const isSelected2 = plant.id === gameState!.selectedParent2;
    const glowClass = getGlowClass(plant.phenotype);
    
    const traitBadges = GENE_KEYS.map(gene => {
      const phenotypeValue = plant.phenotype[gene];
      const isDominant = isTraitDominant(gene, phenotypeValue);
      const geneInfo = GENE_INFO[gene];
      const displayValue = gene === 'specialTrait' && phenotypeValue === null 
        ? '无特殊能力' 
        : phenotypeValue;
      return `<span class="trait-badge ${isDominant ? '' : 'recessive'}">${displayValue}</span>`;
    }).join('');

    return `
      <div class="plant-card ${isSelected1 ? 'selected-parent1' : ''} ${isSelected2 ? 'selected-parent2' : ''}" data-plant-id="${plant.id}">
        <button class="delete-btn" data-delete="${plant.id}">×</button>
        ${plant.isMutant ? '<div class="mutant-badge">⚡ 突变</div>' : ''}
        <div class="plant-visual ${plant.phenotype.specialTrait === 'floating' ? 'floating' : ''} ${plant.phenotype.plantSize} ${glowClass}">
          ${getPlantEmoji(plant.phenotype)}
        </div>
        <div class="plant-name">${plant.name}</div>
        <div class="plant-traits">
          ${traitBadges}
        </div>
        <div class="plant-meta">
          <span>F${plant.generation}</span>
          <span>${plant.id.slice(0, 6)}</span>
        </div>
      </div>
    `;
  }).join('');

  DOM.plantsGrid.querySelectorAll('.plant-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).hasAttribute('data-delete')) return;
      const plantId = card.getAttribute('data-plant-id')!;
      handlePlantClick(plantId);
    });
  });

  DOM.plantsGrid.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const plantId = btn.getAttribute('data-delete')!;
      await handleDeletePlant(plantId);
    });
  });
}

function isTraitDominant(gene: keyof Phenotype, value: string | null): boolean {
  const info = GENE_INFO[gene];
  return value === info.dominantTrait;
}

async function handlePlantClick(plantId: string): void {
  if (!gameState) return;

  const plant = gameState.plants.find(p => p.id === plantId);
  if (!plant) return;

  showPlantGenetics(plant);

  let slot: 1 | 2 = 1;
  if (gameState.selectedParent1 === plantId) {
    slot = 1;
  } else if (gameState.selectedParent2 === plantId) {
    slot = 2;
  } else if (gameState.selectedParent1 && !gameState.selectedParent2) {
    slot = 2;
  }

  try {
    gameState = await api.selectParent(plantId, slot);
    updateUI();
  } catch (error) {
    console.error('Failed to select parent:', error);
  }
}

function showPlantGenetics(plant: Plant): void {
  if (!DOM.geneticsDetail) return;

  const geneDisplays = GENE_KEYS.map(gene => {
    const alleles = plant.genotype[gene];
    const info = GENE_INFO[gene];
    const alleleBoxes = alleles.map(allele => {
      const isDominant = allele === info.dominantAllele;
      return `<div class="allele-box ${isDominant ? 'dominant' : 'recessive'}">${allele}</div>`;
    }).join('');

    const phenotypeValue = plant.phenotype[gene];
    const displayPhenotype = phenotypeValue || '无';

    return `
      <div class="gene-display">
        <h4>${info.dominantTrait}/${info.recessiveTrait} (${info.dominantAllele}/${info.recessiveAllele})</h4>
        <div class="allele-pair">
          ${alleleBoxes}
          <span>→</span>
          <strong>${displayPhenotype}</strong>
        </div>
      </div>
    `;
  }).join('');

  DOM.geneticsDetail.innerHTML = `
    <h3 style="color: #00fff2; margin-bottom: 20px; text-align: center;">${plant.name}</h3>
    <p style="text-align: center; color: #666; margin-bottom: 20px;">
      世代: F${plant.generation} | ${plant.isMutant ? '⚡ 突变体' : '自然遗传'}
    </p>
    ${geneDisplays}
  `;

  switchTab('genetics');
}

async function handleUVChange(): Promise<void> {
  const value = parseInt(DOM.uvSlider.value);
  DOM.uvValue!.textContent = `${value}%`;
  
  try {
    gameState = await api.setUVLevel(value);
  } catch (error) {
    console.error('Failed to set UV level:', error);
  }
}

async function handleCrossbreed(): Promise<void> {
  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) return;

  try {
    const result = await api.crossbreed({
      parent1Id: gameState.selectedParent1,
      parent2Id: gameState.selectedParent2,
      uvLevel: gameState.uvLevel
    });

    gameState = await api.getState();
    updateUI();
    showCrossbreedResult(result);
  } catch (error) {
    console.error('Crossbreed failed:', error);
    showError('杂交失败，请重试');
  }
}

function showCrossbreedResult(result: any): void {
  const offspring = result.offspring;
  const glowClass = getGlowClass(offspring.phenotype);
  
  let mutationHtml = '';
  if (result.mutationOccurred) {
    const details = result.mutationDetails;
    mutationHtml = `
      <div class="mutation-alert">
        <strong>⚡ 基因突变发生！</strong>
        ${details ? `<p>${details.gene}: ${details.from[0]}${details.from[1]} → ${details.to[0]}${details.to[1]}</p>` : ''}
      </div>
    `;
  }

  let newSpeciesHtml = '';
  if (result.newSpeciesUnlocked) {
    const species = result.newSpeciesUnlocked;
    newSpeciesHtml = `
      <div class="new-species-alert">
        <h3>🎉 新物种解锁！</h3>
        <p style="font-size: 2rem; margin: 10px 0;">${species.image}</p>
        <p><strong>${species.name}</strong></p>
        <p style="font-size: 0.9rem; opacity: 0.8;">${species.description}</p>
      </div>
    `;
  }

  DOM.modalBody!.innerHTML = `
    <div class="offspring-result">
      <h2 style="color: #00fff2; margin-bottom: 20px;">🌸 杂交成功！</h2>
      <div class="offspring-icon ${offspring.phenotype.specialTrait === 'floating' ? 'floating' : ''} ${offspring.phenotype.plantSize} ${glowClass}">
        ${getPlantEmoji(offspring.phenotype)}
      </div>
      <div class="offspring-name">${offspring.name}</div>
      <p style="margin-bottom: 15px;">世代: F${offspring.generation}</p>
      ${mutationHtml}
      ${newSpeciesHtml}
    </div>
  `;

  DOM.modal!.classList.remove('hidden');
}

async function handleGenerate(): Promise<void> {
  try {
    const result = await api.generatePlant();
    gameState = await api.getState();
    updateUI();
    
    let newSpeciesHtml = '';
    if (result.newSpecies) {
      const species = result.newSpecies;
      newSpeciesHtml = `
        <div class="new-species-alert">
          <h3>🎉 新物种解锁！</h3>
          <p style="font-size: 2rem; margin: 10px 0;">${species.image}</p>
          <p><strong>${species.name}</strong></p>
          <p style="font-size: 0.9rem; opacity: 0.8;">${species.description}</p>
        </div>
      `;
    }

    const plant = result.plant;
    const glowClass = getGlowClass(plant.phenotype);

    DOM.modalBody!.innerHTML = `
      <div class="offspring-result">
        <h2 style="color: #00fff2; margin-bottom: 20px;">🌱 培育成功！</h2>
        <div class="offspring-icon ${plant.phenotype.specialTrait === 'floating' ? 'floating' : ''} ${plant.phenotype.plantSize} ${glowClass}">
          ${getPlantEmoji(plant.phenotype)}
        </div>
        <div class="offspring-name">${plant.name}</div>
        ${newSpeciesHtml}
      </div>
    `;

    DOM.modal!.classList.remove('hidden');
  } catch (error) {
    console.error('Generate failed:', error);
    showError('培育失败，请重试');
  }
}

async function handleDeletePlant(plantId: string): Promise<void> {
  if (!confirm('确定要删除这株植物吗？')) return;

  try {
    gameState = await api.deletePlant(plantId);
    updateUI();
  } catch (error) {
    console.error('Delete failed:', error);
    showError('删除失败，请重试');
  }
}

function renderCollection(): void {
  if (!gameState || !DOM.collectionGrid) return;

  DOM.collectionGrid.innerHTML = allSpecies.map(species => {
    const isUnlocked = gameState!.unlockedSpecies.includes(species.id);
    
    const reqItems = Object.entries(species.requiredPhenotype).map(([key, value]) => {
      const displayValue = value === null ? '无' : value;
      return `<span class="req-item">${displayValue}</span>`;
    }).join('');

    return `
      <div class="collection-card ${isUnlocked ? 'unlocked' : 'locked'}">
        <div class="collection-icon">${isUnlocked ? species.image : '❓'}</div>
        <div class="collection-name">${isUnlocked ? species.name : '???'}</div>
        <div class="collection-rarity">
          <span class="rarity-badge ${species.rarity}">${getRarityText(species.rarity)}</span>
        </div>
        <p class="collection-desc">${isUnlocked ? species.description : '尚未发现...'}</p>
        ${isUnlocked ? `
          <div class="collection-requirements">
            <h5>所需性状</h5>
            <div class="req-list">${reqItems}</div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const progress = gameState.unlockedSpecies.length / allSpecies.length * 100;
  const header = document.querySelector('#collection .section-title');
  if (header) {
    header.innerHTML = `📚 物种图鉴 <span style="font-size: 0.9rem; color: #666;">(${(progress).toFixed(0)}% 完成)</span>`;
  }
}

function getRarityText(rarity: string): string {
  const map: Record<string, string> = {
    common: '普通',
    uncommon: '稀有',
    rare: '珍稀',
    legendary: '传说'
  };
  return map[rarity] || rarity;
}

function closeModal(): void {
  DOM.modal!.classList.add('hidden');
}

function showError(message: string): void {
  DOM.modalBody!.innerHTML = `
    <div style="text-align: center;">
      <h2 style="color: #ff6b6b; margin-bottom: 20px;">❌ 错误</h2>
      <p>${message}</p>
    </div>
  `;
  DOM.modal!.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', init);
