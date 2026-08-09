import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { PlaygroundView } from "../components/PlaygroundView";
import { projectKeys, listProjects } from "../features/projects/api";
import {
  getRenderedPdfPage,
  makePlaygroundAttachment,
  sendPlaygroundChat,
  type PlaygroundAttachment,
  type PlaygroundChatMessage,
} from "../features/playground/api";
import {
  getPrompts,
  getProviders,
  promptsKey,
  savePrompts,
  settingsKey,
} from "../features/settings/api";

export function PlaygroundRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: projectKeys.all, queryFn: listProjects });
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const promptsQuery = useQuery({ queryKey: promptsKey, queryFn: getPrompts });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const verifiedProviders = useMemo(
    () =>
      (providersQuery.data ?? []).filter((provider) => provider.verification_status === "verified"),
    [providersQuery.data],
  );
  const [promptDraft, setPromptDraft] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [pendingAttachments, setPendingAttachments] = useState<PlaygroundAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PlaygroundAttachment[]>([]);
  const [sentAttachmentsByMessageId, setSentAttachmentsByMessageId] = useState<
    Record<string, PlaygroundAttachment[]>
  >({});
  const sentAttachmentsByMessageIdRef = useRef<Record<string, PlaygroundAttachment[]>>({});
  const [chatKey, setChatKey] = useState(0);

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
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    if (!selectedProject) return;
    const page = Number.parseInt(pageNumber, 10);
    if (!Number.isInteger(page) || page < 1) {
      setPageNumber("1");
      return;
    }
    if (page > selectedProject.page_count) {
      setPageNumber(String(selectedProject.page_count));
    }
  }, [pageNumber, projects, selectedProjectId]);

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

  const handleNewChat = useCallback(() => {
    pendingAttachmentsRef.current = [];
    sentAttachmentsByMessageIdRef.current = {};
    setPendingAttachments([]);
    setSentAttachmentsByMessageId({});
    setChatKey((value) => value + 1);
  }, []);

  const handleSendChat = useCallback(
    async (messages: PlaygroundChatMessage[]) => {
      if (!selectedProviderId) throw new Error("Select a verified VLM API first");
      const response = await sendPlaygroundChat(selectedProviderId, messages);
      return response.message.content;
    },
    [selectedProviderId],
  );

  return (
    <PlaygroundView
      key={chatKey}
      projects={projects}
      providers={verifiedProviders}
      prompt={promptDraft}
      selectedProjectId={selectedProjectId}
      selectedProviderId={selectedProviderId}
      pageNumber={pageNumber}
      pendingAttachments={pendingAttachments}
      sentAttachmentsByMessageId={sentAttachmentsByMessageId}
      isRenderingPage={renderPageMutation.isPending}
      isSavingPrompt={savePromptMutation.isPending}
      onPromptChange={setPromptDraft}
      onSelectedProjectChange={setSelectedProjectId}
      onSelectedProviderChange={setSelectedProviderId}
      onPageNumberChange={setPageNumber}
      onInsertRenderedPage={() => renderPageMutation.mutate()}
      onRemovePendingAttachment={handleRemovePendingAttachment}
      onSavePrompt={() => savePromptMutation.mutate()}
      onRestoreDefaultPrompt={() => setPromptDraft(promptsQuery.data?.default ?? "")}
      onNewChat={handleNewChat}
      onTakePendingAttachments={handleTakePendingAttachments}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => navigate("/tasks")}
      onOpenDocs={() => navigate("/docs")}
      onOpenSettings={() => navigate("/settings")}
      onSendChat={handleSendChat}
    />
  );
}
