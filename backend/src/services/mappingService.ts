import { Question, Answer } from "../models/extraction";
import {
  MappingResult,
  QuestionAnswerMapping,
  UnansweredQuestion,
  UnmatchedAnswer,
} from "../models/mapping";
import { SemanticProvider } from "../clients/semanticProvider";

// ─── Constants ────────────────────────────────────────────────────────────────

export const DIRECT_MATCH_CONFIDENCE = 0.98;
export const DEFAULT_SEMANTIC_THRESHOLD = 0.6;
export const DEFAULT_UNCERTAIN_THRESHOLD = 0.35;

// ─── Public types ─────────────────────────────────────────────────────────────

export type MappingOptions = {
  semanticProvider?: SemanticProvider;
  /** Accept a semantic match as "answered" when score >= this. Default 0.6 */
  semanticThreshold?: number;
  /** Emit "uncertain" when score is in [uncertainThreshold, semanticThreshold). Default 0.35 */
  uncertainThreshold?: number;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function mapQuestionsToAnswers(
  questions: Question[],
  answers: Answer[],
  options: MappingOptions = {}
): Promise<MappingResult> {
  const {
    semanticProvider,
    semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD,
    uncertainThreshold = DEFAULT_UNCERTAIN_THRESHOLD,
  } = options;

  // ── Edge cases ──────────────────────────────────────────────────────────────

  if (!questions.length && !answers.length) {
    return { mappings: [], unanswered: [], unmatched: [] };
  }
  if (!questions.length) {
    return {
      mappings: [],
      unanswered: [],
      unmatched: answers.map((a) => ({ answerId: a.id, status: "unmatched" as const })),
    };
  }
  if (!answers.length) {
    return {
      mappings: [],
      unanswered: questions.map((q) => ({ questionId: q.id, status: "unanswered" as const })),
      unmatched: [],
    };
  }

  // ── Index questions by their printed number ─────────────────────────────────

  const questionByNumber = new Map(questions.map((q) => [q.number, q]));

  const mappings: QuestionAnswerMapping[] = [];
  const unanswered: UnansweredQuestion[] = [];
  const unmatched: UnmatchedAnswer[] = [];

  const matchedQuestionIds = new Set<string>();
  const matchedAnswerIds = new Set<string>();

  // ── 1. Split answers into labeled (have detectedQuestionNumber) vs unlabeled ─

  const labeledGroups = new Map<string, Answer[]>();
  const unlabeledAnswers: Answer[] = [];

  for (const answer of answers) {
    if (answer.detectedQuestionNumber) {
      const group = labeledGroups.get(answer.detectedQuestionNumber) ?? [];
      group.push(answer);
      labeledGroups.set(answer.detectedQuestionNumber, group);
    } else {
      unlabeledAnswers.push(answer);
    }
  }

  // ── 2. Explicit label matching ───────────────────────────────────────────────

  for (const [number, group] of labeledGroups) {
    const question = questionByNumber.get(number);

    if (!question) {
      // Label exists but no question matches → unmatched
      group.forEach((a) => unmatched.push({ answerId: a.id, status: "unmatched" }));
      continue;
    }

    if (group.length === 1) {
      // Unique direct match — highest confidence
      mappings.push({
        questionId: question.id,
        answerId: group[0].id,
        status: "answered",
        confidence: DIRECT_MATCH_CONFIDENCE,
      });
      matchedQuestionIds.add(question.id);
      matchedAnswerIds.add(group[0].id);
    } else {
      // Competing answers for the same question → uncertain for each;
      // confidence is proportionally reduced by the number of competitors.
      const confidence = DIRECT_MATCH_CONFIDENCE / group.length;
      group.forEach((a) => {
        mappings.push({
          questionId: question.id,
          answerId: a.id,
          status: "uncertain",
          confidence,
        });
        matchedAnswerIds.add(a.id);
      });
      matchedQuestionIds.add(question.id);
    }
  }

  // ── 3. Semantic fallback for remaining questions and unlabeled answers ────────

  const unmatchedQuestions = questions.filter((q) => !matchedQuestionIds.has(q.id));
  const availableAnswers = unlabeledAnswers.filter((a) => !matchedAnswerIds.has(a.id));

  if (semanticProvider && availableAnswers.length > 0 && unmatchedQuestions.length > 0) {
    const usedAnswerIds = new Set<string>();

    for (const question of unmatchedQuestions) {
      let bestScore = -1;
      let bestAnswer: Answer | null = null;

      for (const answer of availableAnswers) {
        if (usedAnswerIds.has(answer.id)) continue;
        const s = await semanticProvider.score(question.text, answer.text);
        if (s > bestScore) {
          bestScore = s;
          bestAnswer = answer;
        }
      }

      if (bestAnswer !== null && bestScore >= semanticThreshold) {
        mappings.push({
          questionId: question.id,
          answerId: bestAnswer.id,
          status: "answered",
          confidence: bestScore,
        });
        matchedQuestionIds.add(question.id);
        matchedAnswerIds.add(bestAnswer.id);
        usedAnswerIds.add(bestAnswer.id);
      } else if (bestAnswer !== null && bestScore >= uncertainThreshold) {
        mappings.push({
          questionId: question.id,
          answerId: bestAnswer.id,
          status: "uncertain",
          confidence: bestScore,
        });
        matchedQuestionIds.add(question.id);
        matchedAnswerIds.add(bestAnswer.id);
        usedAnswerIds.add(bestAnswer.id);
      } else {
        unanswered.push({ questionId: question.id, status: "unanswered" });
      }
    }

    // Unlabeled answers that no question claimed → unmatched
    availableAnswers.forEach((a) => {
      if (!matchedAnswerIds.has(a.id)) {
        unmatched.push({ answerId: a.id, status: "unmatched" });
      }
    });
  } else {
    // No semantic provider (or no candidates) — deterministic only
    unmatchedQuestions.forEach((q) =>
      unanswered.push({ questionId: q.id, status: "unanswered" })
    );
    availableAnswers.forEach((a) =>
      unmatched.push({ answerId: a.id, status: "unmatched" })
    );
  }

  return { mappings, unanswered, unmatched };
}
