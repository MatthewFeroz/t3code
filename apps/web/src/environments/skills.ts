import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  fetchEnvironmentSkill,
  fetchEnvironmentSkills,
} from "@t3tools/client-runtime/state/skills";
import {
  createRuntimeCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgentSkillDetailParams, ProjectId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

interface SkillLocation {
  prepared: PreparedConnection;
  projectId: ProjectId | null;
}
const listCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "skills:list",
  execute: ({ prepared, projectId }: SkillLocation) =>
    fetchEnvironmentSkills(prepared, projectId === null ? {} : { projectId }),
});
const detailCommand = createRuntimeCommand(connectionAtomRuntime, {
  label: "skills:detail",
  execute: ({ prepared, projectId, skill }: SkillLocation & { skill: AgentSkillDetailParams }) =>
    fetchEnvironmentSkill(prepared, projectId === null ? {} : { projectId }, skill),
});

export async function listAgentSkills(prepared: PreparedConnection, projectId: ProjectId | null) {
  const result = await listCommand.run(appAtomRegistry, { prepared, projectId });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

export async function getAgentSkill(
  prepared: PreparedConnection,
  projectId: ProjectId | null,
  skill: AgentSkillDetailParams,
) {
  const result = await detailCommand.run(appAtomRegistry, { prepared, projectId, skill });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}
