import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { PlaygroundView } from "../components/PlaygroundView";
import { projectKeys, listProjects } from "../features/projects/api";
import { getDefaultPlaygroundPage } from "../features/playground/defaults";
import {
  createPlaygroundChat,
  deletePlaygroundChat,
  getPlaygroundChat,
  getRenderedPdfPage,
  listPlaygroundChats,
  makePlaygroundAttachment,
  playgroundKeys,
  renamePlaygroundChat,
  setActivePlaygroundChat,
  streamPlaygroundChatMessage,
  updatePlaygroundChatSettings,
  type PlaygroundAttachment,
  type PlaygroundChatListResponse,
  type PlaygroundChatMessage,
  type PlaygroundChatSession,
  type PlaygroundChatSessionResponse,
} from "../features/playground/api";
import {
  getPrompts,
  getProviders,
  promptsKey,
  savePrompts,
  settingsKey,
} from "../features/settings/api";
import type { VlmThinkingMode } from "../types";

export function PlaygroundRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const promptsQuery = useQuery({ queryKey: promptsKey, queryFn: getPrompts });
  const chatListQuery = useQuery({ queryKey: playgroundKeys.chats, queryFn: listPlaygroundChats });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const verifiedProviders = useMemo(
    () =>
      (providersQuery.data ?? []).filter((provider) => provider.verification_status === "verified"),
    [providersQuery.data],
  );
  const [promptDraft, setPromptDraft] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedThinkingMode, setSelectedThinkingMode] = useState<VlmThinkingMode>("auto");
  const [selectedChatId, setSelectedChatId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const pageDefaultProjectIdRef = useRef("");
  const [pendingAttachments, setPendingAttachments] = useState<PlaygroundAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PlaygroundAttachment[]>([]);
  const [sentAttachmentsByMessageId, setSentAttachmentsByMessageId] = useState<
    Record<string, PlaygroundAttachment[]>
  >({});
  const sentAttachmentsByMessageIdRef = useRef<Record<string, PlaygroundAttachment[]>>({});
  const chatQuery = useQuery({
    queryKey: playgroundKeys.chat(selectedChatId),
    queryFn: () => getPlaygroundChat(selectedChatId),
    enabled: Boolean(selectedChatId),
  });

  const clearComposerState = useCallback(() => {
    pendingAttachmentsRef.current = [];
    sentAttachmentsByMessageIdRef.current = {};
    setPendingAttachments([]);
    setSentAttachmentsByMessageId({});
  }, []);

  const cacheChatList = useCallback(
    (response: PlaygroundChatListResponse) => {
      queryClient.setQueryData(playgroundKeys.chats, response);
    },
    [queryClient],
  );

  const cacheChatSession = useCallback(
    (response: PlaygroundChatSessionResponse) => {
      queryClient.setQueryData(playgroundKeys.chats, {
        chats: response.chats,
        active_chat_id: response.active_chat_id,
      });
      queryClient.setQueryData(playgroundKeys.chat(response.chat.id), { chat: response.chat });
    },
    [queryClient],
  );

  const createChatMutation = useMutation({
    mutationFn: () => createPlaygroundChat(selectedProviderId || null, selectedThinkingMode),
    onSuccess: (response) => {
      cacheChatSession(response);
      setSelectedChatId(response.chat.id);
      setSelectedProviderId(response.chat.provider_id ?? selectedProviderId);
      setSelectedThinkingMode(response.chat.thinking_mode);
      clearComposerState();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteChatMutation = useMutation({
    mutationFn: deletePlaygroundChat,
    onSuccess: (response) => {
      cacheChatList(response);
      const nextChatId = response.active_chat_id ?? response.chats[0]?.id ?? "";
      setSelectedChatId(nextChatId);
      clearComposerState();
      if (!nextChatId && !createChatMutation.isPending) createChatMutation.mutate();
    },
    onError: (error) => toast.error(error.message),
  });

  const renameChatMutation = useMutation({
    mutationFn: ({ chatId, title }: { chatId: string; title: string }) =>
      renamePlaygroundChat(chatId, title),
    onSuccess: (response) => {
      cacheChatSession(response);
    },
    onError: (error) => toast.error(error.message),
  });

  const updateChatSettingsMutation = useMutation({
    mutationFn: ({
      chatId,
      providerId,
      thinkingMode,
    }: {
      chatId: string;
      providerId: string;
      thinkingMode: VlmThinkingMode;
    }) => updatePlaygroundChatSettings(chatId, providerId, thinkingMode),
    onSuccess: (response) => {
      cacheChatSession(response);
      setSelectedProviderId(response.chat.provider_id ?? "");
      setSelectedThinkingMode(response.chat.thinking_mode);
    },
    onError: (error) => toast.error(error.message),
  });

  const savePromptMutation = useMutation({
    mutationFn: () => savePrompts(promptDraft),
    onSuccess: (promptsResponse) => {
      queryClient.setQueryData(promptsKey, promptsResponse);
      setPromptDraft(promptsResponse.prompt);
      toast.success("Prompt saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const renderPageMutation = useMutation({
    mutationFn: async () => {
      const selectedProject = projects.find((project) => project.id === selectedProjectId);
      if (!selectedProject) throw new Error("Select a project PDF first");
      const page = Number.parseInt(pageNumber, 10);
      if (!Number.isInteger(page) || page < 1 || page > selectedProject.page_count) {
        throw new Error("PDF page is outside the selected project range");
      }
      const renderedPage = await getRenderedPdfPage(selectedProject.id, page);
      return makePlaygroundAttachment(renderedPage, selectedProject.name);
    },
    onSuccess: (attachment) => {
      pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
      setPendingAttachments(pendingAttachmentsRef.current);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (promptsQuery.data) setPromptDraft(promptsQuery.data.prompt);
  }, [promptsQuery.data]);

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId("");
      return;
    }
    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!verifiedProviders.length) {
      setSelectedProviderId("");
      return;
    }
    if (!verifiedProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(verifiedProviders[0].id);
    }
  }, [verifiedProviders, selectedProviderId]);

  useEffect(() => {
    const chat = chatQuery.data?.chat;
    if (!chat) return;
    if (
      chat.provider_id &&
      verifiedProviders.some((provider) => provider.id === chat.provider_id)
    ) {
      setSelectedProviderId(chat.provider_id);
    }
    setSelectedThinkingMode(chat.thinking_mode);
  }, [chatQuery.data?.chat, verifiedProviders]);

  useEffect(() => {
    if (!chatListQuery.data || selectedChatId) return;
    if (chatListQuery.data.active_chat_id) {
      setSelectedChatId(chatListQuery.data.active_chat_id);
      return;
    }
    if (!chatListQuery.data.chats.length && !createChatMutation.isPending) {
      createChatMutation.mutate();
    }
  }, [chatListQuery.data, createChatMutation, selectedChatId]);

  useEffect(() => {
    if (!chatListQuery.data || !selectedChatId) return;
    if (chatListQuery.data.chats.some((chat) => chat.id === selectedChatId)) return;
    setSelectedChatId(chatListQuery.data.active_chat_id ?? chatListQuery.data.chats[0]?.id ?? "");
  }, [chatListQuery.data, selectedChatId]);

  useEffect(() => {
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    if (!selectedProject) {
      pageDefaultProjectIdRef.current = "";
      setPageNumber("1");
      return;
    }
    if (pageDefaultProjectIdRef.current !== selectedProject.id) {
      pageDefaultProjectIdRef.current = selectedProject.id;
      setPageNumber(getDefaultPlaygroundPage(selectedProject));
      return;
    }
    const page = Number.parseInt(pageNumber, 10);
    if (!Number.isInteger(page) || page < 1) {
      setPageNumber("1");
      return;
    }
    if (page > selectedProject.page_count) {
      setPageNumber(String(selectedProject.page_count));
    }
  }, [pageNumber, projects, selectedProjectId]);

  useEffect(() => {
    const chat = chatQuery.data?.chat;
    if (!chat) return;
    const nextAttachments = attachmentsByMessageIdFromChat(chat);
    sentAttachmentsByMessageIdRef.current = nextAttachments;
    setSentAttachmentsByMessageId(nextAttachments);
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
  }, [chatQuery.data]);

  const handleRemovePendingAttachment = useCallback((attachmentId: string) => {
    const nextAttachments = pendingAttachmentsRef.current.filter(
      (attachment) => attachment.id !== attachmentId,
    );
    pendingAttachmentsRef.current = nextAttachments;
    setPendingAttachments(nextAttachments);
  }, []);

  const handleTakePendingAttachments = useCallback((messageId: string) => {
    const attachments = pendingAttachmentsRef.current;
    if (!attachments.length) return [];
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    setSentAttachmentsByMessageId((current) => {
      const next = { ...current, [messageId]: attachments };
      sentAttachmentsByMessageIdRef.current = next;
      return next;
    });
    return attachments;
  }, []);

  const updateCurrentChatSettings = useCallback(
    (providerId: string, thinkingMode: VlmThinkingMode) => {
      setSelectedProviderId(providerId);
      setSelectedThinkingMode(thinkingMode);
      if (!selectedChatId || !providerId) return;
      updateChatSettingsMutation.mutate({ chatId: selectedChatId, providerId, thinkingMode });
    },
    [selectedChatId, updateChatSettingsMutation],
  );

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (chatId === selectedChatId) return;
      setSelectedChatId(chatId);
      clearComposerState();
      try {
        cacheChatList(await setActivePlaygroundChat(chatId));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to open chat");
      }
    },
    [cacheChatList, clearComposerState, selectedChatId],
  );

  const handleSendChat = useCallback(
    async function* (message: PlaygroundChatMessage, signal: AbortSignal) {
      if (!selectedProviderId) throw new Error("Select a verified VLM API first");
      if (!selectedChatId) throw new Error("Open a chat session first");
      let receivedFinalEvent = false;
      const warningSet = new Set<string>();
      const showWarning = (warning: string) => {
        if (!warning || warningSet.has(warning)) return;
        warningSet.add(warning);
        toast.warning(warning);
      };
      for await (const event of streamPlaygroundChatMessage(
        selectedChatId,
        selectedProviderId,
        selectedThinkingMode,
        message,
        signal,
      )) {
        if (event.type === "delta" || event.type === "thinking") {
          yield event.text;
          continue;
        }
        if (event.type === "warning") {
          showWarning(event.detail);
          continue;
        }
        receivedFinalEvent = true;
        event.response.warnings?.forEach(showWarning);
        cacheChatSession(event.response);
        const nextAttachments = attachmentsByMessageIdFromChat(event.response.chat);
        sentAttachmentsByMessageIdRef.current = nextAttachments;
        setSentAttachmentsByMessageId(nextAttachments);
      }
      if (!receivedFinalEvent && !signal.aborted) {
        throw new Error("Streaming response ended before the chat was saved");
      }
    },
    [cacheChatSession, selectedChatId, selectedProviderId, selectedThinkingMode],
  );

  const initialMessages = useMemo<ThreadMessageLike[]>(
    () => (chatQuery.data?.chat.messages ?? []).map(toThreadMessageLike),
    [chatQuery.data?.chat.messages],
  );

  return (
    <PlaygroundView
      key={selectedChatId || "pending-chat"}
      projects={projects}
      providers={verifiedProviders}
      chatSessions={chatListQuery.data?.chats ?? []}
      activeChatId={selectedChatId}
      initialMessages={initialMessages}
      prompt={promptDraft}
      selectedProjectId={selectedProjectId}
      selectedProviderId={selectedProviderId}
      selectedThinkingMode={selectedThinkingMode}
      pageNumber={pageNumber}
      pendingAttachments={pendingAttachments}
      sentAttachmentsByMessageId={sentAttachmentsByMessageId}
      isRenderingPage={renderPageMutation.isPending}
      isSavingPrompt={savePromptMutation.isPending}
      isCreatingChat={createChatMutation.isPending}
      onPromptChange={setPromptDraft}
      onSelectedProjectChange={setSelectedProjectId}
      onSelectedProviderChange={(providerId) =>
        updateCurrentChatSettings(providerId, selectedThinkingMode)
      }
      onSelectedThinkingModeChange={(thinkingMode) =>
        updateCurrentChatSettings(selectedProviderId, thinkingMode)
      }
      onPageNumberChange={setPageNumber}
      onInsertRenderedPage={() => renderPageMutation.mutate()}
      onRemovePendingAttachment={handleRemovePendingAttachment}
      onSavePrompt={() => savePromptMutation.mutate()}
      onRestoreDefaultPrompt={() => setPromptDraft(promptsQuery.data?.default ?? "")}
      onNewChat={() => createChatMutation.mutate()}
      onSelectChat={handleSelectChat}
      onDeleteChat={(chatId) => deleteChatMutation.mutate(chatId)}
      onRenameChat={(chatId, title) => renameChatMutation.mutate({ chatId, title })}
      onTakePendingAttachments={handleTakePendingAttachments}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => navigate("/tasks")}
      onOpenDocs={() => navigate("/docs")}
      onOpenSettings={() => navigate("/settings")}
      onSendChat={handleSendChat}
    />
  );
}

function toThreadMessageLike(message: PlaygroundChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at ? new Date(message.created_at) : undefined,
    status: message.role === "assistant" ? { type: "complete", reason: "stop" } : undefined,
  };
}

function attachmentsByMessageIdFromChat(
  chat: PlaygroundChatSession,
): Record<string, PlaygroundAttachment[]> {
  return Object.fromEntries(
    chat.messages
      .filter((message) => message.role === "user" && message.id && message.attachments?.length)
      .map((message) => [message.id as string, message.attachments ?? []]),
  );
}
