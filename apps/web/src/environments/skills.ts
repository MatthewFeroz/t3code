import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  fetchEnvironmentSkill,
  fetchEnvironmentSkills,
} from "@t3tools/client-runtime/state/skills";
import type { AgentSkillDetailParams, ProjectId } from "@t3tools/contracts";

import { runtime } from "../lib/runtime";

export function listAgentSkills(prepared: PreparedConnection, projectId: ProjectId | null) {
  return runtime.runPromise(
    fetchEnvironmentSkills(prepared, projectId === null ? {} : { projectId }),
  );
}

export function getAgentSkill(
  prepared: PreparedConnection,
  projectId: ProjectId | null,
  skill: AgentSkillDetailParams,
) {
  return runtime.runPromise(
    fetchEnvironmentSkill(prepared, projectId === null ? {} : { projectId }, skill),
  );
}
