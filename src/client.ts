import { checkWorkerVersion, type Action, type AppState, type Reply } from "./model.ts";

export async function request(action: Action): Promise<AppState> {
  if (!globalThis.chrome?.runtime?.id) {
    throw new Error("Load the dist folder as an unpacked Chrome/Edge extension to use Exercise Snacks.");
  }
  const reply: Reply = await chrome.runtime.sendMessage(action);
  if (!reply) throw new Error("The extension worker did not respond. Reload the extension and try again.");
  checkWorkerVersion(reply.apiVersion);
  if (!reply.ok) throw new Error(reply.error);
  return reply.state;
}

export function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
