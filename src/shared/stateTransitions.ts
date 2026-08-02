import { GameState } from './types';

/**
 * 亲本选择的状态转移规则，服务端与前端共用同一份：
 * 前端据此在点击瞬间乐观更新（同步废止旧预览），服务端据此持久化，
 * 避免两套实现产生偏差。
 *
 * 规则：点击已占据目标槽的植物则清空该槽；选择新植物时清理另一槽中的重复选择。
 */
export function applyParentSelection(state: GameState, parentId: string, parentSlot: 1 | 2): GameState {
  if (parentSlot === 1) {
    const shouldClearSlot = state.selectedParent1 === parentId;
    return {
      ...state,
      selectedParent1: shouldClearSlot ? null : parentId,
      selectedParent2: state.selectedParent2 === parentId ? null : state.selectedParent2
    };
  }
  const shouldClearSlot = state.selectedParent2 === parentId;
  return {
    ...state,
    selectedParent1: state.selectedParent1 === parentId ? null : state.selectedParent1,
    selectedParent2: shouldClearSlot ? null : parentId
  };
}

/** 删除植物的状态转移：移除植物并清空指向它的亲本槽 */
export function applyPlantRemoval(state: GameState, plantId: string): GameState {
  return {
    ...state,
    plants: state.plants.filter(p => p.id !== plantId),
    selectedParent1: state.selectedParent1 === plantId ? null : state.selectedParent1,
    selectedParent2: state.selectedParent2 === plantId ? null : state.selectedParent2
  };
}
