"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Eye, Footprints, Maximize2, Pause, Play, RotateCcw, Trees, Wind } from "lucide-react";

type RestMode = "eyes" | "nature" | "breathe" | "move";

const REST_MODES: { id: RestMode; title: string; caption: string; seconds: number; icon: typeof Eye }[] = [
  { id: "eyes", title: "遠眺／閉眼", caption: "20 秒真正離開螢幕", seconds: 20, icon: Eye },
  { id: "nature", title: "自然凝視", caption: "低刺激的靜態景色", seconds: 180, icon: Trees },
  { id: "breathe", title: "呼吸重整", caption: "5 秒吸、5 秒吐", seconds: 90, icon: Wind },
  { id: "move", title: "離桌恢復", caption: "起身走動與伸展", seconds: 300, icon: Footprints },
];

const PRESETS: Record<RestMode, number[]> = {
  eyes: [20],
  nature: [120, 300, 600],
  breathe: [60, 180, 300],
  move: [300, 600, 900],
};

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分鐘`;
}

export default function RestView() {
  const [mode, setMode] = useState<RestMode>("nature");
  const [duration, setDuration] = useState(180);
  const [remaining, setRemaining] = useState(180);
  const [running, setRunning] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(8);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const timer = window.setTimeout(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, running]);

  const elapsed = duration - remaining;
  const progress = duration ? elapsed / duration * 100 : 0;
  const breathingIn = elapsed % 10 < 5;
  const prompt = useMemo(() => {
    if (remaining === 0) return mode === "move" ? "慢慢坐回來，再開始下一段複習。" : "這一段完成了，準備好再回到題目。";
    if (mode === "eyes") return "望向約 6 公尺外，或輕閉雙眼；這 20 秒不用看倒數。";
    if (mode === "nature") return "讓視線停在一個地方即可，不必追著任何東西看。";
    if (mode === "breathe") return `${breathingIn ? "吸氣" : "吐氣"} 5 秒；不用吸到最深，舒服就好。`;
    const step = Math.floor(elapsed / Math.max(1, duration / 3));
    return step === 0 ? "先離開座位，走幾步或喝水。" : step === 1 ? "放鬆肩膀與手腕，動作保持輕柔。" : "看向遠處，讓注意力暫時離開題目。";
  }, [breathingIn, duration, elapsed, mode, remaining]);

  const chooseMode = (nextMode: RestMode) => {
    const nextDuration = REST_MODES.find((item) => item.id === nextMode)?.seconds ?? 180;
    setMode(nextMode);
    setDuration(nextDuration);
    setRemaining(nextDuration);
    setRunning(false);
  };

  const chooseDuration = (seconds: number) => {
    setDuration(seconds);
    setRemaining(seconds);
    setRunning(false);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stageRef.current?.requestFullscreen) await stageRef.current.requestFullscreen();
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  return (
    <main className="workspace-page rest-page">
      <header className="page-intro compact-intro">
        <p className="eyebrow"><span />休息站</p>
        <h1>選擇現在需要的恢復方式</h1>
      </header>

      <section className="rest-activity-grid" aria-label="選擇休息方式">
        {REST_MODES.map(({ id, title, caption, icon: Icon }) => (
          <button key={id} className={mode === id ? "active" : ""} aria-pressed={mode === id} onClick={() => chooseMode(id)}>
            <Icon /><span><strong>{title}</strong><small>{caption}</small></span>
          </button>
        ))}
      </section>

      <section
        ref={stageRef}
        className={`rest-stage rest-${mode} ${running ? "running" : ""} ${motionEnabled ? "motion-on" : ""}`}
        style={{ "--rest-progress": `${progress}%` } as CSSProperties}
      >
        {mode === "nature" && (
          <div className="nature-scene" aria-hidden="true" />
        )}

        <div className="rest-stage-content">
          {mode === "eyes" && <Eye className="rest-focus-icon" aria-hidden="true" />}
          {mode === "breathe" && <div className={`breathing-guide ${breathingIn ? "inhale" : "exhale"}`} aria-hidden="true"><i /></div>}
          {mode === "move" && <Footprints className="rest-focus-icon" aria-hidden="true" />}
          <p aria-live="polite">{prompt}</p>
          <div className={`rest-time ${mode === "eyes" && running ? "visually-quiet" : ""}`}>
            <strong>{minutes}:{seconds}</strong>
            <span>{remaining === 0 ? "完成" : running ? "進行中" : "尚未開始"}</span>
          </div>
        </div>

        <div className="rest-stage-tools">
          {mode === "nature" && <button aria-pressed={motionEnabled} onClick={() => setMotionEnabled((value) => !value)}>{motionEnabled ? "停止緩慢移景" : "開啟緩慢移景"}</button>}
          <button onClick={() => void toggleFullscreen()}><Maximize2 />全螢幕</button>
        </div>
      </section>

      <section className="rest-settings paper-card">
        <div className="rest-duration" aria-label="選擇休息時間">
          {PRESETS[mode].map((secondsValue) => <button key={secondsValue} aria-pressed={duration === secondsValue} onClick={() => chooseDuration(secondsValue)}>{durationLabel(secondsValue)}</button>)}
        </div>
        {mode !== "eyes" && (
          <form className="rest-custom-time" onSubmit={(event) => { event.preventDefault(); chooseDuration(Math.min(30, Math.max(1, customMinutes)) * 60); }}>
            <label>自訂 <input type="number" min={1} max={30} value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} /> 分鐘</label>
            <button type="submit">套用</button>
          </form>
        )}
        <div className="rest-controls">
          <button className="primary-button" onClick={() => { if (remaining === 0) setRemaining(duration); setRunning((value) => !value); }}>{running ? <Pause /> : <Play />}{running ? "暫停" : remaining === 0 ? "再來一次" : "開始"}</button>
          <button className="quiet-button" onClick={() => { setRemaining(duration); setRunning(false); }}><RotateCcw />重設</button>
        </div>
      </section>

      <details className="rest-evidence">
        <summary>設計依據與使用提醒</summary>
        <p>遠眺與離桌模式會刻意降低螢幕刺激；短而頻繁的離屏休息比一直看著休息動畫更符合顯示器工作建議。呼吸模式採溫和的 5 秒吸、5 秒吐，不閉氣；若頭暈或不舒服，請恢復自然呼吸。</p>
        <div><a href="https://www.hse.gov.uk/msd/dse/work-routine.htm" target="_blank" rel="noopener noreferrer">HSE 顯示器休息建議</a><a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS 呼吸練習</a><a href="https://www.mdpi.com/1660-4601/16/23/4739" target="_blank" rel="noopener noreferrer">自然視覺系統性回顧</a></div>
      </details>
    </main>
  );
}
