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

## 报警器分层

1. **CI 常驻**：`tests/golden-replay.test.ts` —— 脱敏真实流（474 events，manifest 金标）。fold 或替换语义任何漂移 ⇒ 单测红。
2. **升级门**：`npm run verify:dsh -- --json` —— 机器可读报告，exit code 可接 CI。
3. **人工深检**：`npm run reconcile -- <events.jsonl>` —— 框图比对任意会话日志。

## Fixture 治理

- `tests/fixtures/real-world/usage-events.jsonl` 由 `tools/desensitize-fixture.ts` 从真实日志确定性生成：时间整体平移至中性纪元、token 值 uniform 变换、模型名双射改名（provider-N/model-M）。
- 审计过零泄漏：无真实模型名、无原始时间戳；原始会话日志永不入库。
