# 上游同步

本 fork 从 `mindfold-ai/Trellis` 分出（分叉点是上游 `v0.7.0-beta.3`），用 cherry-pick 而非
merge 吸收上游改动，因为上游那 20 个非 Claude/Codex 平台的代码不能进来。

代价是祖先关系断裂：`main..upstream/main` 这个差集里混着"已经 pick 过的""明确不要的"
"还没看过的"三种提交，git 自己算不出你还没处理什么。这个目录就是补回这份记账。

## 文件分工

| 文件                 | 内容                                    | 谁维护       |
| -------------------- | --------------------------------------- | ------------ |
| `policy.yml`         | 排除规则（主题级，不是逐提交）          | 人写         |
| `divergence.yml`     | fork 改造过、上游仍在维护的地方         | 人写         |
| `sync-log.md`        | 每轮同步的基线、计数、未决项            | 人写         |
| `inherited-tags.txt` | 从上游继承的 tag 快照，兼回滚依据       | 迁移时生成   |
| 已吸收集合           | 从 cherry-pick 的 `-x` 尾注自动提取     | 永不手写     |
| 已处理边界           | git 祖先关系（`merge -s ours` 标记）    | 永不手写     |

## tag 命名空间

上游 tag 位于 `refs/tags/upstream/*`，fork 自己的 tag 独占 `refs/tags/v*`。配置：

```
remote.upstream.tagOpt = --no-tags
remote.upstream.fetch  = +refs/heads/*:refs/remotes/upstream/*
remote.upstream.fetch  = +refs/tags/*:refs/tags/upstream/*
remote.origin.tagOpt   = --no-tags
```

前两项里 `tagOpt = --no-tags` 是必需的另一半：少了它，fetch 的 tag auto-following 会把上游
tag 直接写进 `refs/tags/` 根，上游发到 0.8.x 时就与 fork 已发布的版本号撞名。

`remote.origin.tagOpt` 同样必需，而且更容易被忽略：**origin 上还存着 147 个继承来的上游
tag**，只隔离 upstream 不管 origin 时，任何 `git fetch origin` 都会把它们全部抓回根命名空间，
把清理悄悄撤销掉。第一次做隔离就是这样失败的——删干净之后一次 fetch origin 就全回来了，
而且当时没人发现。代价是 fork 自己的 tag 也不再从 origin 自动抓；要在另一个检出里取某个
版本 tag，得显式指定：`git fetch origin refs/tags/v0.8.1:refs/tags/v0.8.1`。

根治还需要删掉 origin 上那 147 个 tag，否则新克隆仍会带回它们（`git clone` 默认抓全部 tag）。
删除远端 tag 会让基于它们建的 GitHub release 失效，是不可逆操作，需要单独授权。

两个不能碰的命令：

- **`git fetch upstream --tags`** —— `--tags` 等价于临时追加 `refs/tags/*:refs/tags/*`，
  会绕过上面的 refspec 把上游 tag 塞回根命名空间。只用 `git fetch upstream`。
- **`git push --tags` / `--follow-tags`** —— 会把 147 个 `upstream/*` tag 推到 origin。
  `packages/cli/scripts/release.js` 已改为按全名精确推送本次 tag。

另外 `git tag -l 'v*'` **不能**用来数根命名空间的 tag：git 的 ref pattern 会匹配 refname 的
尾段，`v*` 把 `upstream/v0.6.16` 也算进来，结果是 156 而不是 9。要精确判断请用
`git for-each-ref refs/tags/` 再按 `upstream/` 前缀分流，`--check` 就是这么做的。

## 每轮流程

```bash
git fetch upstream                      # 1. 只 fetch，不要 --tags
python tools/upstream-triage.py         # 2. 分三堆 + 跑一致性检查
```

3. **SKIP** —— 命中排除规则的，扫一眼标题和文件就行。规则只排序不丢弃：某个提交若有
   文件落在规则路径之外，脚本会把它降级到 REVIEW，防止上游在平台提交里顺手改了通用代码。
4. **AUTO** —— 不碰 `divergence.yml` 里的改造区，可以直接批量 `git cherry-pick -x`。
   `-x` 尾注就是下一轮的"已吸收"凭证，不要用 `--no-commit` 或改写 message 去掉它。
5. **REVIEW** —— 碰到改造区或规则判不了的。只有这堆值得进 Trellis 任务流程。
6. 收尾三件事：
   ```bash
   # 承认这批上游提交已全部处理过（要么吸收要么拒绝），内容以我方为准
   git merge -s ours refs/tags/upstream/<本轮上游 tag>
   ```
   同时把 `policy.yml` 的 `divergence_baseline` 更新为本轮 tag，并在 `sync-log.md`
   追加一条记录。空 merge 之后 `main..upstream/main` 会收缩为空，下一轮 triage 只会
   显示上游新增的提交——这就是"已同步的不再重新进入流程"的机制保证。

**空 merge 要等 REVIEW 清空再打。** 它声明的是"这个点之前我都处理完了"，REVIEW 还有未决项
时打上去，那些提交会从下一轮的候选集里永久消失。

## 一致性检查

`python tools/upstream-triage.py --check` 单独跑检查，覆盖四件会腐烂的事：

- fetch 配置的 tag 隔离是否完好
- fork tag 与上游 tag 是否撞名
- `divergence.yml` 每条改造相对基线是否还真的存在（差异消失 = 改造被覆盖，或已被上游吸收，
  该条目要么升级为告警要么退役）
- fork 自有改动碰过、两侧都存在、却没被任何台账条目覆盖的文件（防遗漏）
