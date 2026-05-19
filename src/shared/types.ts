export type ISODateTime = string;

export type JsonObject = Record<string, unknown>;

export type CommandResult = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
};

export * from "./ipc";
export * from "./schemas";
