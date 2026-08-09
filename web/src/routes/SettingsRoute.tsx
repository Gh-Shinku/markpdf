import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { SettingsView } from "../components/SettingsView";
import { useThemePreference } from "../hooks/useThemePreference";
import {
  getPrompts,
  getProviders,
  promptsKey,
  savePrompts,
  saveProviders,
  settingsKey,
  testProvider,
} from "../features/settings/api";
import type { VlmProvider, VlmProviderDraft } from "../types";

const emptySamplingDraft = (): VlmProviderDraft["sampling"] => ({
  temperature: "",
  top_p: "",
  max_tokens: "",
  presence_penalty: "",
  frequency_penalty: "",
  seed: "",
});

function providerToDraft(item: VlmProvider): VlmProviderDraft {
  const sampling = emptySamplingDraft();
  for (const key of Object.keys(sampling) as (keyof typeof sampling)[]) {
    const value = item.sampling?.[key];
    sampling[key] = value === null || value === undefined ? "" : String(value);
  }
  return {
    id: item.id,
    name: item.name,
    baseUrl: item.base_url,
    model: item.model,
    apiKey: "",
    sampling,
    thinkingMode: item.thinking_mode ?? "auto",
    extraBody: item.extra_body ? JSON.stringify(item.extra_body, null, 2) : "",
  };
}

export function SettingsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { preference, setPreference } = useThemePreference();
  const providersQuery = useQuery({ queryKey: settingsKey, queryFn: getProviders });
  const promptsQuery = useQuery({ queryKey: promptsKey, queryFn: getPrompts });
  const [drafts, setDrafts] = useState<VlmProviderDraft[]>([]);
  const [promptDraft, setPromptDraft] = useState<string>("");
  useEffect(() => {
    if (providersQuery.data) setDrafts(providersQuery.data.map(providerToDraft));
  }, [providersQuery.data]);
  useEffect(() => {
    if (promptsQuery.data) setPromptDraft(promptsQuery.data.prompt);
  }, [promptsQuery.data]);
  const saveMutation = useMutation({
    mutationFn: async () => {
      const providers = await saveProviders(drafts);
      const promptsResponse = await savePrompts(promptDraft);
      return { providers, promptsResponse };
    },
    onSuccess: ({ providers, promptsResponse }) => {
      queryClient.setQueryData(settingsKey, providers);
      queryClient.setQueryData(promptsKey, promptsResponse);
      setDrafts(providers.map(providerToDraft));
      setPromptDraft(promptsResponse.prompt);
      toast.success("Settings saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const saveProvidersMutation = useMutation({
    mutationFn: saveProviders,
    onSuccess: (providers) => {
      queryClient.setQueryData(settingsKey, providers);
      setDrafts(providers.map(providerToDraft));
    },
    onError: (error) => toast.error(error.message),
  });
  const testMutation = useMutation({
    mutationFn: testProvider,
    onSuccess: (provider) => {
      queryClient.setQueryData(settingsKey, (current: typeof providersQuery.data) =>
        current?.map((item) => (item.id === provider.id ? provider : item)),
      );
      toast[provider.verification_status === "verified" ? "success" : "error"](
        provider.verification_message,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const from = (location.state as { from?: string } | null)?.from;
  return (
    <SettingsView
      providers={providersQuery.data ?? []}
      drafts={drafts}
      prompt={promptDraft}
      defaultPrompt={promptsQuery.data?.default ?? ""}
      themePreference={preference}
      testingProviderId={testMutation.isPending ? testMutation.variables : null}
      onProvidersChange={setDrafts}
      onPromptChange={setPromptDraft}
      onThemePreferenceChange={setPreference}
      onBack={() => navigate(from && from !== "/settings" ? from : "/")}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => navigate("/tasks")}
      onOpenPlayground={() => navigate("/playground")}
      onOpenDocs={() => navigate("/docs")}
      onSave={() => saveMutation.mutate()}
      onProvidersSave={(nextDrafts) => saveProvidersMutation.mutate(nextDrafts)}
      onTest={(id) => testMutation.mutate(id)}
    />
  );
}
