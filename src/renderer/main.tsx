import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { CHAT_PET_ID } from "../shared/types";
import type { AppSettings, AppSnapshot, PetProfile, PetState } from "../shared/types";
import { calculatePetWindowLayout } from "./petLayout";
import "./styles.css";

function useSnapshot(): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    window.vibePet.getSnapshot().then(setSnapshot);
    return window.vibePet.subscribeSnapshot(setSnapshot);
  }, []);

  return snapshot;
}

function App(): ReactElement {
  const search = new URLSearchParams(window.location.search);
  const view = search.get("view") ?? "pet";
  const petId = search.get("petId") ?? "";
  const snapshot = useSnapshot();

  useEffect(() => {
    document.documentElement.dataset.view = view;
    document.body.dataset.view = view;
    return () => {
      delete document.documentElement.dataset.view;
      delete document.body.dataset.view;
    };
  }, [view]);

  if (!snapshot) {
    return <div className="screen screen-loading">Loading...</div>;
  }

  if (view === "history") {
    return <HistoryView snapshot={snapshot} initialPetId={petId} />;
  }

  if (view === "settings") {
    return <SettingsView snapshot={snapshot} />;
  }

  const pet = snapshot.pets.find((item) => item.id === petId) ?? snapshot.pets[0] ?? null;
  return <PetView pet={pet} settings={snapshot.settings} />;
}

function PetView({ pet, settings }: { pet: PetProfile | null; settings: AppSettings }): ReactElement {
  const nameRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [naturalSize, setNaturalSize] = useState({ width: 96, height: 96 });
  const [artSize, setArtSize] = useState({ width: 96, height: 96 });
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [submittingPrompt, setSubmittingPrompt] = useState(false);
  const [lastAssistantMessage, setLastAssistantMessage] = useState("");
  const [promptError, setPromptError] = useState("");
  const isChatPet = pet?.id === CHAT_PET_ID;
  const petStyle = {
    "--pet-font-size": `${settings.petWindow.fontSize}px`
  } as CSSProperties;

  const gifPath = pet?.gifMap[pet.state] ?? "";

  useEffect(() => {
    setNaturalSize({ width: 96, height: 96 });
  }, [gifPath]);

  useEffect(() => {
    return () => {
      window.vibePet.endPetWindowDrag();
    };
  }, []);

  useEffect(() => {
    if (promptOpen) {
      promptPanelRef.current?.querySelector("input")?.focus();
    }
  }, [promptOpen]);

  useLayoutEffect(() => {
    if (!pet || !nameRef.current || !captionRef.current) {
      return;
    }

    const nameRect = nameRef.current.getBoundingClientRect();
    const captionRect = captionRef.current.getBoundingClientRect();
    const promptRect = promptPanelRef.current?.getBoundingClientRect();
    const promptWidth = promptPanelRef.current ? Math.max(promptRect?.width ?? 0, promptPanelRef.current.scrollWidth) : 0;
    const promptHeight = promptPanelRef.current ? Math.max(promptRect?.height ?? 0, promptPanelRef.current.scrollHeight) + 4 : 0;
    const layout = calculatePetWindowLayout({
      nameWidth: Math.max(nameRect.width, nameRef.current.scrollWidth, promptWidth),
      nameHeight: Math.max(nameRect.height, nameRef.current.scrollHeight),
      captionWidth: Math.max(captionRect.width, captionRef.current.scrollWidth, promptWidth),
      captionHeight: Math.max(captionRect.height, captionRef.current.scrollHeight) + promptHeight,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      fontSize: settings.petWindow.fontSize
    });

    setArtSize((current) =>
      current.width === layout.art.width && current.height === layout.art.height
        ? current
        : {
            width: layout.art.width,
            height: layout.art.height
          }
    );
    window.vibePet.resizePetWindow(pet.id, layout.window);
  }, [pet, settings.petWindow.fontSize, naturalSize, promptOpen, submittingPrompt, lastAssistantMessage, promptError]);

  if (!pet) {
    return <div className="screen screen-pet" style={petStyle} />;
  }

  return (
    <div
      className={`screen screen-pet state-${pet.state}${promptOpen ? " prompt-open" : ""}`}
      style={petStyle}
      onPointerDown={handlePetPointerDown}
      onPointerMove={handlePetPointerMove}
      onPointerUp={handlePetPointerEnd}
      onPointerCancel={handlePetPointerEnd}
      onContextMenu={(event) => {
        event.preventDefault();
        window.vibePet.openPetMenu(pet.id);
      }}
    >
      <div className="pet-shell">
        <div ref={nameRef} className="pet-name">{pet.name}</div>
        <div className="pet-stage" style={{ width: artSize.width, height: artSize.height }}>
          {gifPath ? (
            <img
              className="pet-gif"
              src={toGifSrc(gifPath)}
              alt={pet.name}
              onLoad={(event) =>
                setNaturalSize({
                  width: event.currentTarget.naturalWidth || 96,
                  height: event.currentTarget.naturalHeight || 96
                })
              }
            />
          ) : (
            <FallbackPet state={pet.state} />
          )}
        </div>
        <div ref={captionRef} className="pet-caption">{labelForState(pet.state)}</div>
        {isChatPet && promptOpen ? (
          <div ref={promptPanelRef} className="pet-prompt-panel" onPointerDown={(event) => event.stopPropagation()}>
            <form className="pet-prompt-form" onSubmit={handlePromptSubmit}>
              <input
                value={promptText}
                disabled={submittingPrompt}
                placeholder="输入给 Codex..."
                onChange={(event) => {
                  setPromptText(event.currentTarget.value);
                  setPromptError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setPromptOpen(false);
                  }
                }}
              />
            </form>
            {submittingPrompt || promptError || lastAssistantMessage ? (
              <div className={promptError ? "pet-prompt-reply error" : "pet-prompt-reply"}>
                {submittingPrompt ? (
                  "Codex 正在思考..."
                ) : (
                  <ReactMarkdown>{promptError || lastAssistantMessage}</ReactMarkdown>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  function handlePetPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest(".pet-prompt-panel")) {
      return;
    }

    event.preventDefault();
    draggingRef.current = true;
    movedRef.current = false;
    dragStartRef.current = { x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.vibePet.startPetWindowDrag({ x: event.screenX, y: event.screenY });
  }

  function handlePetPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) {
      return;
    }

    const start = dragStartRef.current;
    if (start && Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4) {
      movedRef.current = true;
    }
    window.vibePet.dragPetWindow({ x: event.screenX, y: event.screenY });
  }

  function handlePetPointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    const wasClick = !movedRef.current;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.vibePet.endPetWindowDrag();
    if (wasClick && isChatPet) {
      setPromptOpen((current) => !current);
    }
  }

  async function handlePromptSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const prompt = promptText.trim();
    if (!prompt || submittingPrompt) {
      return;
    }

    setSubmittingPrompt(true);
    setPromptError("");
    setLastAssistantMessage("Codex 正在处理你的请求...");
    const result = await window.vibePet.submitPrompt(prompt);
    setSubmittingPrompt(false);
    if (result.ok) {
      setPromptText("");
      setLastAssistantMessage(result.output ?? "Codex 已完成。");
    } else {
      setPromptError(result.error ?? "Prompt submit failed");
      console.warn(result.error ?? "Prompt submit failed");
    }
  }
}

function FallbackPet({ state }: { state: PetState }): ReactElement {
  return (
    <div className={`fallback-pet fallback-${state}`}>
      <div className="fallback-face">
        <span />
        <span />
      </div>
    </div>
  );
}

function HistoryView({ snapshot, initialPetId }: { snapshot: AppSnapshot; initialPetId: string }): ReactElement {
  const [selectedPetId, setSelectedPetId] = useState(initialPetId || snapshot.pets[0]?.id || "");

  useEffect(() => {
    if (!snapshot.pets.some((pet) => pet.id === selectedPetId)) {
      setSelectedPetId(snapshot.pets[0]?.id ?? "");
    }
  }, [selectedPetId, snapshot.pets]);

  const items = useMemo(
    () => snapshot.history.filter((item) => !selectedPetId || item.petId === selectedPetId).slice(0, 50),
    [selectedPetId, snapshot.history]
  );

  return (
    <div className="screen screen-panel">
      <header className="panel-header">
        <div>
          <h1>任务历史</h1>
          <p>按宠物查看思考、执行和等待确认摘要。</p>
        </div>
        <button className="ghost-button" onClick={() => window.vibePet.openSettings()}>
          设置
        </button>
      </header>
      <div className="pet-tabs">
        {snapshot.pets.map((pet) => (
          <button
            key={pet.id}
            className={pet.id === selectedPetId ? "pet-tab active" : "pet-tab"}
            onClick={() => setSelectedPetId(pet.id)}
          >
            {pet.name}
          </button>
        ))}
      </div>
      <section className="history-list">
        {items.map((item) => (
          <article key={item.id} className="history-item">
            <div className="history-kind">{labelForState(item.kind)}</div>
            <div className="history-summary">{item.summary}</div>
            <time className="history-time">{formatTime(item.createdAt)}</time>
          </article>
        ))}
      </section>
    </div>
  );
}

function SettingsView({ snapshot }: { snapshot: AppSnapshot }): ReactElement {
  async function updatePetFontSize(value: string): Promise<void> {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    await window.vibePet.updateSettings({
      petWindow: {
        ...snapshot.settings.petWindow,
        fontSize: parsed
      }
    });
  }

  async function updateDefaultGifGroup(groupId: string): Promise<void> {
    await window.vibePet.updateSettings({
      defaultGifGroupId: groupId
    });
  }

  return (
    <div className="screen screen-panel">
      <header className="panel-header">
        <div>
          <h1>VibePet 设置</h1>
          <p>管理宠物名称、GIF 组和 hooks 安装状态。</p>
        </div>
      </header>
      <section className="status-grid">
        <div className="status-card">
          <strong>Codex Hooks</strong>
          <span>{snapshot.hookStatus.codexInstalled ? "已安装" : "未安装"}</span>
        </div>
        <div className="status-card">
          <strong>Claude Hooks</strong>
          <span>{snapshot.hookStatus.claudeInstalled ? "已安装" : "未安装"}</span>
        </div>
        <button className="action-button" onClick={() => window.vibePet.installHooks()}>
          安装 Hooks
        </button>
        <button className="ghost-button" onClick={() => window.vibePet.uninstallHooks()}>
          卸载 Hooks
        </button>
      </section>
      <section className="settings-section">
        <h2>Pet 窗口</h2>
        <div className="window-settings-grid">
          <label className="field">
            <span>文字大小</span>
            <input
              type="number"
              min={10}
              max={24}
              step={1}
              defaultValue={snapshot.settings.petWindow.fontSize}
              onBlur={(event) => updatePetFontSize(event.currentTarget.value)}
            />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h2>GIF 组</h2>
        <label className="field">
          <span>新宠物默认 GIF 组</span>
          <select value={snapshot.settings.defaultGifGroupId} onChange={(event) => updateDefaultGifGroup(event.currentTarget.value)}>
            {snapshot.gifGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="settings-list">
        {snapshot.pets.map((pet) => (
          <article key={pet.id} className="pet-card">
            <label className="field">
              <span>宠物名称</span>
              <input
                defaultValue={pet.name}
                onBlur={(event) => window.vibePet.updatePet(pet.id, { name: event.currentTarget.value })}
              />
            </label>
            <label className="field">
              <span>当前 GIF 组</span>
              <select value={pet.gifGroupId} onChange={(event) => window.vibePet.updatePet(pet.id, { gifGroupId: event.currentTarget.value })}>
                {snapshot.gifGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          </article>
        ))}
      </section>
    </div>
  );
}

function labelForState(state: PetState): string {
  switch (state) {
    case "working":
      return "任务中";
    case "waiting":
      return "待人工确认";
    case "completed":
      return "已完成";
    default:
      return "空闲中";
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false
  });
}

function toGifSrc(value: string): string {
  if (/^(https?:|data:|blob:)/i.test(value) || value.startsWith("/")) {
    return value;
  }

  return `/api/local-gif?path=${encodeURIComponent(value)}`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
