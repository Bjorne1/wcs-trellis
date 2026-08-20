import { AI_TOOLS } from "../types/ai-tools.js";
import {
  applyPullBasedPreludeMarkdown,
  collectSkillTemplates,
  resolveCommands,
  resolveBundledSkills,
  resolvePlaceholders,
  resolveSkillsNeutral,
} from "./shared.js";
import {
  getAllAgents,
  getExtensionTemplate,
  getSettingsTemplate,
} from "../templates/pi/index.js";

/**
 * The Pi file set — written at init and diffed by `trellis update`.
 */
export function collectPiTemplates(): Map<string, string> {
  const files = new Map<string, string>();
  const ctx = AI_TOOLS.pi.templateContext;

  for (const command of resolveCommands(ctx)) {
    files.set(`.pi/prompts/trellis-${command.name}.md`, command.content);
  }

  // Shared skills go to `.agents/skills/` (Pi discovers this cross-platform
  // workspace alias natively). Neutral resolver keeps content byte-identical
  // to Codex's/Gemini's writes for the same skill names, avoiding the
  // duplicate/conflicting-skill installs reported in #447.
  for (const [filePath, content] of collectSkillTemplates(
    ".agents/skills",
    resolveSkillsNeutral(ctx),
    resolveBundledSkills(ctx),
  )) {
    files.set(filePath, content);
  }

  for (const agent of applyPullBasedPreludeMarkdown(getAllAgents())) {
    files.set(`.pi/agents/${agent.name}.md`, agent.content);
  }

  files.set(".pi/extensions/trellis/index.ts", getExtensionTemplate());

  const settings = getSettingsTemplate();
  files.set(
    `.pi/${settings.targetPath}`,
    resolvePlaceholders(settings.content),
  );

  return files;
}
