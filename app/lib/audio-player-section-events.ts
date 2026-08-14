export const QUESTION_AUDIO_CHOICE_EVENT = "em-board-question-audio-choice";

export type QuestionAudioChoiceRequest = {
  sourceId: string;
  questionId: string;
};

export function requestQuestionAudioChoice(request: QuestionAudioChoiceRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QuestionAudioChoiceRequest>(QUESTION_AUDIO_CHOICE_EVENT, {
    detail: request,
  }));
}
