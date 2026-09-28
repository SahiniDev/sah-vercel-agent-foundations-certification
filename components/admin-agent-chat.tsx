"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@workflow/ai";
import { useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { AdminBashOutput } from "@/components/admin-bash-output";

const SUGGESTIONS = [
  "Show me low-stock items",
  "What were last week's top sellers?",
  "Summarize this week's revenue",
  "Any urgent open support tickets?",
  "Which products have the most returns this month?",
];

const RUN_ID_KEY = "admin-workflow-run-id";

export function AdminAgentChat() {
  const [input, setInput] = useState("");

  const activeRunId = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(RUN_ID_KEY) ?? undefined;
  }, []);

  const { messages, error, sendMessage } = useChat({
    resume: Boolean(activeRunId),
    transport: new WorkflowChatTransport({
      api: "/api/admin/chat",
      onChatSendMessage: (response) => {
        const runId = response.headers.get("x-workflow-run-id");
        if (runId) localStorage.setItem(RUN_ID_KEY, runId);
      },
      onChatEnd: () => localStorage.removeItem(RUN_ID_KEY),
      prepareReconnectToStreamRequest: ({ api, ...rest }) => {
        const runId = localStorage.getItem(RUN_ID_KEY);
        if (!runId) throw new Error("No active admin workflow run ID found");
        return { ...rest, api: `/api/admin/chat/${encodeURIComponent(runId)}/stream` };
      },
    }),
    onError: () => {
      // Clear a stale run ID so the next message starts a fresh run
      // instead of repeatedly trying to reconnect to a dead run.
      localStorage.removeItem(RUN_ID_KEY);
    },
  });

  const handleSubmit = (_message: PromptInputMessage) => {
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleSuggestion = (suggestion: string) => {
    sendMessage({ text: suggestion });
  };

  if (error) return <div className="p-4 text-sm text-destructive">{error.message}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((m) =>
            m.parts.map((p, i) => {
              switch (p.type) {
                case "text":
                  return (
                    <Message key={`${m.id}-${i}`} from={m.role}>
                      <MessageContent>
                        <MessageResponse>{p.text}</MessageResponse>
                      </MessageContent>
                    </Message>
                  );
                case "tool-bash":
                  return (
                    <AdminBashOutput
                      key={`${m.id}-${i}`}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      invocation={p as any}
                    />
                  );
                default:
                  return null;
              }
            }),
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions>
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={handleSuggestion} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit status="ready" disabled={!input.trim()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
