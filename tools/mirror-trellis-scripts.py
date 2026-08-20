"""Mirror the template script tree onto the dogfood `.trellis/scripts` tree.

`regression.test.ts` requires byte-identical `.py` sets in both trees; this is
the one-way copy that restores parity after editing the template copy.
"""

from __future__ import annotations

import filecmp
import os
import shutil

SRC = os.path.join("packages", "cli", "src", "templates", "trellis", "scripts")
DST = os.path.join(".trellis", "scripts")


def py_files(root: str) -> set[str]:
    found: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            found.add(rel.replace(os.sep, "/"))
    return found


def main() -> None:
    src_files = py_files(SRC)
    dst_files = py_files(DST)

    copied: list[str] = []
    for rel in sorted(src_files):
        src_path = os.path.join(SRC, *rel.split("/"))
        dst_path = os.path.join(DST, *rel.split("/"))
        if not os.path.exists(dst_path) or not filecmp.cmp(
            src_path, dst_path, shallow=False
        ):
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            shutil.copyfile(src_path, dst_path)
            copied.append(rel)

    removed = sorted(dst_files - src_files)
    for rel in removed:
        os.remove(os.path.join(DST, *rel.split("/")))

    print(f"copied {len(copied)} file(s):")
    for rel in copied:
        print(f"  {rel}")
    print(f"removed {len(removed)} stale file(s): {removed}")


if __name__ == "__main__":
    main()
