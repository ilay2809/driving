/** App-level cache of learning content (loaded lazily, validated by the content loaders). */
import type { Lesson } from '@/coach/lessonSchema';
import type { DialogueLine, RuleArticle, SignDef, TheoryQuestion } from '@/content/schema';
import { loadDialogue, loadLessons, loadRules, loadSigns, loadTheory } from '@/content/loaders';

export class ContentStore {
  private lessonsP?: Promise<Lesson[]>;
  private signsP?: Promise<SignDef[]>;
  private theoryP?: Promise<TheoryQuestion[]>;
  private rulesP?: Promise<RuleArticle[]>;
  private dialogueP?: Promise<DialogueLine[]>;

  lessons(): Promise<Lesson[]> {
    return (this.lessonsP ??= loadLessons());
  }
  signs(): Promise<SignDef[]> {
    return (this.signsP ??= loadSigns());
  }
  theory(): Promise<TheoryQuestion[]> {
    return (this.theoryP ??= loadTheory());
  }
  rules(): Promise<RuleArticle[]> {
    return (this.rulesP ??= loadRules());
  }
  dialogue(): Promise<DialogueLine[]> {
    return (this.dialogueP ??= loadDialogue());
  }
}
