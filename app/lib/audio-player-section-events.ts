export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";

export type QuestionAudioChoiceRequest = {
  sourceId: string;
  questionId: string;
};

// Keep question-level playback selection decoupled from the SNAC decoder/provider.
// The section companion resolves the requested question into the canonical time range.
export function requestQuestionAudioChoice(request: QuestionAudioChoiceRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceRequest>(QUESTION_AUDIO_CHOICE_EVENT, {
    detail: request,
  }));
}
