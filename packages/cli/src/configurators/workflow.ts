import fs from "node:fs";
import path from "node:path";

import { DIR_NAMES, PATHS } from "../constants/paths.js";
import { copyTrellisDir } from "../templates/extract.js";

// Import trellis templates (generic, not project-specific)
import {
  workflowMdTemplate,
  configYamlTemplate,
  gitignoreTemplate,
  getAllAgents,
} from "../templates/trellis/index.js";

// Import markdown templates
import {
  agentProgressIndexContent,
  // Backend structure (multi-doc)
  backendIndexContent,
  backendDirectoryStructureContent,
  backendDatabaseGuidelinesContent,
  backendLoggingGuidelinesContent,
  backendQualityGuidelinesContent,
  backendErrorHandlingContent,
  // Frontend structure (multi-doc)
  frontendIndexContent,
  frontendDirectoryStructureContent,
  frontendTypeSafetyContent,
  frontendHookGuidelinesContent,
  frontendComponentGuidelinesContent,
  frontendQualityGuidelinesContent,
  frontendStateManagementContent,
  frontendVisualDesignContent,
  // Guides structure
  guidesIndexContent,
  guidesCrossLayerThinkingGuideContent,
  guidesCodeReuseThinkingGuideContent,
} from "../templates/markdown/index.js";

import { writeFile, ensureDir } from "../utils/file-writer.js";
import { replacePythonCommandLiterals } from "./shared.js";
import {
  sanitizePkgName,
  type ProjectType,
  type DetectedPackage,
} from "../utils/project-detector.js";

interface DocDefinition {
  name: string;
  content: string;
}

/** How `spec/frontend/visual-design.md` is scaffolded. See config.yaml. */
export type VisualDesignMode = "auto" | "always";

/**
 * Read `spec.visual_design` from `.trellis/config.yaml`.
 *
 * `createWorkflowStructure` writes config.yaml before it writes spec, and
 * `writeFile` preserves an existing config, so on a re-init this reads the
 * user's own file. A first init has no config yet and gets `auto`.
 *
 * Hand-parsed for the same reason `loadUpdateSkipPaths` in `commands/update.ts`
 * is: config.yaml is read in several places without a YAML dependency.
 *
 * @internal Exported for testing only
 */
export function loadVisualDesignMode(cwd: string): VisualDesignMode {
  const configPath = path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml");
  if (!fs.existsSync(configPath)) return "auto";

  let raw: string | null = null;
  try {
    const lines = fs.readFileSync(configPath, "utf-8").split("\n");
    let inSpec = false;
    for (const line of lines) {
      if (/^spec:\s*(#.*)?$/.test(line)) {
        inSpec = true;
        continue;
      }
      // A non-indented, non-comment, non-blank line closes the block.
      if (inSpec && /^\S/.test(line) && !line.startsWith("#")) {
        inSpec = false;
      }
      if (!inSpec) continue;
      const match = /^\s+visual_design:\s*([^#]+)/.exec(line);
      if (match) {
        raw = match[1]
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .toLowerCase();
        break;
      }
    }
  } catch {
    console.warn(
      `Warning: failed to read ${configPath}, using spec.visual_design: auto`,
    );
    return "auto";
  }

  if (raw === null || raw === "auto") return "auto";
  if (raw === "always") return "always";
  console.warn(
    `Warning: unknown spec.visual_design value "${raw}" in ${configPath}; ` +
      `expected "auto" or "always". Using "auto".`,
  );
  return "auto";
}

/**
 * Options for creating workflow structure
 */
export interface WorkflowOptions {
  /** Detected or specified project type */
  projectType: ProjectType;
  /** Skip creating local spec templates (when using remote template) — single-repo mode */
  skipSpecTemplates?: boolean;
  /** Detected monorepo packages (enables monorepo spec creation) */
  packages?: DetectedPackage[];
  /** Package names that use remote templates (skip blank spec for these) */
  remoteSpecPackages?: Set<string>;
  /**
   * Optional override for `.trellis/workflow.md` content. When omitted the
   * bundled native template is written. Set by `init --workflow` (or
   * `--workflow-source`) after the resolver has fetched marketplace content.
   * Caller is still responsible for removing the `.trellis/workflow.md` hash
   * entry for non-native workflows so update.ts treats them as user-managed.
   */
  workflowMdOverride?: string;
}

/**
 * Create workflow structure based on project type
 *
 * This function creates the .trellis/ directory structure by:
 * 1. Copying scripts/ directory directly (dogfooding)
 * 2. Copying workflow.md and .gitignore (dogfooding)
 * 3. Creating workspace/ with index.md
 * 4. Creating tasks/ directory
 * 5. Creating spec/ with templates (not dogfooded - generic templates)
 *
 * @param cwd - Current working directory
 * @param options - Workflow options including project type
 */
export async function createWorkflowStructure(
  cwd: string,
  options?: WorkflowOptions,
): Promise<void> {
  const projectType = options?.projectType ?? "fullstack";
  const skipSpecTemplates = options?.skipSpecTemplates ?? false;
  const packages = options?.packages;
  const remoteSpecPackages = options?.remoteSpecPackages;
  const workflowMd = options?.workflowMdOverride ?? workflowMdTemplate;

  // Read before this function writes config.yaml. `--force` overwrites the
  // user's config with the template, so reading it later would silently reset
  // the choice to `auto` on exactly the run that rewrites the files.
  const visualDesignMode = loadVisualDesignMode(cwd);

  // Create base .trellis directory
  ensureDir(path.join(cwd, DIR_NAMES.WORKFLOW));

  // Copy scripts/ directory from templates
  await copyTrellisDir("scripts", path.join(cwd, PATHS.SCRIPTS), {
    executable: true,
  });

  // Copy workflow.md (native bundled template or selected marketplace variant)
  await writeFile(
    path.join(cwd, PATHS.WORKFLOW_GUIDE_FILE),
    replacePythonCommandLiterals(workflowMd),
  );

  // Copy .gitignore from templates
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, ".gitignore"),
    gitignoreTemplate,
  );

  // Copy config.yaml from templates
  await writeFile(
    path.join(cwd, DIR_NAMES.WORKFLOW, "config.yaml"),
    configYamlTemplate,
  );

  // Dispatch channel runtime agent definitions. These are platform-agnostic
  // Trellis runtime files consumed by `trellis channel spawn --agent <name>`
  // through `packages/cli/src/commands/channel/agent-loader.ts`. They are
  // dispatched on every init regardless of selected workflow because the user
  // can switch to a channel-driven workflow at any time via `trellis workflow
  // --template`.
  ensureDir(path.join(cwd, PATHS.AGENTS));
  for (const [agentFile, content] of getAllAgents()) {
    await writeFile(path.join(cwd, PATHS.AGENTS, agentFile), content);
  }

  // Create workspace/ with index.md
  ensureDir(path.join(cwd, PATHS.WORKSPACE));
  await writeFile(
    path.join(cwd, PATHS.WORKSPACE, "index.md"),
    replacePythonCommandLiterals(agentProgressIndexContent),
  );

  // Create tasks/ directory
  ensureDir(path.join(cwd, PATHS.TASKS));

  // Create spec templates based on project type
  // These are NOT dogfooded - they are generic templates for new projects
  if (packages && packages.length > 0) {
    // Monorepo mode: create per-package spec directories
    await createSpecTemplates(
      cwd,
      projectType,
      visualDesignMode,
      packages,
      remoteSpecPackages,
    );
  } else if (!skipSpecTemplates) {
    // Single-repo mode: create global spec (skip if using remote template)
    await createSpecTemplates(cwd, projectType, visualDesignMode);
  }
}

/**
 * Write backend spec docs into a target spec directory.
 */
async function writeBackendDocs(specBase: string): Promise<void> {
  const backendDir = path.join(specBase, "backend");
  ensureDir(backendDir);
  const docs: DocDefinition[] = [
    { name: "index.md", content: backendIndexContent },
    {
      name: "directory-structure.md",
      content: backendDirectoryStructureContent,
    },
    {
      name: "database-guidelines.md",
      content: backendDatabaseGuidelinesContent,
    },
    { name: "logging-guidelines.md", content: backendLoggingGuidelinesContent },
    { name: "quality-guidelines.md", content: backendQualityGuidelinesContent },
    { name: "error-handling.md", content: backendErrorHandlingContent },
  ];
  for (const doc of docs) {
    await writeFile(path.join(backendDir, doc.name), doc.content);
  }
}

/**
 * Write frontend spec docs into a target spec directory.
 */
async function writeFrontendDocs(specBase: string): Promise<void> {
  const frontendDir = path.join(specBase, "frontend");
  ensureDir(frontendDir);
  const docs: DocDefinition[] = [
    { name: "index.md", content: frontendIndexContent },
    {
      name: "directory-structure.md",
      content: frontendDirectoryStructureContent,
    },
    { name: "type-safety.md", content: frontendTypeSafetyContent },
    { name: "hook-guidelines.md", content: frontendHookGuidelinesContent },
    {
      name: "component-guidelines.md",
      content: frontendComponentGuidelinesContent,
    },
    {
      name: "quality-guidelines.md",
      content: frontendQualityGuidelinesContent,
    },
    { name: "state-management.md", content: frontendStateManagementContent },
    { name: "visual-design.md", content: frontendVisualDesignContent },
  ];
  for (const doc of docs) {
    await writeFile(path.join(frontendDir, doc.name), doc.content);
  }
}

/**
 * Write spec docs for a given project type into a target spec directory.
 */
async function writeSpecForType(
  specBase: string,
  projectType: ProjectType,
  visualDesignMode: VisualDesignMode,
): Promise<void> {
  if (projectType !== "frontend") {
    await writeBackendDocs(specBase);
  }
  if (projectType !== "backend") {
    await writeFrontendDocs(specBase);
    return;
  }
  if (visualDesignMode === "always") {
    // Backend-only layer, but the user asked for the visual craft rules
    // anyway — backend work in this project reaches rendered surfaces. Only
    // this one file: every other `frontend/` doc is an unfilled stub, so
    // creating them would add noise the layer has no use for. The backend
    // index points here whenever the file exists.
    const frontendDir = path.join(specBase, "frontend");
    ensureDir(frontendDir);
    await writeFile(
      path.join(frontendDir, "visual-design.md"),
      frontendVisualDesignContent,
    );
  }
}

async function createSpecTemplates(
  cwd: string,
  projectType: ProjectType,
  visualDesignMode: VisualDesignMode,
  packages?: DetectedPackage[],
  remoteSpecPackages?: Set<string>,
): Promise<void> {
  // Ensure spec directory exists
  ensureDir(path.join(cwd, PATHS.SPEC));

  // Guides - always created regardless of mode
  const guidesDir = path.join(cwd, `${PATHS.SPEC}/guides`);
  ensureDir(guidesDir);
  const guidesDocs: DocDefinition[] = [
    { name: "index.md", content: guidesIndexContent },
    {
      name: "cross-layer-thinking-guide.md",
      content: guidesCrossLayerThinkingGuideContent,
    },
    {
      name: "code-reuse-thinking-guide.md",
      content: guidesCodeReuseThinkingGuideContent,
    },
  ];
  for (const doc of guidesDocs) {
    await writeFile(path.join(guidesDir, doc.name), doc.content);
  }

  if (packages && packages.length > 0) {
    // Monorepo mode: create spec/<name>/ for each package
    for (const pkg of packages) {
      const dirName = sanitizePkgName(pkg.name);
      if (remoteSpecPackages?.has(dirName)) continue;
      const pkgSpecBase = path.join(cwd, `${PATHS.SPEC}/${dirName}`);
      ensureDir(pkgSpecBase);
      const pkgType = pkg.type === "unknown" ? "fullstack" : pkg.type;
      await writeSpecForType(pkgSpecBase, pkgType, visualDesignMode);
    }
  } else {
    // Single-repo mode
    await writeSpecForType(
      path.join(cwd, PATHS.SPEC),
      projectType,
      visualDesignMode,
    );
  }
}
