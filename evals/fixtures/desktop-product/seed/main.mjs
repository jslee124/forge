import { handle } from "./workflow.mjs";
export const receive = (requestId, tool) => handle(requestId, tool);
