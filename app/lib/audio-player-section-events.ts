export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";
export const AUDIO_PLAYER_SETTINGS_OPEN_EVENT = "em-board-audio-player-settings-open";

export type QuestionAudioChoiceRequest = {
  sourceId: string;
  questionId: string;
};

export type QuestionAudioChoiceEventDetail = QuestionAudioChoiceRequest & {
  trigger?: HTMLElement | null;
};

// Keep question-level playback selection decoupled from the SNAC decoder/provider.
// The section companion resolves the requested question into the canonical time range.
// Timeline section-node clicks and the question chooser converge on the same player seek API.
// Node hit targets sit above the range track while the remaining track stays draggable.
// Visual-only player refinements do not change this event boundary.
export function requestQuestionAudioChoice(
  request: QuestionAudioChoiceRequest,
  trigger?: HTMLElement | null,
) {
  if (typeof window === "undefined") return;
  const detail: QuestionAudioChoiceEventDetail = { ...request, trigger: trigger ?? null };
  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceEventDetail>(QUESTION_AUDIO_CHOICE_EVENT, {
    detail,
  }));
}
