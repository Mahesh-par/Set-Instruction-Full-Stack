import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ClipboardList,
  Database,
  Pencil,
  Loader2,
  RefreshCw,
  Save
} from "lucide-react";

type DashboardView = "instructions" | "notion";

type NotionRow = {
  pageId: string;
  name: number | string | null;
  clientName: string | null;
  url: string;
};

type NotionResponse = {
  success: boolean;
  message: string;
  count: number;
  source?: "cache" | "notion";
  fetchedAt?: string | null;
  data: NotionRow[];
};

type InstructionResponse = {
  success: boolean;
  message: string;
  data: {
    instruction: string;
    updatedAt: string | null;
  };
};

type StoredNotionRows = {
  count: number;
  fetchedAt: string | null;
  rows: NotionRow[];
};

const DASHBOARD_VIEW_KEY = "set-instructions-dashboard-view";
const NOTION_ROWS_CACHE_KEY = "set-instructions-notion-rows-v2";
const DEFAULT_API_BASE_URL = "http://localhost:5001";

const getApiUrl = (path: string) => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const baseUrl = configuredBaseUrl
    ? configuredBaseUrl.replace(/\/$/, "")
    : DEFAULT_API_BASE_URL;

  return `${baseUrl}${path}`;
};

const parseApiResponse = async <T,>(
  response: Response,
  fallbackMessage: string
): Promise<Partial<T>> => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as Partial<T>;
  }

  const responseText = (await response.text()).trim();
  const preview = responseText.slice(0, 80);

  if (
    preview.toLowerCase().startsWith("<!doctype") ||
    preview.toLowerCase().startsWith("<html")
  ) {
    throw new Error(
      `API returned an HTML page. Make sure the backend is running at ${DEFAULT_API_BASE_URL}.`
    );
  }

  throw new Error(preview || fallbackMessage);
};

const formatCell = (value: string | number | null) => {
  if (value === null || value === "") {
    return "-";
  }

  return value;
};

const readStoredNotionRows = (): StoredNotionRows | null => {
  const storedValue = localStorage.getItem(NOTION_ROWS_CACHE_KEY);

  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as Partial<StoredNotionRows>;

    if (!Array.isArray(parsedValue.rows)) {
      return null;
    }

    return {
      count:
        typeof parsedValue.count === "number"
          ? parsedValue.count
          : parsedValue.rows.length,
      fetchedAt: parsedValue.fetchedAt ?? null,
      rows: parsedValue.rows
    };
  } catch {
    localStorage.removeItem(NOTION_ROWS_CACHE_KEY);
    return null;
  }
};

const saveStoredNotionRows = (
  rows: NotionRow[],
  count: number,
  fetchedAt: string | null
) => {
  localStorage.setItem(
    NOTION_ROWS_CACHE_KEY,
    JSON.stringify({
      count,
      fetchedAt,
      rows
    })
  );
};

function App() {
  const storedRows = readStoredNotionRows();
  const [activeView, setActiveView] = useState<DashboardView>(() => {
    return localStorage.getItem(DASHBOARD_VIEW_KEY) === "notion"
      ? "notion"
      : "instructions";
  });
  const [rows, setRows] = useState<NotionRow[]>(storedRows?.rows ?? []);
  const [rowCount, setRowCount] = useState(storedRows?.count ?? 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(Boolean(storedRows));
  const [instruction, setInstruction] = useState("");
  const [savedInstruction, setSavedInstruction] = useState("");
  const [isInstructionEditing, setIsInstructionEditing] = useState(true);
  const [isInstructionLoading, setIsInstructionLoading] = useState(false);
  const [isInstructionSaving, setIsInstructionSaving] = useState(false);
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [instructionMessage, setInstructionMessage] = useState<string | null>(
    null
  );

  const selectView = (view: DashboardView) => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, view);
    setActiveView(view);
  };

  const fetchNotionRows = useCallback(async (forceRefresh = false) => {
    localStorage.setItem(DASHBOARD_VIEW_KEY, "notion");
    setActiveView("notion");

    if (!forceRefresh) {
      const storedNotionRows = readStoredNotionRows();

      if (storedNotionRows) {
        setRows(storedNotionRows.rows);
        setRowCount(storedNotionRows.count);
        setHasFetched(true);
        setError(null);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        getApiUrl(`/api/notion/urls${forceRefresh ? "?refresh=true" : ""}`)
      );
      const payload = await parseApiResponse<NotionResponse>(
        response,
        "Failed to fetch Notion rows."
      );

      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to fetch Notion rows.");
      }

      const nextRows = Array.isArray(payload.data) ? payload.data : [];
      const nextCount =
        typeof payload.count === "number" ? payload.count : nextRows.length;

      setRows(nextRows);
      setRowCount(nextCount);
      setHasFetched(true);
      saveStoredNotionRows(nextRows, nextCount, payload.fetchedAt ?? null);
    } catch (fetchError) {
      setRows([]);
      setRowCount(0);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch Notion rows."
      );
      setHasFetched(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSavedInstruction = useCallback(async () => {
    setIsInstructionLoading(true);
    setInstructionError(null);

    try {
      const response = await fetch(getApiUrl("/api/claude/instructions"));
      const payload = await parseApiResponse<InstructionResponse>(
        response,
        "Failed to fetch instruction."
      );

      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to fetch instruction.");
      }

      const nextInstruction = payload.data?.instruction ?? "";

      setInstruction(nextInstruction);
      setSavedInstruction(nextInstruction);
      setIsInstructionEditing(!nextInstruction);
    } catch (fetchError) {
      setInstructionError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to fetch instruction."
      );
    } finally {
      setIsInstructionLoading(false);
    }
  }, []);

  const saveInstructionText = async () => {
    const trimmedInstruction = instruction.trim();

    if (!trimmedInstruction) {
      setInstructionError("Instruction is required.");
      return;
    }

    setIsInstructionSaving(true);
    setInstructionError(null);
    setInstructionMessage(null);

    try {
      const response = await fetch(getApiUrl("/api/claude/instructions"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          instruction: trimmedInstruction
        })
      });
      const payload = await parseApiResponse<InstructionResponse>(
        response,
        "Failed to save instruction."
      );

      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to save instruction.");
      }

      const nextInstruction = payload.data?.instruction ?? trimmedInstruction;

      setInstruction(nextInstruction);
      setSavedInstruction(nextInstruction);
      setIsInstructionEditing(false);
      setInstructionMessage("Instruction saved successfully.");
    } catch (saveError) {
      setInstructionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save instruction."
      );
    } finally {
      setIsInstructionSaving(false);
    }
  };

  useEffect(() => {
    if (activeView === "notion" && !hasFetched && !isLoading) {
      void fetchNotionRows();
    }
  }, [activeView, fetchNotionRows, hasFetched, isLoading]);

  useEffect(() => {
    if (activeView === "instructions" && !savedInstruction && !instruction) {
      void fetchSavedInstruction();
    }
  }, [activeView, fetchSavedInstruction, instruction, savedInstruction]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-teal-700">Dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
              Set Instructions
            </h1>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => selectView("instructions")}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition ${
                activeView === "instructions"
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
              }`}
            >
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Set Instruction
            </button>
            <button
              type="button"
              onClick={() => fetchNotionRows()}
              disabled={isLoading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-4 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Database className="h-4 w-4" aria-hidden="true" />
              )}
              Fetch Notion Rows
            </button>
          </div>
        </header>

        <section className="flex-1 py-6">
          {activeView === "instructions" ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-800">
                      <ClipboardList className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-950">
                        Set Instruction
                      </h2>
                      <p className="mt-1 text-sm text-zinc-600">
                        Save the instruction text used by this system.
                      </p>
                    </div>
                  </div>

                  {savedInstruction && !isInstructionEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsInstructionEditing(true);
                        setInstructionMessage(null);
                        setInstructionError(null);
                      }}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Edit Instruction
                    </button>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <textarea
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    disabled={
                      isInstructionLoading ||
                      isInstructionSaving ||
                      !isInstructionEditing
                    }
                    rows={8}
                    placeholder="Enter instruction here..."
                    className="min-h-48 w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-100 disabled:bg-zinc-50 disabled:text-zinc-600"
                  />

                  {instructionError ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {instructionError}
                    </div>
                  ) : null}

                  {instructionMessage ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      {instructionMessage}
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveInstructionText}
                      disabled={
                        isInstructionLoading ||
                        isInstructionSaving ||
                        !isInstructionEditing
                      }
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-teal-700 bg-teal-700 px-4 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isInstructionSaving ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Save className="h-4 w-4" aria-hidden="true" />
                      )}
                      Save Instruction
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">
                    Notion Rows
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {hasFetched
                      ? `${rowCount} row${rowCount === 1 ? "" : "s"} fetched`
                      : "No rows fetched yet"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchNotionRows(true)}
                  disabled={isLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  Refresh
                </button>
              </div>

              {error ? (
                <div className="m-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-sm">
                  <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase text-zinc-600">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3">Name</th>
                      <th className="whitespace-nowrap px-4 py-3">
                        Client Name
                      </th>
                      <th className="whitespace-nowrap px-4 py-3">Project URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {isLoading ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-10 text-center text-zinc-500"
                        >
                          Loading Notion rows...
                        </td>
                      </tr>
                    ) : rows.length > 0 ? (
                      rows.map((row) => (
                        <tr key={row.pageId} className="hover:bg-zinc-50">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                            {formatCell(row.name)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                            {formatCell(row.clientName)}
                          </td>
                          <td className="max-w-2xl px-4 py-3">
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline"
                            >
                              <span className="truncate">{row.url}</span>
                              <ArrowUpRight
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden="true"
                              />
                            </a>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-10 text-center text-zinc-500"
                        >
                          {hasFetched
                            ? "No Notion rows found."
                            : "Click Fetch Notion Rows to load data."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
