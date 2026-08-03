import { api } from './api';
import {
  GameState,
  Species,
  Plant,
  Phenotype,
  CrossBreedResponse,
  CrossBreedPreviewResponse
} from '../shared/types';
import { GENE_INFO, GENE_KEYS, GeneKey } from '../shared/constants';

let gameState: GameState | null = null;
let allSpecies: Species[] = [];
let previewData: CrossBreedPreviewResponse | null = null;
let previewError: string | null = null;
let previewLoading = false;
let uvSaveTimer: ReturnType<typeof setTimeout> | null = null;
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let previewAbortController: AbortController | null = null;
let uvSaveAbortController: AbortController | null = null;

// 状态代次：每次发起状态变更请求前递增。
// 较早发出的请求返回时若代次已落后，其 GameState 结果会被丢弃，
// 防止旧响应（如较早的 UV 保存、亲本选择）覆盖新状态（如杂交后的数据）。
let stateEpoch = 0;

function nextEpoch(): number {
  return ++stateEpoch;
}

function isCurrentEpoch(epoch: number): boolean {
  return epoch === stateEpoch;
}

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
  previewContent: document.getElementById('preview-content')
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
  DOM.crossbreedBtn.addEventListener('click', () => {
    void handleCrossbreed();
  });
  DOM.generateBtn.addEventListener('click', () => {
    void handleGenerate();
  });
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
    const epoch = nextEpoch();
    const [state, species] = await Promise.all([
      api.getState(),
      api.getSpecies()
    ]);
    if (!isCurrentEpoch(epoch)) return;
    gameState = state;
    allSpecies = species;
    DOM.uvSlider.value = gameState.uvLevel.toString();
    DOM.uvValue!.textContent = `${gameState.uvLevel}%`;
    updateUI();
    schedulePreviewRefresh();
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
  renderPreview();
}

function updateParentSlots(): void {
  if (!gameState) return;

  const parent1 = gameState.plants.find(p => p.id === gameState!.selectedParent1);
  const parent2 = gameState.plants.find(p => p.id === gameState!.selectedParent2);

  updateSlot(DOM.parent1Slot!, DOM.parent1Content!, parent1);
  updateSlot(DOM.parent2Slot!, DOM.parent2Content!, parent2);
}

function updateSlot(slot: HTMLElement, content: HTMLElement, plant: Plant | undefined): void {
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
      void handlePlantClick(plantId);
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

function isTraitDominant(gene: GeneKey, value: string | null): boolean {
  const info = GENE_INFO[gene];
  return value === info.dominantTrait;
}

function isOutcomeDominant(gene: GeneKey, label: string): boolean {
  const info = GENE_INFO[gene];
  return label === info.dominantTrait;
}

async function handlePlantClick(plantId: string): Promise<void> {
  if (!gameState) return;

  const plant = gameState.plants.find(p => p.id === plantId);
  if (!plant) return;

  // 立即中止在飞行的预览请求并清除旧预览数据。
  // 这防止在 selectParent 响应返回之前，旧预览响应覆盖新选择。
  cancelPendingPreview();
  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = null;
  }
  previewData = null;
  previewError = null;
  previewLoading = false;

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
    const epoch = nextEpoch();
    const newState = await api.selectParent(plantId, slot);
    // 快速切换亲本时，丢弃较早返回的旧响应
    if (!isCurrentEpoch(epoch)) return;
    gameState = newState;
    updateUI();
    schedulePreviewRefresh();
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

function handleUVChange(): void {
  const value = parseInt(DOM.uvSlider.value);
  DOM.uvValue!.textContent = `${value}%`;

  // 取消上一个待执行或正在飞行的 UV 保存
  if (uvSaveTimer) clearTimeout(uvSaveTimer);
  if (uvSaveAbortController) {
    uvSaveAbortController.abort();
    uvSaveAbortController = null;
  }
  uvSaveTimer = setTimeout(() => {
    void persistUV(value);
  }, 300);

  // UV 滑块值变化后立即刷新预览（不等保存完成）
  schedulePreviewRefresh();
}

async function persistUV(value: number): Promise<void> {
  // 中止上一个仍在飞行中的 UV 保存请求
  if (uvSaveAbortController) {
    uvSaveAbortController.abort();
  }
  const abortController = new AbortController();
  uvSaveAbortController = abortController;

  try {
    const epoch = nextEpoch();
    const newState = await api.setUVLevel(value, abortController.signal);
    if (abortController.signal.aborted) return;
    // 如果在此期间有更新的操作（如杂交），丢弃此旧响应
    if (!isCurrentEpoch(epoch)) return;
    gameState = newState;
    DOM.uvSlider.value = gameState.uvLevel.toString();
    DOM.uvValue!.textContent = `${gameState.uvLevel}%`;
    schedulePreviewRefresh();
  } catch (err) {
    if (abortController.signal.aborted) return;
    const error = err as Error & { name?: string };
    if (error.name === 'AbortError') return;
    console.error('Failed to set UV level:', error);
  } finally {
    if (uvSaveAbortController === abortController) {
      uvSaveAbortController = null;
    }
  }
}

function schedulePreviewRefresh(): void {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    void refreshPreview();
  }, 150);
}

function getCurrentUV(): number {
  return parseInt(DOM.uvSlider.value);
}

function getLocalPreviewError(): string | null {
  if (!gameState) return '游戏状态未加载';
  if (!gameState.selectedParent1 || !gameState.selectedParent2) return null;
  if (gameState.selectedParent1 === gameState.selectedParent2) return '两个亲本不能是同一株植物';

  const uv = getCurrentUV();
  if (uv < 0 || uv > 100 || isNaN(uv)) return '紫外线强度必须在 0 到 100 之间';

  const p1 = gameState.plants.find(p => p.id === gameState!.selectedParent1);
  const p2 = gameState.plants.find(p => p.id === gameState!.selectedParent2);
  if (!p1 || !p2) return '一个或两个亲本已被删除，请重新选择';

  return null;
}

async function refreshPreview(): Promise<void> {
  const localError = getLocalPreviewError();

  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) {
    cancelPendingPreview();
    previewData = null;
    previewError = null;
    previewLoading = false;
    renderPreview();
    return;
  }

  if (localError) {
    cancelPendingPreview();
    previewData = null;
    previewError = localError;
    previewLoading = false;
    renderPreview();
    return;
  }

  // 废止上一个仍在飞行中的预览请求，防止旧响应覆盖新结果
  if (previewAbortController) {
    previewAbortController.abort();
  }
  const abortController = new AbortController();
  previewAbortController = abortController;

  // 捕获请求时的亲本和 UV，用于校验响应是否仍匹配当前状态
  const requestParent1 = gameState.selectedParent1;
  const requestParent2 = gameState.selectedParent2;
  const requestUV = getCurrentUV();

  previewLoading = true;
  previewError = null;
  renderPreview();

  try {
    const result = await api.preview({
      parent1Id: requestParent1,
      parent2Id: requestParent2,
      uvLevel: requestUV
    }, abortController.signal);

    // 请求已被更新的预览废止
    if (abortController.signal.aborted) return;
    // 亲本或 UV 在请求期间已变化，丢弃此结果
    if (!gameState ||
        gameState.selectedParent1 !== requestParent1 ||
        gameState.selectedParent2 !== requestParent2 ||
        getCurrentUV() !== requestUV) {
      return;
    }

    previewAbortController = null;
    previewData = result;
    previewLoading = false;
    renderPreview();
  } catch (err) {
    if (abortController.signal.aborted) return;
    const error = err as Error & { code?: string; name?: string };
    // AbortError 是预期的废止行为，不当作错误展示
    if (error.name === 'AbortError') return;

    previewAbortController = null;
    previewData = null;
    previewLoading = false;

    if (error.code === 'SAME_PARENT') {
      previewError = '两个亲本不能是同一株植物';
    } else if (error.code === 'PARENT_NOT_FOUND') {
      previewError = '一个或两个亲本不存在（可能已被删除），请重新选择';
    } else if (error.code === 'UV_OUT_OF_RANGE') {
      previewError = '紫外线强度超出范围';
    } else if (error.code === 'MISSING_PARENT') {
      previewError = '请选择两个亲本';
    } else {
      previewError = error.message || '获取预览失败';
    }
    renderPreview();
  }
}

function cancelPendingPreview(): void {
  if (previewAbortController) {
    previewAbortController.abort();
    previewAbortController = null;
  }
}

function getGeneDisplayName(gene: GeneKey): string {
  const nameMap: Record<GeneKey, string> = {
    glowColor: '发光颜色',
    leafShape: '叶片形状',
    plantSize: '植株大小',
    glowIntensity: '发光强度',
    specialTrait: '特殊能力'
  };
  return nameMap[gene];
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

function renderPreview(): void {
  if (!DOM.previewContent) return;

  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) {
    DOM.previewContent.innerHTML = '<p class="preview-hint">选择两株亲本后将显示可能的杂交结果</p>';
    return;
  }

  if (previewError) {
    DOM.previewContent.innerHTML = `<div class="preview-error">⚠️ ${previewError}</div>`;
    return;
  }

  if (previewLoading && !previewData) {
    DOM.previewContent.innerHTML = '<p class="preview-loading">正在计算杂交可能性...</p>';
    return;
  }

  if (!previewData) return;

  const traitHtml = previewData.traitProbabilities.map(genePreview => {
    const geneKey = genePreview.gene as GeneKey;
    const outcomes = genePreview.phenotypes.map(entry => {
      const isDominant = isOutcomeDominant(geneKey, entry.label);
      const barClass = isDominant ? 'dominant' : 'recessive';
      return `
        <div class="trait-outcome">
          <span class="trait-outcome-label">${entry.label}</span>
          <div class="trait-outcome-bar">
            <div class="trait-outcome-fill ${barClass}" style="width: ${entry.probability}%"></div>
          </div>
          <span class="trait-outcome-prob">${entry.probability.toFixed(2)}%</span>
        </div>
      `;
    }).join('');

    return `
      <div class="trait-preview-item">
        <div class="trait-preview-name">${getGeneDisplayName(geneKey)}</div>
        ${outcomes}
      </div>
    `;
  }).join('');

  let speciesHtml: string;
  if (previewData.speciesUnlockProbabilities.length === 0) {
    speciesHtml = '<p class="preview-no-species">所有物种均已解锁</p>';
  } else {
    speciesHtml = previewData.speciesUnlockProbabilities.map(sp => {
      const isZero = sp.probability === 0;
      return `
        <div class="species-preview-item ${isZero ? 'zero-prob' : ''}">
          <div class="species-preview-icon">${sp.image}</div>
          <div class="species-preview-info">
            <div class="species-preview-name">${sp.speciesName}</div>
            <div class="species-preview-rarity">
              <span class="rarity-badge ${sp.rarity}">${getRarityText(sp.rarity)}</span>
            </div>
          </div>
          <div class="species-preview-prob">${sp.probability.toFixed(2)}%</div>
        </div>
      `;
    }).join('');
  }

  DOM.previewContent.innerHTML = `
    <div class="preview-section">
      <div class="preview-section-title">🧬 性状概率分布</div>
      <div class="trait-preview-grid">
        ${traitHtml}
      </div>
    </div>
    <div class="preview-section">
      <div class="mutation-summary">
        <span class="mutation-label">⚡ 整株突变概率</span>
        <span class="mutation-value">${previewData.mutationProbability.toFixed(2)}%</span>
      </div>
    </div>
    <div class="preview-section">
      <div class="preview-section-title">🌟 新物种解锁概率</div>
      <div class="species-preview-list">
        ${speciesHtml}
      </div>
    </div>
  `;
}

async function handleCrossbreed(): Promise<void> {
  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) return;

  // 取消待执行的 UV 保存定时器，并中止正在飞行的 UV 保存请求。
  // 杂交端点会持久化请求中的 UV，避免旧的 UV 写响应在杂交后覆盖新状态。
  if (uvSaveTimer) {
    clearTimeout(uvSaveTimer);
    uvSaveTimer = null;
  }
  if (uvSaveAbortController) {
    uvSaveAbortController.abort();
    uvSaveAbortController = null;
  }
  // 废止正在进行的预览请求
  cancelPendingPreview();

  try {
    const currentUV = getCurrentUV();
    const epoch = nextEpoch();

    const result = await api.crossbreed({
      parent1Id: gameState.selectedParent1,
      parent2Id: gameState.selectedParent2,
      uvLevel: currentUV
    });

    // 杂交期间如果有更新的操作发起，不覆盖状态
    if (!isCurrentEpoch(epoch)) return;

    const freshState = await api.getState();
    if (!isCurrentEpoch(epoch)) return;

    gameState = freshState;
    DOM.uvSlider.value = gameState.uvLevel.toString();
    DOM.uvValue!.textContent = `${gameState.uvLevel}%`;
    updateUI();
    previewData = null;
    schedulePreviewRefresh();
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
    const epoch = nextEpoch();
    const result = await api.generatePlant();
    if (!isCurrentEpoch(epoch)) return;

    const freshState = await api.getState();
    if (!isCurrentEpoch(epoch)) return;

    gameState = freshState;
    updateUI();
    schedulePreviewRefresh();

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
    const epoch = nextEpoch();
    const newState = await api.deletePlant(plantId);
    if (!isCurrentEpoch(epoch)) return;
    gameState = newState;
    updateUI();
    schedulePreviewRefresh();
  } catch (error) {
    console.error('Delete failed:', error);
    showError('删除失败，请重试');
  }
}

function renderCollection(): void {
  if (!gameState || !DOM.collectionGrid) return;

  DOM.collectionGrid.innerHTML = allSpecies.map(species => {
    const isUnlocked = gameState!.unlockedSpecies.includes(species.id);

    const reqItems = Object.entries(species.requiredPhenotype).map(([, value]) => {
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
