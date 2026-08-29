// Best-effort AI grading. No answer key is ever uploaded, so this is an AI
// judgement call from question + answer text alone, including maxScore. One
// combined call grades every mapped question. Callers must catch failures
// and continue with no grading — this must never fail the pipeline.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";
import { parseJsonFromText } from "../clients/geminiVisionClient";
import { Question, Answer } from "../models/extraction";
import { QuestionAnswerMapping } from "../models/mapping";
import { QuestionGrading } from "../models/grading";

const REQUEST_TIMEOUT_MS = 60_000;

const GRADING_PROMPT_HEADER = `You are grading a student's handwritten exam answers.
No official answer key or rubric is available — use your own subject knowledge.
For each question below, assign a reasonable maxScore (2-5) based on the
question's apparent complexity, then judge the student's answer against it.

Return ONLY a JSON array — no explanations, no markdown fences:
[
  {"questionId": "q_1", "score": 2, "maxScore": 2, "correct": true, "feedback": "Correct and complete."},
  {"questionId": "q_4", "score": 0, "maxScore": 2, "correct": false, "feedback": "Confuses arteries with veins."}
]

Rules:
- One entry per question listed below, matched by its exact questionId.
- score must be between 0 and maxScore.
- feedback must be one short sentence, specific to the answer given.
- Output ONLY the JSON array.

Questions and answers to grade:
`;

export async function gradeAnswers(
  questions: Question[],
  answers: Answer[],
  mappings: QuestionAnswerMapping[]
): Promise<QuestionGrading[]> {
  if (!env.geminiApiKey) return [];

  const questionById = new Map(questions.map((q) => [q.id, q]));
  const answerById = new Map(answers.map((a) => [a.id, a]));

  const gradable = mappings
    .map((m) => ({
      question: questionById.get(m.questionId),
      answer: answerById.get(m.answerId),
    }))
    .filter(
      (pair): pair is { question: Question; answer: Answer } =>
        !!pair.question && !!pair.answer && !!pair.answer.text
    );

  if (gradable.length === 0) return [];

  const genai = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genai.getGenerativeModel({ model: env.geminiModel });

  const prompt =
    GRADING_PROMPT_HEADER +
    gradable
      .map(
        ({ question, answer }) =>
          `questionId: ${question.id}\nquestion (${question.number}): ${question.text}\nstudent answer: ${answer.text}`
      )
      .join("\n\n");

  const generatePromise = model.generateContent(prompt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Gemini grading request timed out")),
      REQUEST_TIMEOUT_MS
    );
  });

  let text: string;
  try {
    const result = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timer);
    text = result.response.text();
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (!text || !text.trim()) {
    throw new Error("Gemini returned an empty grading response");
  }

  const raw = parseJsonFromText(text);
  return validateAndBuildGrading(raw, questionById);
}

type RawGrading = {
  questionId: unknown;
  score: unknown;
  maxScore: unknown;
  correct: unknown;
  feedback: unknown;
};

function validateAndBuildGrading(
  raw: unknown,
  questionById: Map<string, Question>
): QuestionGrading[] {
  if (!Array.isArray(raw)) {
    throw new Error("Gemini grading response has unexpected shape: expected a JSON array.");
  }

  const grading: QuestionGrading[] = [];

  for (const item of raw) {
    const entry = item as RawGrading;

    if (typeof entry?.questionId !== "string") continue;
    if (!questionById.has(entry.questionId)) continue;
    if (typeof entry.score !== "number") continue;
    if (typeof entry.maxScore !== "number" || entry.maxScore <= 0) continue;
    if (typeof entry.correct !== "boolean") continue;
    if (typeof entry.feedback !== "string" || !entry.feedback.trim()) continue;

    grading.push({
      questionId: entry.questionId,
      score: Math.max(0, Math.min(entry.score, entry.maxScore)),
      maxScore: entry.maxScore,
      correct: entry.correct,
      feedback: entry.feedback.trim(),
    });
  }

  return grading;
}
