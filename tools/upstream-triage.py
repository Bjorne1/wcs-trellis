"""上游同步 triage：把 upstream/main 上还没处理过的提交分成三堆。

为什么需要这个脚本：fork 用 cherry-pick 而非 merge 吸收上游，祖先关系是断的，
所以 `main..upstream/main` 这个差集里混着"已经 pick 过的""明确不要的""还没看过的"
三种提交。脚本按 docs/upstream/policy.yml 的规则把它们分开，只有 review 那一堆
值得进 Trellis 任务流程。

用法：
  python tools/upstream-triage.py           分类并打印三堆
  python tools/upstream-triage.py --check    只跑台账一致性检查
"""

from __future__ import annotations

import re
import subprocess
import sys

import yaml

POLICY = "docs/upstream/policy.yml"
DIVERGENCE = "docs/upstream/divergence.yml"

# Windows 上 python 的 stdout 默认走 locale 编码（cp936），上游提交标题里的
# 中文和 emoji 会直接抛 UnicodeEncodeError 把脚本打断。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args],
        capture_output=True,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def rule_paths(rule: dict, platforms: list[str]) -> tuple[tuple[str, ...], frozenset[str]]:
    """把一条规则展开成 (目录前缀, 精确文件名)。{p} 按平台名逐个替换。"""
    prefixes = list(rule.get("path_prefixes", []))
    exacts = set(rule.get("path_exact", []))
    for tpl in rule.get("path_templates", []):
        for p in platforms:
            filled = tpl.format(p=p)
            if filled.endswith("/"):
                prefixes.append(filled)
            else:
                exacts.add(filled)
    return tuple(prefixes), frozenset(exacts)


def matches(files: list[str], prefixes: tuple[str, ...], exacts: frozenset[str]) -> list[str]:
    return [f for f in files if f in exacts or f.startswith(prefixes)]


def absorbed_shas() -> set[str]:
    """main 上所有 cherry-pick 尾注里记录的上游 sha —— 已吸收集合，永不手写。"""
    body = git("log", "main", "--format=%B")
    return set(re.findall(r"cherry picked from commit ([0-9a-f]{7,40})", body))


def scope_of(subject: str) -> str | None:
    m = re.match(r"^\w+\(([^)]+)\)", subject)
    return m.group(1) if m else None


def hits_rule(subject: str, files: list[str], rule: dict, platforms: list[str]) -> str | None:
    """返回命中理由，未命中返回 None。"""
    scope = scope_of(subject)
    if scope and scope in rule.get("scopes", []):
        return f"scope={scope}"
    for pat in rule.get("subject_patterns", []):
        if re.search(pat, subject):
            return f"subject~{pat}"
    prefixes, exacts = rule_paths(rule, platforms)
    if files and len(matches(files, prefixes, exacts)) == len(files):
        return "所有改动文件都在规则路径内"
    return None


def divergence_paths(divergence: dict) -> list[tuple[str, tuple[str, ...], frozenset[str]]]:
    return [
        (e["id"], *rule_paths(e, []))
        for e in divergence["entries"]
    ]


def triage(policy: dict, divergence: dict) -> int:
    platforms = policy["rules"][0].get("scopes", [])
    absorbed = absorbed_shas()
    div = divergence_paths(divergence)
    all_rule_paths = [rule_paths(r, platforms) for r in policy["rules"]]

    skip: list[str] = []
    auto: list[str] = []
    review: list[str] = []
    done = 0

    for line in git(
        "log", "--no-merges", "--format=%H\x1f%s", "main..upstream/main"
    ).splitlines():
        sha, subject = line.split("\x1f")
        short = sha[:8]
        if any(sha.startswith(a) or a.startswith(short) for a in absorbed):
            done += 1
            continue
        files = [f for f in git("show", "--pretty=", "--name-only", sha).split("\n") if f.strip()]

        hit = next(
            ((r["id"], why) for r in policy["rules"] if (why := hits_rule(subject, files, r, platforms))),
            None,
        )
        if hit:
            covered = {f for pre, ex in all_rule_paths for f in matches(files, pre, ex)}
            stray = [f for f in files if f not in covered]
            if not stray:
                skip.append(f"  {short}  {subject}\n            ↳ {hit[0]} ({hit[1]})")
                continue
            review.append(
                f"  {short}  {subject}\n            ↳ 命中 {hit[0]} 但有 {len(stray)} "
                f"个文件在规则之外：{', '.join(stray[:4])}"
            )
            continue

        risky = {d_id: m for d_id, pre, ex in div if (m := matches(files, pre, ex))}
        if risky:
            areas = ", ".join(f"{k}({len(v)})" for k, v in risky.items())
            review.append(f"  {short}  {subject}\n            ↳ 触碰改造区：{areas}")
        else:
            auto.append(f"  {short}  {subject}")

    print(f"已吸收（cherry-pick 尾注可证）：{done} 条\n")
    for title, bucket, note in (
        ("SKIP", skip, "命中排除规则；列出来供扫一眼，不是静默丢弃"),
        ("AUTO", auto, "不碰改造区，可直接 cherry-pick -x"),
        ("REVIEW", review, "碰到改造区或规则判不了，只有这堆值得进任务流程"),
    ):
        print(f"── {title} ({len(bucket)})  {note}")
        print("\n".join(bucket) if bucket else "  （空）")
        print()
    return len(review)


def check(policy: dict, divergence: dict) -> int:
    """台账一致性检查。任何靠人维护的记录都会漂移，除非能被机器校验。"""
    problems: list[str] = []
    baseline = policy["divergence_baseline"]

    # 1. tag 命名空间隔离是否完好。少了 tagOpt，fetch 的 tag auto-following
    #    会把上游 tag 塞回 refs/tags/ 根，隔离就白做了。
    cfg = git("config", "--get-regexp", r"^remote\.upstream\.")
    if "--no-tags" not in cfg:
        problems.append("remote.upstream.tagOpt 不是 --no-tags：上游 tag 会污染根命名空间")
    if "refs/tags/upstream/*" not in cfg:
        problems.append("remote.upstream.fetch 缺少 +refs/tags/*:refs/tags/upstream/* refspec")

    # 2. 撞名检测：fork 自有 tag 与上游 tag 同名。
    fork_tags = set(git("tag", "--list", "v*").split())
    up_tags = {r.split("/", 1)[1] for r in git(
        "for-each-ref", "--format=%(refname:short)", "refs/tags/upstream/*").split()}
    for name in sorted(fork_tags & up_tags):
        problems.append(f"tag 撞名：v{name} 同时存在于 fork 与上游命名空间")

    # 3. 每条改造是否还真的存在。不同点消失 = 改造被覆盖或已被上游吸收。
    for entry in divergence["entries"]:
        prefixes, exacts = rule_paths(entry, [])
        specs = [*prefixes, *exacts]
        if not specs:
            continue
        diff = git("diff", "--name-only", baseline, "main", "--", *specs)
        if not diff.strip():
            problems.append(
                f"divergence/{entry['id']}: 相对 {baseline} 已无差异，改造可能被覆盖或已被上游吸收"
            )

    # 4. 遗漏检测：fork 自有提交改过、两侧都存在、却没被任何台账条目覆盖的文件。
    own = [s for s in git("rev-list", "--no-merges", "main", "--not", "--remotes=upstream").split()
           if s not in absorbed_shas()]
    touched: set[str] = set()
    for sha in own:
        touched.update(f for f in git("show", "--pretty=", "--name-only", sha).split("\n") if f.strip())
    both_sides = {l.split("\t")[1] for l in
                  git("diff", "--name-status", baseline, "main").splitlines() if l.startswith("M")}
    div = divergence_paths(divergence)
    uncovered = sorted(
        f for f in touched & both_sides
        if not any(matches([f], pre, ex) for _, pre, ex in div)
    )
    if uncovered:
        problems.append(
            f"{len(uncovered)} 个自有改动文件未被台账覆盖，前 10 个："
            + "\n      " + "\n      ".join(uncovered[:10])
        )

    if problems:
        print(f"✗ {len(problems)} 项需要处理：")
        for p in problems:
            print(f"  - {p}")
    else:
        print("✓ 台账与仓库状态一致")
    return len(problems)


def main() -> None:
    policy, divergence = load(POLICY), load(DIVERGENCE)
    if "--check" in sys.argv[1:]:
        sys.exit(1 if check(policy, divergence) else 0)
    triage(policy, divergence)
    print("─" * 60)
    check(policy, divergence)


if __name__ == "__main__":
    main()



