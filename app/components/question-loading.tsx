import { BookOpenText } from "lucide-react";

export default function QuestionLoading({ label = "正在展開題目…" }: { label?: string }) {
  return <div className="inline-loading" aria-live="polite"><BookOpenText size={22} /><span>{label}</span></div>;
}
