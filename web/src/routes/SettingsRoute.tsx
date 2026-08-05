import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { SettingsView } from "../components/SettingsView";
import { useThemePreference } from "../hooks/useThemePreference";
import { getSettings, saveSettings, settingsKey } from "../features/settings/api";
import type { SettingsDraft } from "../types";

export function SettingsRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { preference, setPreference } = useThemePreference();
  const settingsQuery = useQuery({ queryKey: settingsKey, queryFn: getSettings });
  const [draft, setDraft] = useState<SettingsDraft>({ baseUrl: "", model: "", apiKey: "" });

  useEffect(() => {
    if (settingsQuery.data) {
      setDraft({ baseUrl: settingsQuery.data.base_url, model: settingsQuery.data.model, apiKey: "" });
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKey, settings);
      setDraft({ baseUrl: settings.base_url, model: settings.model, apiKey: "" });
      toast.success("LLM settings saved");
    },
    onError: (error) => toast.error(error.message)
  });

  function back() {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== "/settings" ? from : "/");
  }

  return (
    <SettingsView
      settings={settingsQuery.data ?? null}
      settingsDraft={draft}
      themePreference={preference}
      onSettingsDraftChange={setDraft}
      onThemePreferenceChange={setPreference}
      onBack={back}
      onOpenHome={() => navigate("/")}
      onOpenTasks={() => navigate("/tasks")}
      onSave={() => saveMutation.mutate(draft)}
    />
  );
}
