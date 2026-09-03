# DSH Compatibility Matrix

> `src/compat.ts` 是唯一耦合面；本文件是它的**版本防火墙档案**。
> 每次 DSH 升级后跑 `npm run verify:dsh`，PASS 即追加一行。

## 升级仪式（Ritual）

```
DSH checkout 升级
      ↓
npm run verify:dsh        # golden-replay → reconcile → spike → tsc → tests
      ↓
PASS → COMPATIBILITY.md 追加归档行
FAIL → compat.ts 对照新契约修订 → 全套 Golden Cases 复跑 → 再走一次 ritual
```

## 已验证矩阵

| MADRank | DSH commit | Token Meter contract | Session Projection API | Loader lifecycle | 验证日 | 方式 |
|---|---|---|---|---|---|---|
| v0.1.0 | `141eb6fef8` | ✅ verified（71,590 真实事件 + 脱敏 fixture 双证） | ✅ verified（register / onChanged / snapshot feed） | ✅ verified（vendor cordis boot EXIT:0） | 2026-08-27 | `npm run verify:dsh` |
| v0.1.0 | `0.1.1-rc.2`（npm 安装包） | ✅ verified（golden-replay + reconcile 双 PASS） | ✅ verified（**rc.2 起注册必须带 `wire`**：新增 `stateSchema`+`wire` 双形状；rc.2 runtime spike 实证——无 wire 即 host-only，snapshot/onChanged 静默跳过 ⇒ 卡片全零事故） | ✅ verified（五门 PASS · RUN_SPIKE=0） | 2026-08-31 | `npm run verify:dsh` + rc.2 spike |
| v0.1.0（v0.2 交互规范：Quick View/Settings 分工 + autoSync/clearLocal 通道） | `141eb6fef8` | ✅ verified（103 tests + golden-replay PASS） | ✅ verified（wire 图谱 +4=autoSync；decode 透传命令字段） | ✅ verified（五门 PASS） | 2026-09-03 | `npm run verify:dsh` |

## 报警器分层

1. **CI 常驻**：`tests/golden-replay.test.ts` —— 脱敏真实流（474 events，manifest 金标）。fold 或替换语义任何漂移 ⇒ 单测红。
2. **升级门**：`npm run verify:dsh -- --json` —— 机器可读报告，exit code 可接 CI。
3. **人工深检**：`npm run reconcile -- <events.jsonl>` —— 框图比对任意会话日志。

## ⚠️ 升级必须重验的缝（血泪清单）

- **0.1.0-rc.8 → 0.1.1-rc.2**：投影注册从单轨变双轨。无 `wire` = host-only 单元——**fold 照常、
  推送全无**（不报错、测试全绿、唯独真实卡片没数据）。此类断裂单测/spike 都可能漏掉，
  升级后必须真机看一次卡片数字。

## Fixture 治理

- `tests/fixtures/real-world/usage-events.jsonl` 由 `tools/desensitize-fixture.ts` 从真实日志确定性生成：时间整体平移至中性纪元、token 值 uniform 变换、模型名双射改名（provider-N/model-M）。
- 审计过零泄漏：无真实模型名、无原始时间戳；原始会话日志永不入库。
