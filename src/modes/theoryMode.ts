/**
 * Theory mode: practice quizzes from the official question bank, a timed mock exam,
 * the sign library and the rule book. No 3D world is loaded.
 */
import type { AppShell } from '@/app/AppShell';
import { TheoryEngine, EXAM_DEFAULTS, type ExamState } from '@/coach';
import type { RuleArticle } from '@/content/schema';
import { renderMarkdown } from '@/ui/markdown';

type HubItem = { id: string; title: string; text: string; onPick: () => void };

export class TheoryMode {
  private panel?: HTMLElement;
  private engine?: TheoryEngine;

  constructor(private readonly app: AppShell) {}

  private async ensureEngine(): Promise<TheoryEngine> {
    if (!this.engine) {
      const questions = await this.app.content.theory();
      this.engine = new TheoryEngine(questions, this.app.profile);
    }
    return this.engine;
  }

  async hub(): Promise<void> {
    const { ui } = this.app;
    ui.hideScreens();
    ui.setMode('theory');
    let stats = '';
    try {
      const engine = await this.ensureEngine();
      const s = engine.stats() as { answered?: number; correct?: number; total?: number };
      if (s.answered) stats = `ענית על ${s.answered} שאלות, ${s.correct ?? 0} נכונות`;
    } catch (err) {
      ui.toast(`מאגר השאלות לא נטען: ${String(err)}`, 'danger', 8);
    }
    this.renderHub([
      { id: 'practice', title: 'תרגול (20 שאלות)', text: 'שאלות מהמאגר הרשמי לרישיון B, עם משוב מיידי. שאלות שטעית בהן יחזרו.', onPick: () => void this.practice() },
      { id: 'exam', title: 'מבחן תיאוריה מדומה', text: '30 שאלות, 40 דקות, עד 4 טעויות — כמו במבחן האמיתי.', onPick: () => void this.exam() },
      { id: 'signs', title: 'ספריית תמרורים', text: 'כל התמרורים הרלוונטיים לנהג חדש, לפי קטגוריות, עם משמעות והנחיה.', onPick: () => void this.signs() },
      { id: 'rules', title: 'ספר החוקים', text: 'הסברים קצרים בעברית על חוקי התנועה שנתרגל בכביש.', onPick: () => void this.rules() },
    ], stats);
  }

  private renderHub(items: HubItem[], stats: string): void {
    this.closePanel();
    const el = document.createElement('div');
    el.className = 'mode-panel';
    el.setAttribute('dir', 'rtl');
    el.innerHTML = `
      <div class="mode-panel__card">
        <header class="mode-panel__header"><h1>תיאוריה</h1><p class="mode-panel__sub">${stats || 'מאגר השאלות הרשמי של משרד התחבורה'}</p></header>
        <div class="mode-panel__grid"></div>
        <footer class="mode-panel__footer"><button class="mode-btn mode-btn--ghost" data-act="back">חזרה לתפריט</button></footer>
      </div>`;
    const grid = el.querySelector('.mode-panel__grid')!;
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'mode-card';
      b.innerHTML = `<strong>${item.title}</strong><span>${item.text}</span>`;
      b.addEventListener('click', item.onPick);
      grid.appendChild(b);
    }
    el.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      this.closePanel();
      this.app.showMainMenu();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.closePanel();
        this.app.showMainMenu();
      }
    };
    el.addEventListener('keydown', onKey);
    this.app.uiRoot.appendChild(el);
    (el.querySelector('button') as HTMLButtonElement | null)?.focus();
    this.panel = el;
  }

  private closePanel(): void {
    this.panel?.remove();
    this.panel = undefined;
  }

  async practice(): Promise<void> {
    const engine = await this.ensureEngine();
    const questions = engine.pick({ count: 20, classB: true, weakFirst: true });
    this.closePanel();
    this.app.ui.showScreen('theoryQuiz', {
      questions,
      mode: 'practice',
      onAnswer: (id, index) => {
        engine.answer(id, index);
      },
      onFinish: () => void this.hub(),
      onClose: () => void this.hub(),
    });
  }

  async exam(): Promise<void> {
    const engine = await this.ensureEngine();
    const state: ExamState = engine.startExam({ count: EXAM_DEFAULTS.count, minutes: EXAM_DEFAULTS.minutes, passMark: EXAM_DEFAULTS.passMark });
    const questions = state.questions;
    this.closePanel();
    this.app.ui.showScreen('theoryQuiz', {
      questions,
      mode: 'exam',
      timeLimitSec: EXAM_DEFAULTS.minutes * 60,
      passMark: EXAM_DEFAULTS.passMark,
      onAnswer: (id, index) => {
        engine.answerExam(id, index);
      },
      onFinish: () => {
        if (engine.exam) engine.finishExam();
        void this.hub();
      },
      onClose: () => {
        engine.abortExam();
        void this.hub();
      },
    });
  }

  async signs(): Promise<void> {
    const signs = await this.app.content.signs();
    this.closePanel();
    this.app.ui.showScreen('signLibrary', { signs, onClose: () => void this.hub() });
  }

  async rules(): Promise<void> {
    const articles = await this.app.content.rules();
    this.closePanel();
    this.renderRules(articles);
  }

  private renderRules(articles: RuleArticle[], selected?: RuleArticle): void {
    this.closePanel();
    const el = document.createElement('div');
    el.className = 'mode-panel';
    el.setAttribute('dir', 'rtl');
    el.innerHTML = `
      <div class="mode-panel__card mode-panel__card--wide">
        <header class="mode-panel__header"><h1>ספר החוקים</h1><p class="mode-panel__sub">${selected ? selected.title : `${articles.length} נושאים`}</p></header>
        <div class="mode-rules">
          <nav class="mode-rules__nav"></nav>
          <article class="mode-rules__body"></article>
        </div>
        <footer class="mode-panel__footer"><button class="mode-btn mode-btn--ghost" data-act="back">חזרה</button></footer>
      </div>`;
    const nav = el.querySelector('.mode-rules__nav')!;
    const body = el.querySelector('.mode-rules__body')!;
    for (const a of articles) {
      const b = document.createElement('button');
      b.className = 'mode-rules__item' + (selected?.id === a.id ? ' is-active' : '');
      b.textContent = a.title;
      b.addEventListener('click', () => this.renderRules(articles, a));
      nav.appendChild(b);
    }
    const show = selected ?? articles[0];
    if (show) {
      body.appendChild(renderMarkdown(show.body));
      if (show.source) {
        const src = document.createElement('p');
        src.className = 'mode-rules__source';
        src.textContent = `מקור: ${show.source}`;
        body.appendChild(src);
      }
      if (show.signs.length) {
        const row = document.createElement('div');
        row.className = 'mode-rules__signs';
        for (const code of show.signs) {
          const img = document.createElement('img');
          img.src = `${import.meta.env.BASE_URL}signs/${code}.svg`;
          img.alt = `תמרור ${code}`;
          img.title = `תמרור ${code}`;
          img.onerror = () => img.remove();
          row.appendChild(img);
        }
        body.appendChild(row);
      }
    }
    el.querySelector('[data-act="back"]')!.addEventListener('click', () => void this.hub());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') void this.hub();
    });
    this.app.uiRoot.appendChild(el);
    this.panel = el;
  }

  dispose(): void {
    this.closePanel();
  }
}
