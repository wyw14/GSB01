import { CrossPreviewRequest, CrossPreviewResponse } from '../shared/types';

// 预览请求的并发/废止控制器（无 DOM 依赖，便于单元测试）。
// 每次 begin() 递增令牌并返回该令牌；只有持有“当前最新令牌”的响应才允许写入 UI。
// 因此：即使一个合法预览请求尚未返回，只要期间又调用了 begin()（亲本取消/变同株/被删除/UV 变无效等），
// 旧响应回来时 isCurrent() 为 false，会被丢弃，不会覆盖当前提示。
export class PreviewRequestController {
  private token = 0;

  // 开始一次新的预览意图，废止所有更早的在途请求，返回本次令牌。
  begin(): number {
    this.token += 1;
    return this.token;
  }

  // 判断某个令牌是否仍是最新的（决定其响应能否写入 UI）。
  isCurrent(token: number): boolean {
    return token === this.token;
  }
}

// 校验预览前置条件，返回错误提示文案；通过则返回 null。
// 抽成纯函数，保证客户端的即时校验与展示口径可被测试覆盖。
export type PreviewInputs = {
  selectedParent1: string | null;
  selectedParent2: string | null;
  uvLevel: number;
  plantExists: (id: string) => boolean;
};

export function validatePreviewInputs(inputs: PreviewInputs): string | null {
  const { selectedParent1, selectedParent2, uvLevel, plantExists } = inputs;

  if (!selectedParent1 || !selectedParent2) {
    return '选择两株不同的亲本后，将在此显示各性状可能结果与概率。';
  }
  if (selectedParent1 === selectedParent2) {
    return '请选择两株不同的亲本植物。';
  }
  if (!plantExists(selectedParent1) || !plantExists(selectedParent2)) {
    return '亲本植物不存在或已被删除。';
  }
  if (uvLevel < 0 || uvLevel > 100) {
    return '紫外线强度需在 0 到 100 之间。';
  }
  return null;
}

export function buildPreviewRequest(
  selectedParent1: string,
  selectedParent2: string,
  uvLevel: number
): CrossPreviewRequest {
  return { parent1Id: selectedParent1, parent2Id: selectedParent2, uvLevel };
}

export type { CrossPreviewResponse };
