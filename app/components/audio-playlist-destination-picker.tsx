"use client";

import { Check, FolderPlus, X } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useOverlayFocusManagement } from "../hooks/use-overlay-focus-management";
import {
  AUDIO_PLAYLIST_COUNT_LIMIT,
  AUDIO_PLAYLIST_ITEM_LIMIT,
  type AudioPlaylist,
} from "../lib/audio-playlists";

type Props = {
  open: boolean;
  sourceId: string;
  sourceLabel: string;
  playlists: readonly AudioPlaylist[];
  busy: boolean;
  pendingId: string;
  error: string;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (playlist: AudioPlaylist) => void;
  onCreate: (name: string) => void;
};

export default function AudioPlaylistDestinationPicker({
  open,
  sourceId,
  sourceLabel,
  playlists,
  busy,
  pendingId,
  error,
  triggerRef,
  onClose,
  onSelect,
  onCreate,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const [newName, setNewName] = useState("");

  useOverlayFocusManagement({
    open,
    panelRef,
    triggerRef,
    onClose,
    initialFocusSelector: "[data-playlist-picker-initial]",
  });

  if (!open || typeof document === "undefined") return null;
  const canCreate = playlists.length < AUDIO_PLAYLIST_COUNT_LIMIT;

  return createPortal(
    <div className="audio-playlist-picker-backdrop" onClick={onClose}>
      <section
        ref={panelRef}
        className="audio-playlist-destination-picker overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audio-playlist-picker-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>加入播放清單</small>
            <h2 id="audio-playlist-picker-title">選擇目的清單</h2>
            <p>{sourceLabel}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="關閉播放清單選擇"
            data-playlist-picker-initial
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {playlists.length > 0 && (
          <ul className="audio-playlist-destination-list">
            {playlists.map((playlist) => {
              const included = playlist.itemIds.includes(sourceId);
              const full = playlist.itemIds.length >= AUDIO_PLAYLIST_ITEM_LIMIT;
              return (
                <li key={playlist.id}>
                  <button
                    type="button"
                    className={included ? "is-added" : undefined}
                    disabled={busy || included || full}
                    onClick={() => onSelect(playlist)}
                  >
                    <span><strong>{playlist.name}</strong><small>{playlist.itemIds.length} 集</small></span>
                    {included
                      ? <span><Check aria-hidden="true" />已加入</span>
                      : full
                        ? <span>已達上限</span>
                        : <span>{pendingId === playlist.id ? "加入中…" : "加入"}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          className="audio-playlist-destination-create"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (name) onCreate(name);
          }}
        >
          <label>
            <span>{playlists.length ? "或建立新清單" : "建立第一份清單並加入"}</span>
            <input
              className="field-control"
              value={newName}
              maxLength={60}
              placeholder="例如：本週複習"
              disabled={busy || !canCreate}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={busy || !canCreate || !newName.trim()}>
            <FolderPlus aria-hidden="true" />建立並加入
          </button>
        </form>
        {!canCreate && <p className="audio-playlist-picker-error">已達 {AUDIO_PLAYLIST_COUNT_LIMIT} 份播放清單上限。</p>}
        {error && <p className="audio-playlist-picker-error" role="alert">{error}</p>}
      </section>
    </div>,
    document.body,
  );
}
