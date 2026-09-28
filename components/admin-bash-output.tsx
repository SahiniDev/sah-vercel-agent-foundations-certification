"use client";

import { Terminal } from "lucide-react";

type BashState =
  | { state: "input-streaming" | "input-available"; input?: { command?: string } }
  | { state: "output-available"; input?: { command?: string }; output?: { stdout: string; stderr: string; exitCode: number } | null };

interface AdminBashOutputProps {
  invocation: BashState;
}

export function AdminBashOutput({ invocation }: AdminBashOutputProps) {
  const command = invocation.input?.command;

  if (
    invocation.state === "input-streaming" ||
    invocation.state === "input-available"
  ) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
        <Terminal className="h-4 w-4 shrink-0" />
        <span className="font-mono text-xs opacity-60">
          {command ?? "Running…"}
        </span>
        <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-green-500" />
      </div>
    );
  }

  if (invocation.state !== "output-available" || !invocation.output) return null;

  const { stdout, stderr, exitCode } = invocation.output;
  const hasOutput = stdout?.trim() || stderr?.trim();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-zinc-950 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Terminal className="h-4 w-4 shrink-0 text-zinc-400" />
        {command && (
          <span className="flex-1 truncate font-mono text-xs text-zinc-400">
            {command}
          </span>
        )}
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            exitCode === 0
              ? "bg-green-950 text-green-400"
              : "bg-red-950 text-red-400"
          }`}
        >
          {exitCode === 0 ? "ok" : `exit ${exitCode}`}
        </span>
      </div>

      {/* Output */}
      {hasOutput && (
        <div className="max-h-64 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
          {stdout?.trim() && (
            <pre className="whitespace-pre-wrap text-zinc-200">{stdout.trim()}</pre>
          )}
          {stderr?.trim() && (
            <pre className="mt-2 whitespace-pre-wrap text-red-400">{stderr.trim()}</pre>
          )}
        </div>
      )}
    </div>
  );
}
