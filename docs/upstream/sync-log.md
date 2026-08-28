# 同步日志

每轮一条。基线、计数、未决项写在这里；"哪些提交已吸收"和"处理到哪个点"分别由
cherry-pick 的 `-x` 尾注和 git 祖先关系承担，不在这里重复记账。

---

## 2026-08-28 — 建立台账与 tag 命名空间隔离

**上游基线**：`upstream/v0.6.16`（`88f48344`）；fork 分叉点是 `upstream/v0.7.0-beta.3`（`53ae2047`）

**做了什么**

- 上游 147 个 tag 迁到 `refs/tags/upstream/*`，`refs/tags/v*` 只剩 fork 自己发的 9 个
  （v0.7.1 ~ v0.8.1）。迁移前快照见 `inherited-tags.txt`。迁移时无撞名。
- `remote.upstream` 加 `tagOpt = --no-tags` 与 `+refs/tags/*:refs/tags/upstream/*`。
- `release.js` 的 tag 推送从 `--tags` 改为 `refs/tags/v<version>`，否则会把上游 tag 推到 origin。
- 建立 `policy.yml`（4 条排除规则）、`divergence.yml`（12 条改造条目）、`tools/upstream-triage.py`。

**本轮 triage**（`main..upstream/main` 共 28 条）

| 分类   | 数量 | 说明                                            |
| ------ | ---- | ----------------------------------------------- |
| 已吸收 | 13   | 0.8.0 那轮 port batches 1-3，`-x` 尾注可证      |
| SKIP   | 9    | omp/pi ×5、上游 release ×3、marketplace 指针 ×1 |
| AUTO   | 0    | —                                               |
| REVIEW | 6    | 见下                                            |

**未决的 6 条**

| 提交       | 标题                                        | 为什么要人看                                                             |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `60d6fbff` | fix(hooks): surface unreadable active task records (#544) | 纯通用修复，无排除理由，上一轮 port 时既没吸收也没记排除——台账要补的正是这种缝 |
| `fef6e159` | feat(zcode): add trellis bridge setup hint  | 名义上是平台提交，但顺手改了 `update.ts` 和 `types/ai-tools.ts`           |
| `fee195f0` | fix(opencode): inject context via messages.transform | 只有 `workflow-state-contract.md` 一个文件越界，看那段 spec 改动是否通用  |
| `7dad9f77` | feat(mem): restore the OpenCode session reader | 落在 fork 已删除的 opencode reader 上，大概率不要，但要确认 mem 主干无关联改动 |
| `9914a7f2` | fix(readme): switch star history chart      | README 是改造区（包名、平台名单已重写），不能整文件 pick                  |
| `bd454938` | chore: normalize line endings on checkin    | 与 fork 停止托管 `.gitattributes` 的决定冲突                              |

**还没做**：这 6 条未决，所以本轮没有打 `git merge -s ours refs/tags/upstream/v0.6.16`。
清空 REVIEW 后再打，同时把 `policy.yml` 的 `divergence_baseline` 保持在 v0.6.16 或前移。

**隔离第一次失败又修好的经过**（值得记住的坑）

删掉根命名空间那 147 个 tag 之后，只隔离了 `remote.upstream`，没管 `remote.origin`。
origin 上存着同样的 147 个继承 tag，而 origin 没有 `tagOpt = --no-tags`，于是一次
`git fetch origin` 就把它们全抓回了根命名空间——`refs/tags/v0.6.16` 的 mtime 比
`refs/tags/upstream/v0.6.16` 晚半小时，就是这次回流留下的痕迹。

当时没有立刻发现，因为验证用的是 `git tag -l 'v*'`：git 的 ref pattern 会匹配 refname 的
尾段，`upstream/v0.6.16` 也算命中，所以那条命令数出来的既不是 9 也不是 156，取决于
匹配到什么，根本不能用来判断隔离状态。

修法：`remote.origin.tagOpt = --no-tags`，重新清理，然后**真的跑一次 `git fetch origin`
验证不再回流**。`--check` 现在把 origin 的 tagOpt 也纳入检查，撞名检测改走完整 ref 路径。

**origin 侧清理**：147 个继承 tag 已从 origin 删除，远端只剩 fork 自己的 9 个
（v0.7.1 ~ v0.8.1）。删除前确认过两件事：147 个 tag 在 origin 上的 sha 与
`inherited-tags.txt` 快照逐条一致（回滚可用它重推），且 `gh release list` 为空——
仓库没有任何 GitHub release 挂在这些 tag 上，删除零副作用。`tagOpt = --no-tags`
保留作为防御纵深，代价是 fork tag 不再从 origin 自动抓（README 有显式命令）。
