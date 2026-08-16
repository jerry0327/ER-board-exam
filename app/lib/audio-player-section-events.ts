export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";

export type QuestionAudioChoiceRequest = {
  sourceId: string;
  questionId: string;
};

// Keep question-level playback selection decoupled from the SNAC decoder/provider.
// The section companion resolves the requested question into the canonical time range.
// Timeline section-node clicks and the question chooser converge on the same player seek API.
// Node hit targets sit above the range track while the remaining track stays draggable.
// Visual-only player refinements do not change this event boundary.
export function requestQuestionAudioChoice(request: QuestionAudioChoiceRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceRequest>(QUESTION_AUDIO_CHOICE_EVENT, {
    detail: request,
  }));
}
