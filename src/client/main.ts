import { api } from './api';
import { applyUVLevelLocally, mergeUVResponse, createUVSaveQueue } from '../shared/uvSync';
import { createLatestRequestTracker } from '../shared/latestRequest';
import { applyParentSelection, applyPlantRemoval } from '../shared/stateTransitions';
import {
  GameState,
  Species,
  Plant,
  Phenotype,
  CrossBreedResponse,
  CrossBreedPreviewResponse
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
  closeModalBtn: document.querySelector('.close-btn') as HTMLSpanElement,
  previewPanel: document.getElementById('preview-panel')
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
  schedulePreviewRefresh();
}

// 预览请求防抖与过期废止：任何状态变化立即使旧请求失效，只渲染最新请求的结果
let previewTimer: ReturnType<typeof setTimeout> | undefined;
const previewTracker = createLatestRequestTracker();

function schedulePreviewRefresh(): void {
  // 立即废止在途预览，防止取消/删除亲本后旧响应覆盖最新提示
  previewTracker.invalidate();
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = undefined;
    void refreshPreview();
  }, 150);
}

const PREVIEW_ERROR_TEXT: Record<string, string> = {
  'Both parents must be selected': '请选择两株亲本植物',
  'Parents must be two different plants': '不能选择同一株植物作为亲本',
  'One or both parents not found': '所选亲本已被删除，请重新选择',
  'UV level must be a number between 0 and 100': '紫外线强度必须在 0~100 之间',
  'No valid game state available': '无法读取有效存档，请刷新页面或重置游戏'
};

function renderPreviewMessage(message: string, isError: boolean): void {
  if (!DOM.previewPanel) return;
  DOM.previewPanel.innerHTML = `
    <h3 class="preview-title">🔮 杂交预览 <span class="preview-badge">只读</span></h3>
    <p class="${isError ? 'preview-error' : 'preview-hint'}">${message}</p>
  `;
}

async function refreshPreview(): Promise<void> {
  if (!gameState || !DOM.previewPanel) return;

  const { selectedParent1, selectedParent2 } = gameState;
  if (!selectedParent1 || !selectedParent2) {
    renderPreviewMessage('选择两株亲本后，这里会显示子代性状、突变概率与物种解锁概率', false);
    return;
  }
  if (selectedParent1 === selectedParent2) {
    renderPreviewMessage('不能选择同一株植物作为亲本', true);
    return;
  }

  const token = previewTracker.invalidate();
  try {
    const preview = await api.previewCrossbreed({
      parent1Id: selectedParent1,
      parent2Id: selectedParent2,
      uvLevel: gameState.uvLevel
    });
    if (!previewTracker.isLatest(token)) return; // 已有更新的状态或请求，丢弃过期结果
    renderPreview(preview);
  } catch (error) {
    if (!previewTracker.isLatest(token)) return;
    const raw = error instanceof Error ? error.message : '';
    renderPreviewMessage(PREVIEW_ERROR_TEXT[raw] || `预览失败：${raw || '未知错误'}`, true);
  }
}

const GENE_LABELS: Record<string, string> = {
  glowColor: '发光颜色',
  leafShape: '叶片形状',
  plantSize: '植株大小',
  glowIntensity: '发光强度',
  specialTrait: '特殊能力'
};

function renderPreview(preview: CrossBreedPreviewResponse): void {
  if (!DOM.previewPanel) return;

  const traitRows = preview.traits.map(trait => {
    const outcomes = trait.outcomes.map(outcome => {
      const label = outcome.value === null ? '无特殊能力' : outcome.value;
      return `
        <div class="preview-outcome">
          <span class="preview-outcome-label">${label}</span>
          <div class="preview-bar"><div class="preview-bar-fill" style="width: ${outcome.percentage}%"></div></div>
          <span class="preview-outcome-pct">${outcome.percentage}%</span>
        </div>
      `;
    }).join('');
    return `
      <div class="preview-trait">
        <div class="preview-trait-name">${GENE_LABELS[trait.gene] || trait.gene}</div>
        ${outcomes}
      </div>
    `;
  }).join('');

  const speciesRows = preview.speciesUnlocks.map(species => `
    <div class="preview-outcome">
      <span class="preview-outcome-label">${species.image} ${species.name}</span>
      <div class="preview-bar"><div class="preview-bar-fill species" style="width: ${species.percentage}%"></div></div>
      <span class="preview-outcome-pct">${species.percentage}%</span>
    </div>
  `).join('');

  DOM.previewPanel.innerHTML = `
    <h3 class="preview-title">🔮 杂交预览 <span class="preview-badge">只读</span></h3>
    <div class="preview-mutation">⚡ 整株突变概率：<strong>${preview.mutationPercentage}%</strong>（UV ${preview.uvLevel}%）</div>
    <div class="preview-section">
      <h4>子代性状分布</h4>
      ${traitRows}
    </div>
    <div class="preview-section">
      <h4>新物种解锁概率</h4>
      ${speciesRows || '<p class="preview-hint">所有物种均已解锁</p>'}
      <div class="preview-outcome">
        <span class="preview-outcome-label">无新物种</span>
        <div class="preview-bar"><div class="preview-bar-fill none" style="width: ${preview.noNewSpeciesPercentage}%"></div></div>
        <span class="preview-outcome-pct">${preview.noNewSpeciesPercentage}%</span>
      </div>
    </div>
  `;
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

  // 亲本变化点击瞬间先在本地生效：同步废止在途旧预览并刷新提示，不等服务端返回
  gameState = applyParentSelection(gameState, plantId, slot);
  updateUI();

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

// UV 请求序号：只采用最后一次滑块操作对应的响应，避免乱序覆盖
let uvRequestSeq = 0;
// UV 保存串行队列：保证存档写入顺序与滑块操作顺序一致
const uvSaveQueue = createUVSaveQueue();

async function handleUVChange(): Promise<void> {
  const value = parseInt(DOM.uvSlider.value);
  DOM.uvValue!.textContent = `${value}%`;

  // 先本地生效，使预览与“开始杂交”立即使用最新 UV，无需等待请求返回
  if (gameState) {
    gameState = applyUVLevelLocally(gameState, value);
  }
  schedulePreviewRefresh();

  const seq = ++uvRequestSeq;
  // 串行保存：等待前一次保存完成后再发本次请求
  void uvSaveQueue.enqueue(async () => {
    try {
      const newState = await api.setUVLevel(value);
      if (gameState) {
        gameState = mergeUVResponse(gameState, newState, seq === uvRequestSeq);
      }
    } catch (error) {
      console.error('Failed to set UV level:', error);
    }
  });
}

async function handleCrossbreed(): Promise<void> {
  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) return;

  // 先等待所有 UV 保存落盘，确保页面显示值、预览值与存档值一致后再杂交
  await uvSaveQueue.drain();

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

function showCrossbreedResult(result: CrossBreedResponse): void {
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
  if (!gameState) return;

  // 删除立即本地生效：同步废止以该植物为亲本的在途旧预览
  gameState = applyPlantRemoval(gameState, plantId);
  updateUI();

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
