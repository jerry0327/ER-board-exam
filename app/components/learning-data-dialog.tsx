"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookOpenCheck, Check, CircleAlert, RotateCcw, Trash2, X } from "lucide-react";
import type { ProgressResetType } from "../hooks/use-progress";
import type { ExplanationMode } from "../lib/explanation-mode";
import { explanationPacks, type ExplanationPackId } from "../lib/explanation-packs";
import type { Manifest, QuestionIndex } from "../lib/types";

type Props = {
  open: boolean;
  manifest: Manifest;
  questions: QuestionIndex[];
  syncStatus: "loading" | "synced" | "offline";
  explanationPack: ExplanationPackId;
  explanationMode: ExplanationMode;
  rawDraftEnabled: boolean;
  onExplanationPackChange: (packId: ExplanationPackId) => void;
  onExplanationModeChange: (mode: ExplanationMode) => void;
  onRawDraftEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
  onReset: (types: ProgressResetType[], questionIds?: string[]) => Promise<void>;
};

const resetChoices: Array<{ id: ProgressResetType; title: string; detail: string; icon: typeof RotateCcw }> = [
  { id: "attempts", title: "作答與錯題", detail: "答案、正確率、錯題與複習排程", icon: RotateCcw },
  { id: "reading", title: "題目閱讀狀態", detail: "詳解的已讀完與稍後再讀標記", icon: BookOpenCheck },
  { id: "bookmarks", title: "收藏", detail: "題目收藏標記", icon: Bookmark },
];

const explanationModes: Array<{ id: ExplanationMode; label: string; detail: string }> = [
  { id: "quick", label: "速讀", detail: "核心理由與選項判讀" },
  { id: "standard", label: "標準", detail: "加入解題路徑與常見陷阱" },
  { id: "full", label: "完整", detail: "顯示延伸內容與參考資料" },
];

const rawExplanationMode: { id: ExplanationMode; label: string; detail: string } = {
  id: "raw",
  label: "進階內容",
  detail: "檢視完整原稿",
};

export default function LearningDataDialog({ open, manifest, questions, syncStatus, explanationPack, explanationMode, rawDraftEnabled, onExplanationPackChange, onExplanationModeChange, onRawDraftEnabledChange, onClose, onReset }: Props) {
  const [scope, setScope] = useState("all");
  const [types, setTypes] = useState<ProgressResetType[]>(["reading"]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      dialog?.querySelector<HTMLElement>("input:checked, button:not(:disabled), select:not(:disabled)")?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      if (previous?.isConnected && previous !== document.body && previous !== document.documentElement) previous.focus();
      else document.querySelector<HTMLElement>(".brand")?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setConfirming(false);
        setNotice("");
        onClose();
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")]
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  const scopedQuestions = useMemo(
    () => scope === "all" ? questions : questions.filter((question) => question.exam === scope),
    [questions, scope],
  );
  const scopeLabel = scope === "all" ? "全部年度與卷別" : manifest.groups.find((group) => group.id === scope)?.label ?? scope;
  const allProgress = types.length === resetChoices.length;

  if (!open) return null;

  const close = () => {
    setConfirming(false);
    setNotice("");
    onClose();
  };

  const toggleType = (type: ProgressResetType) => {
    setConfirming(false);
    setNotice("");
    setTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  };

  const submit = async () => {
    if (!types.length) { setNotice("請至少選擇一種紀錄。"); return; }
    if (!confirming) { setConfirming(true); setNotice(""); return; }
    setBusy(true);
    setNotice("");
    try {
      await onReset(types, scope === "all" ? undefined : scopedQuestions.map((question) => question.id));
      setConfirming(false);
      setNotice(`${scopeLabel}的選取紀錄已清除。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "目前無法清除紀錄");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="learning-data-backdrop" onClick={() => { if (!busy) close(); }}>
      <section ref={dialogRef} tabIndex={-1} className="learning-data-dialog overlay-panel" role="dialog" aria-modal="true" aria-labelledby="learning-data-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>閱讀偏好與學習紀錄</span><h2 id="learning-data-title">設定</h2></div>
          <button aria-label="關閉設定" disabled={busy} onClick={close}><X /></button>
        </header>

        <section className="explanation-preferences" aria-labelledby="explanation-preferences-title">
          <div className="explanation-preferences-heading">
            <h3 id="explanation-preferences-title">詳解閱讀</h3>
            <p>詳解版本決定使用哪一套內容；閱讀程度決定顯示多少細節。選擇後會立即套用。</p>
          </div>
          <fieldset className="explanation-preference-group">
            <legend>詳解版本</legend>
            <div className="explanation-pack-options">
              {explanationPacks.map((pack) => <label key={pack.id} className={explanationPack === pack.id ? "selected" : ""}>
                <input type="radio" name="settings-explanation-pack" value={pack.id} checked={explanationPack === pack.id} onChange={() => onExplanationPackChange(pack.id)} />
                <span><strong>{pack.label}</strong><small>{pack.detail}</small></span>
              </label>)}
            </div>
          </fieldset>
          <fieldset className="explanation-preference-group">
            <legend>閱讀程度</legend>
            <div className="explanation-mode-options">
              {(rawDraftEnabled ? [...explanationModes, rawExplanationMode] : explanationModes).map((mode) => <label key={mode.id} className={explanationMode === mode.id ? "selected" : ""}>
                <input type="radio" name="settings-explanation-mode" value={mode.id} checked={explanationMode === mode.id} onChange={() => onExplanationModeChange(mode.id)} />
                <span><strong>{mode.label}</strong><small>{mode.detail}</small></span>
              </label>)}
            </div>
          </fieldset>
        </section>

        <section className="raw-draft-preference" aria-labelledby="raw-draft-preference-title">
          <div>
            <h3 id="raw-draft-preference-title">進階閱讀</h3>
            <p>需要查看完整內容結構時再開啟。</p>
          </div>
          <label className={rawDraftEnabled ? "selected" : ""}>
            <input type="checkbox" checked={rawDraftEnabled} onChange={(event) => onRawDraftEnabledChange(event.target.checked)} />
            <span><strong>顯示進階內容</strong><small>在詳解與學習指引的閱讀程度中加入「進階內容」。</small></span>
          </label>
        </section>

        {syncStatus === "loading" && <div className={`learning-sync-state ${syncStatus}`}>
          <CircleAlert size={17} />
          <span>正在準備學習紀錄</span>
        </div>}

        <div className="learning-data-section">
          <label className="learning-scope-label">清除範圍
            <select className="field-control" value={scope} onChange={(event) => { setScope(event.target.value); setConfirming(false); setNotice(""); }}>
              <option value="all">全部年度與卷別</option>
              {manifest.groups.map((group) => <option key={group.id} value={group.id}>{group.label}（{group.count} 題）</option>)}
            </select>
          </label>
        </div>

        <fieldset className="learning-reset-choices">
          <legend className="sr-only">選擇要清除的紀錄</legend>
          <div className="learning-reset-heading"><span>選擇要清除的紀錄</span><button className="learning-select-all" type="button" onClick={() => { setTypes(allProgress ? [] : resetChoices.map((item) => item.id)); setConfirming(false); setNotice(""); }}>{allProgress ? "取消全選" : "全部選取"}</button></div>
          {resetChoices.map(({ id, title, detail, icon: Icon }) => {
            const selected = types.includes(id);
            return <button key={id} type="button" aria-pressed={selected} className={selected ? "selected" : ""} onClick={() => toggleType(id)}><Icon /><span><strong>{title}</strong><small>{detail}</small></span>{selected && <Check className="choice-check" />}</button>;
          })}
        </fieldset>

        <div className="learning-reset-summary">
          <strong>{scopeLabel}・{scopedQuestions.length.toLocaleString("zh-TW")} 題</strong>
          <span>{allProgress ? "將重置全部學習進度。" : "只會清除上方選取的紀錄。"} 筆記與畫線會保留。</span>
        </div>

        {notice && <p className="learning-data-notice" role="status">{notice}</p>}
        {confirming && <div className="learning-confirmation"><CircleAlert /><span><strong>再次確認</strong>清除後無法復原，所選紀錄會一併移除。{types.includes("attempts") ? " 若未完成題組包含這個範圍，也會一併捨棄。" : ""}</span></div>}

        <div className="learning-data-actions">
          <button className="quiet-button" disabled={busy} onClick={close}>取消</button>
          <button className={confirming ? "danger-button" : "primary-button"} disabled={busy || !types.length || syncStatus === "loading"} onClick={() => void submit()}>{busy ? "正在清除…" : confirming ? <><Trash2 />確認清除</> : "清除選取紀錄"}</button>
        </div>
      </section>
    </div>
  );
}
