import { api } from './api';
import {
  GameState,
  Species,
  Plant,
  Phenotype,
  PreviewResponse,
  PreviewResult
} from '../shared/types';
import { GENE_KEYS, GENE_INFO, GeneKey } from '../shared/constants';

let gameState: GameState | null = null;
let allSpecies: Species[] = [];
let previewRequestToken = 0;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let lastPreviewKey = '';
let previewAbort: AbortController | null = null;
let uvRequestSeq = 0;
let uvAbort: AbortController | null = null;
let uvPending = false;

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
  DOM.crossbreedBtn.addEventListener('click', handleCrossbreed);
  DOM.generateBtn.addEventListener('click', handleGenerate);
  DOM.closeModalBtn.addEventListener('click', closeModal);
  DOM.modal!.addEventListener('click', (e) => {
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
    gameState.selectedParent1 !== gameState.selectedParent2 &&
    !uvPending
  );
  DOM.crossbreedBtn.disabled = !canBreed;
  DOM.crossbreedBtn.title = uvPending ? '紫外线强度正在同步，请稍候' : '';
}

function invalidatePreviewRequest(): void {
  previewRequestToken++;
  lastPreviewKey = '';
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (previewAbort) {
    previewAbort.abort();
    previewAbort = null;
  }
}

function renderPreviewPlaceholder(): void {
  if (!gameState || !DOM.previewContent) return;
  if (!gameState.selectedParent1 || !gameState.selectedParent2) {
    DOM.previewContent.innerHTML = `<p class="preview-hint">请在下方选择两株不同的亲本植物。</p>`;
    return;
  }
  if (gameState.selectedParent1 === gameState.selectedParent2) {
    renderPreviewError('两株亲本必须是不同的植物。');
    return;
  }
  const p1 = gameState.plants.find(p => p.id === gameState!.selectedParent1);
  const p2 = gameState.plants.find(p => p.id === gameState!.selectedParent2);
  if (!p1 || !p2) {
    renderPreviewError('选择的亲本已被删除，请重新选择。');
    return;
  }
  // 亲本仍然有效，但请求被取消：保留上一次结果，避免停在“加载中”。
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

function isTraitDominant(gene: GeneKey, value: string | null): boolean {
  const info = GENE_INFO[gene];
  return value === info.dominantTrait;
}

async function handlePlantClick(plantId: string): Promise<void> {
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
  if (gameState) {
    gameState = { ...gameState, uvLevel: value };
  }
  updateCrossbreedButton();
  schedulePreviewRefresh();

  // 用单调递增的请求序号废止乱序返回的旧响应；同时 abort 上一个在途请求。
  const mySeq = ++uvRequestSeq;
  if (uvAbort) uvAbort.abort();
  const controller = new AbortController();
  uvAbort = controller;
  uvPending = true;
  updateCrossbreedButton();

  try {
    const serverState = await api.setUVLevel(value, controller.signal);
    // 只有当前这是最新的 UV 请求时才采纳服务端返回；旧响应一律丢弃。
    if (mySeq !== uvRequestSeq) return;
    gameState = serverState;
    updateUI();
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('Failed to set UV level:', error);
    }
  } finally {
    // 无论成功、失败还是被 abort，都要在“这是最新一次请求”时解除 pending；
    // 旧请求被 abort 时不能触碰新请求的 uvPending/uvAbort 状态。
    if (mySeq === uvRequestSeq) {
      uvPending = false;
      uvAbort = null;
      updateCrossbreedButton();
    }
  }
}

async function handleCrossbreed(): Promise<void> {
  if (!gameState || !gameState.selectedParent1 || !gameState.selectedParent2) return;

  // 杂交请求体里直接携带最新 uvLevel，不必等 UV 同步完成；
  // 这里主动 abort 在途的 UV/预览请求，避免它们的响应在杂交后覆盖界面。
  if (uvAbort) {
    uvAbort.abort();
    uvAbort = null;
  }
  uvPending = false;
  invalidatePreviewRequest();

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
    if ((error as Error).name === 'AbortError') return;
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

function schedulePreviewRefresh(): void {
  if (previewTimer !== null) {
    clearTimeout(previewTimer);
  }
  // 亲本/UV 一变化就立刻废止在途预览，防止旧响应在新防抖触发前写入页面。
  if (previewAbort) {
    previewAbort.abort();
    previewAbort = null;
  }
  previewRequestToken++;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    void refreshPreview();
  }, 120);
}

function renderPreviewError(message: string): void {
  if (!DOM.previewContent) return;
  DOM.previewContent.innerHTML = `
    <div class="preview-error">
      <span class="preview-error-icon">⚠️</span>
      <span>${message}</span>
    </div>
  `;
}

function renderPreviewLoading(): void {
  if (!DOM.previewContent) return;
  DOM.previewContent.innerHTML = `<p class="preview-hint">正在计算后代概率…</p>`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function phenotypeDisplay(value: string): string {
  if (value === 'none') return '无特殊能力';
  return value;
}

function renderPreview(preview: PreviewResponse): void {
  if (!DOM.previewContent) return;

  const genesHtml = preview.genes.map(gene => {
    const phenoRows = gene.phenotypeOutcomes.map(outcome => `
      <div class="preview-row">
        <span class="preview-label">${phenotypeDisplay(outcome.phenotype)}</span>
        <span class="preview-bar">
          <span class="preview-bar-fill" style="width: ${outcome.probabilityPercent}%"></span>
        </span>
        <span class="preview-percent">${formatPercent(outcome.probabilityPercent)}</span>
      </div>
    `).join('');

    const genoBadges = gene.genotypeOutcomes.map(outcome => {
      const [a, b] = outcome.genotype;
      const info = GENE_INFO[gene.gene];
      const aClass = a === info.dominantAllele ? 'dominant' : 'recessive';
      const bClass = b === info.dominantAllele ? 'dominant' : 'recessive';
      return `
        <span class="preview-geno-badge">
          <span class="allele-chip ${aClass}">${a}</span>
          <span class="allele-chip ${bClass}">${b}</span>
          <span class="preview-geno-percent">${formatPercent(outcome.probabilityPercent)}</span>
        </span>
      `;
    }).join('');

    return `
      <div class="preview-gene">
        <div class="preview-gene-title">${gene.label}</div>
        <div class="preview-rows">${phenoRows}</div>
        <div class="preview-geno-list">${genoBadges}</div>
      </div>
    `;
  }).join('');

  const speciesHtml = preview.speciesUnlocks.length === 0
    ? `<div class="preview-all-unlocked">🏆 所有物种均已解锁，本次杂交不会发现新物种。</div>`
    : preview.speciesUnlocks.map(species => {
        const rarityClass = `rarity-${species.rarity}`;
        const blockedHtml = species.blockedBy.length > 0
          ? `<div class="preview-blocked">被「${species.blockedBy.join('、')}」抢先时无法解锁</div>`
          : '';
        return `
          <div class="preview-species ${rarityClass}">
            <div class="preview-species-head">
              <span class="preview-species-icon">${species.image}</span>
              <span class="preview-species-name">${species.speciesName}</span>
              <span class="rarity-badge ${species.rarity}">${getRarityText(species.rarity)}</span>
            </div>
            <div class="preview-row">
              <span class="preview-label">满足条件</span>
              <span class="preview-bar">
                <span class="preview-bar-fill match" style="width: ${species.matchProbabilityPercent}%"></span>
              </span>
              <span class="preview-percent">${formatPercent(species.matchProbabilityPercent)}</span>
            </div>
            <div class="preview-row">
              <span class="preview-label">实际解锁</span>
              <span class="preview-bar">
                <span class="preview-bar-fill unlock" style="width: ${species.unlockProbabilityPercent}%"></span>
              </span>
              <span class="preview-percent">${formatPercent(species.unlockProbabilityPercent)}</span>
            </div>
            ${blockedHtml}
          </div>
        `;
      }).join('');

  const speciesSummaryHtml = preview.speciesUnlocks.length === 0 ? '' : `
    <div class="preview-species-summary">
      <span>至少解锁一个新物种：<strong>${formatPercent(preview.anySpeciesUnlockProbabilityPercent)}</strong></span>
      <span>不解锁新物种：<strong>${formatPercent(preview.noSpeciesUnlockProbabilityPercent)}</strong></span>
    </div>
  `;

  DOM.previewContent.innerHTML = `
    <div class="preview-summary">
      <div class="preview-summary-item">
        <span class="preview-summary-label">亲本组合</span>
        <span class="preview-summary-value">${preview.parent1Name} × ${preview.parent2Name}</span>
      </div>
      <div class="preview-summary-item">
        <span class="preview-summary-label">UV 等级</span>
        <span class="preview-summary-value">${preview.uvLevel}%</span>
      </div>
      <div class="preview-summary-item mutation">
        <span class="preview-summary-label">整株突变概率</span>
        <span class="preview-summary-value">${formatPercent(preview.mutationProbabilityPercent)}</span>
      </div>
    </div>
    <div class="preview-section">
      <h4>五类性状分布</h4>
      ${genesHtml}
    </div>
    <div class="preview-section">
      <h4>未解锁物种概率</h4>
      ${speciesSummaryHtml}
      <div class="preview-species-list">${speciesHtml}</div>
      <p class="preview-footnote">“满足条件”可能相互重叠；“实际解锁”已按物种优先级扣除被更高优先级物种抢先的部分，各物种实际解锁概率互斥，合计不会超过 100%。</p>
    </div>
  `;
}

async function refreshPreview(): Promise<void> {
  if (!gameState || !DOM.previewContent) return;

  const parent1Id = gameState.selectedParent1;
  const parent2Id = gameState.selectedParent2;
  const uvLevel = gameState.uvLevel;

  // 任何无效状态都先废止在途请求，防止旧响应覆盖新提示。
  if (!parent1Id || !parent2Id || parent1Id === parent2Id || uvLevel < 0 || uvLevel > 100) {
    invalidatePreviewRequest();
    if (!parent1Id || !parent2Id) {
      DOM.previewContent.innerHTML = `<p class="preview-hint">请在下方选择两株不同的亲本植物。</p>`;
    } else if (parent1Id === parent2Id) {
      renderPreviewError('两株亲本必须是不同的植物。');
    } else {
      renderPreviewError('紫外线强度必须在 0 到 100 之间。');
    }
    return;
  }

  const parent1 = gameState.plants.find(p => p.id === parent1Id);
  const parent2 = gameState.plants.find(p => p.id === parent2Id);
  if (!parent1 || !parent2) {
    invalidatePreviewRequest();
    renderPreviewError('选择的亲本已被删除，请重新选择。');
    return;
  }

  const key = `${parent1Id}|${parent2Id}|${uvLevel}`;
  if (key === lastPreviewKey) return;
  lastPreviewKey = key;

  // 废止上一个在途预览，保证只有最新一次请求能写入页面。
  if (previewAbort) previewAbort.abort();
  const controller = new AbortController();
  previewAbort = controller;
  const token = ++previewRequestToken;

  renderPreviewLoading();

  try {
    const result: PreviewResult = await api.previewCrossbreed(
      { parent1Id, parent2Id, uvLevel },
      controller.signal
    );
    if (token !== previewRequestToken || controller.signal.aborted) return;

    if (result.valid) {
      renderPreview(result);
    } else {
      renderPreviewError(result.error.message);
    }
  } catch (error) {
    if (token !== previewRequestToken) return;
    if ((error as Error).name === 'AbortError') {
      // 请求被新状态取消：不要停在“加载中”，按当前状态回退到提示或保留上次结果。
      renderPreviewPlaceholder();
      return;
    }
    console.error('Preview failed:', error);
    renderPreviewError('预览请求失败，请稍后重试。');
  } finally {
    if (token === previewRequestToken) {
      previewAbort = null;
    }
  }
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
