import { slugify } from "../projects/projectStore";

export function buildDeterministicSessionId(input: {
  projectSlug: string;
  taskId: string;
  agentSlug: string;
}): string {
  return `lelio-${slugify(input.projectSlug)}-${slugify(input.taskId)}-${slugify(input.agentSlug)}`.slice(0, 180);
}
