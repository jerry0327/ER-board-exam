from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: expected block not found")
    return text.replace(old, new, 1)


provider_path = Path("app/components/audio-player-provider.tsx")
provider = provider_path.read_text()
provider = replace_once(
    provider,
    '''  useEffect(() => {
    try {
      setSubtitlesEnabledState(window.localStorage.getItem(SUBTITLE_PREFERENCE_KEY) === "true");
    } catch {
      // Subtitle preference is optional when storage is unavailable.
    }
  }, []);
''',
    '''  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setSubtitlesEnabledState(window.localStorage.getItem(SUBTITLE_PREFERENCE_KEY) === "true");
      } catch {
        // Subtitle preference is optional when storage is unavailable.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
''',
    "subtitle preference effect",
)
provider_path.write_text(provider)


companion_path = Path("app/components/audio-section-companion.tsx")
companion = companion_path.read_text()
companion = replace_once(
    companion,
    '''  useEffect(() => {
    setSectionOpen(false);
    if (!currentSource) {
      setBundle(null);
      return;
    }
    let active = true;
    void loadSectionBundle(currentSource)
      .then((loaded) => {
        if (active) setBundle(loaded);
      })
      .catch(() => {
        if (active) setBundle(null);
      });
    return () => {
      active = false;
    };
  }, [currentSource]);
''',
    '''  useEffect(() => {
    const closeFrame = window.requestAnimationFrame(() => setSectionOpen(false));
    if (!currentSource) {
      const clearFrame = window.requestAnimationFrame(() => setBundle(null));
      return () => {
        window.cancelAnimationFrame(closeFrame);
        window.cancelAnimationFrame(clearFrame);
      };
    }
    let active = true;
    void loadSectionBundle(currentSource)
      .then((loaded) => {
        if (active) setBundle(loaded);
      })
      .catch(() => {
        if (active) setBundle(null);
      });
    return () => {
      active = false;
      window.cancelAnimationFrame(closeFrame);
    };
  }, [currentSource]);
''',
    "source bundle effect",
)

companion = replace_once(
    companion,
    '''  useEffect(() => {
    if (!currentSource) {
      if (scope) setScope(null);
      return;
    }
    if (scope && (scope.sourceId !== currentSource.id || scope.sourceRevision !== currentSource.revision)) setScope(null);
  }, [currentSource, scope]);
''',
    '''  useEffect(() => {
    if (!scope) return;
    if (currentSource && scope.sourceId === currentSource.id && scope.sourceRevision === currentSource.revision) return;
    const frame = window.requestAnimationFrame(() => setScope(null));
    return () => window.cancelAnimationFrame(frame);
  }, [currentSource, scope]);
''',
    "scope reset effect",
)

companion = replace_once(
    companion,
    '''  useEffect(() => {
    if (player.stowed || !currentSource) {
      setDockTarget(null);
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setDockTarget(document.querySelector<HTMLElement>(".audio-player-dock"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.stowed]);
''',
    '''  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setDockTarget(player.stowed || !currentSource
        ? null
        : document.querySelector<HTMLElement>(".audio-player-dock"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.stowed]);
''',
    "dock target effect",
)

companion = replace_once(
    companion,
    '''  useEffect(() => {
    if (!player.expanded || player.stowed || !currentSource) {
      setSectionOpen(false);
      setDetailsTarget(null);
      setTimelineTarget(null);
      return;
    }
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      setDetailsTarget(document.querySelector<HTMLElement>(".audio-player-details"));
      setTimelineTarget(document.querySelector<HTMLElement>(".audio-player-timeline"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.expanded, player.stowed]);
''',
    '''  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!player.expanded || player.stowed || !currentSource) {
        setSectionOpen(false);
        setDetailsTarget(null);
        setTimelineTarget(null);
        return;
      }
      setDetailsTarget(document.querySelector<HTMLElement>(".audio-player-details"));
      setTimelineTarget(document.querySelector<HTMLElement>(".audio-player-timeline"));
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [currentSource, player.expanded, player.stowed]);
''',
    "details target effect",
)

companion = replace_once(
    companion,
    '''  useEffect(() => {
    if (!activeScope) return;
    const tolerance = 0.06;
    if (player.position < activeScope.startSeconds - tolerance) {
      player.seek(activeScope.startSeconds);
      return;
    }
    if (player.position >= activeScope.endSeconds - tolerance) {
      if (player.isPlaying) player.pause();
      if (Math.abs(player.position - activeScope.endSeconds) > tolerance) {
        player.seek(activeScope.endSeconds);
      }
    }
  }, [activeScope, player.isPlaying, player.pause, player.position, player.seek]);

  useEffect(() => {
    if (!activeScope || !player.isPlaying) return;
    const remaining = activeScope.endSeconds - player.position;
    if (remaining <= 0.06) return;
    const milliseconds = Math.max(20, remaining / Math.max(0.25, player.playbackRate) * 1000 + 20);
    const timer = window.setTimeout(() => {
      player.pause();
      player.seek(activeScope.endSeconds);
    }, milliseconds);
    return () => window.clearTimeout(timer);
  }, [activeScope, player.isPlaying, player.pause, player.playbackRate, player.position, player.seek]);
''',
    '''  const scopePosition = player.position;
  const scopeIsPlaying = player.isPlaying;
  const scopePlaybackRate = player.playbackRate;
  const scopePause = player.pause;
  const scopeSeek = player.seek;

  useEffect(() => {
    if (!activeScope) return;
    const tolerance = 0.06;
    if (scopePosition < activeScope.startSeconds - tolerance) {
      scopeSeek(activeScope.startSeconds);
      return;
    }
    if (scopePosition >= activeScope.endSeconds - tolerance) {
      if (scopeIsPlaying) scopePause();
      if (Math.abs(scopePosition - activeScope.endSeconds) > tolerance) {
        scopeSeek(activeScope.endSeconds);
      }
    }
  }, [activeScope, scopeIsPlaying, scopePause, scopePosition, scopeSeek]);

  useEffect(() => {
    if (!activeScope || !scopeIsPlaying) return;
    const remaining = activeScope.endSeconds - scopePosition;
    if (remaining <= 0.06) return;
    const milliseconds = Math.max(20, remaining / Math.max(0.25, scopePlaybackRate) * 1000 + 20);
    const timer = window.setTimeout(() => {
      scopePause();
      scopeSeek(activeScope.endSeconds);
    }, milliseconds);
    return () => window.clearTimeout(timer);
  }, [activeScope, scopeIsPlaying, scopePause, scopePlaybackRate, scopePosition, scopeSeek]);
''',
    "scoped playback effects",
)
companion_path.write_text(companion)


test_path = Path("tests/audio-player-section-subtitle-contract.test.mjs")
test = test_path.read_text()
test = replace_once(
    test,
    '  assert.match(companion, /setSectionOpen\\(false\\);\\s*if \\(!currentSource\\)/u);',
    '  assert.match(companion, /requestAnimationFrame\\(\\(\\) => setSectionOpen\\(false\\)\\)/u);',
    "section close contract",
)
test_path.write_text(test)

print("Applied lint-safe audio effect refactor")
