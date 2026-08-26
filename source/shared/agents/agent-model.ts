import type { SandAgentModelSelection } from "./sand-agent-model.js";

export const SAND_DEFAULT_MODEL_ID = "gpt-5.6-luna";

export const SAND_DEFAULT_MODEL_SELECTION: SandAgentModelSelection = {
  modelId: SAND_DEFAULT_MODEL_ID,
  maxMode: true,
  parameters: [
    { id: "effort", value: "medium" },
  ],
};
